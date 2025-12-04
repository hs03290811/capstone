import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from sqlalchemy import create_engine, text
from starlette.middleware.cors import CORSMiddleware
import random
import statistics
import math

# ==========================================
# 1. 설정 및 DB 연결
# ==========================================
DB_URL = "postgresql://postgres:nabxav-nithiC-2ronpo@capstone-db.caty68mm025l.us-east-1.rds.amazonaws.com:5432/postgres"
ACTIVE_TABLE_NAME = "segments_table_loose" 
EXCLUDE_PATH_IDS = ['292097278', '292097273', '1054159545', '1021630677', '1021630678'] 
CAU_LON = 126.956
CAU_LAT = 37.503
RADIUS_DEGREE = 0.04 

try:
    engine = create_engine(DB_URL)
    print(f"✅ DB 연결 성공! (Target Table: {ACTIVE_TABLE_NAME})")
except Exception as e:
    print(f"❌ DB 연결 실패: {e}")
    engine = None

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# --- 데이터 모델 ---
class GPSRequest(BaseModel):
    current_lat: float
    current_lon: float
    target_km: Optional[float] = 3.0 
class VoiceGuide(BaseModel):
    index: int; message: str
class Properties(BaseModel):
    label: str; total_distance: float; avg_slope: float; slopes: List[float]; elevations: List[float]; voice_guides: List[VoiceGuide]
class Geometry(BaseModel):
    type: str = "LineString"; coordinates: List[List[float]]
class Feature(BaseModel):
    type: str = "Feature"; geometry: Geometry; properties: Properties
class GeoJSONResponse(BaseModel):
    type: str = "FeatureCollection"; features: List[Feature]

# --- 헬퍼 함수 ---
def clean_and_smooth_slopes(slopes: List[float], window_size: int = 3) -> List[float]:
    # 이상치 제거 (튀는 값은 20%로 제한)
    capped_slopes = [min(abs(s), 20.0) if s >= 0 else max(s, -20.0) for s in slopes]
    smoothed = []
    for i in range(len(capped_slopes)):
        start = max(0, i - window_size // 2)
        end = min(len(capped_slopes), i + window_size // 2 + 1)
        smoothed.append(statistics.mean(capped_slopes[start:end]))
    return [round(s, 2) for s in smoothed]

def generate_voice_guides(slopes: List[float], total_dist: float) -> List[VoiceGuide]:
    guides = [VoiceGuide(index=0, message="러닝을 시작합니다. 왕복 코스입니다.")]
    state = "flat"
    mid_idx = len(slopes) // 2
    
    for i, s in enumerate(slopes):
        if i < 5: continue
        
        # 반환점 안내
        if i == mid_idx:
             guides.append(VoiceGuide(index=i, message="반환점입니다! 왔던 길을 되돌아갑니다."))

        if s >= 4.0 and state != "up":
            guides.append(VoiceGuide(index=i, message="오르막 구간입니다. 호흡을 조절하세요."))
            state = "up"
        elif s <= -4.0 and state != "down":
            guides.append(VoiceGuide(index=i, message="내리막 구간입니다. 무릎 충격에 주의하세요."))
            state = "down"
        elif -2.0 < s < 2.0 and state != "flat": 
            state = "flat"
            
    guides.append(VoiceGuide(index=len(slopes)-1, message="목적지에 도착했습니다. 수고하셨습니다."))
    return guides

# ==========================================
# 4. API 엔드포인트
# ==========================================
@app.get("/")
def read_root():
    return {"Hello": "Server is running. Endpoint: /api/recommend"}
    
@app.post("/api/recommend", response_model=GeoJSONResponse)
def recommend_course(req: GPSRequest):
    if not engine: raise HTTPException(status_code=500, detail="DB 연결 안됨")
    
    target_km = req.target_km if req.target_km else 3.0
    one_way_target_km = target_km / 2.0 
    
    print(f"📍 요청: {req.current_lat}, {req.current_lon} / 목표: {target_km}km")
    generated_routes = []
    used_target_nodes = set() 
    
    exclude_list_str = "('" + "','".join(map(str, EXCLUDE_PATH_IDS)) + "')"
    
    with engine.connect() as conn:
        start_node = conn.execute(text(f"""
            SELECT id FROM {ACTIVE_TABLE_NAME}_vertices_pgr 
            ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) LIMIT 1;
        """), {"lon": req.current_lon, "lat": req.current_lat}).scalar()
        
        if not start_node: raise HTTPException(status_code=404, detail="시작점 주변 도로 데이터 없음")

        # 후보 50개 탐색 (다양성 확보)
        targets = conn.execute(text(f"""
            SELECT v.id FROM {ACTIVE_TABLE_NAME}_vertices_pgr v
            WHERE ST_DWithin(v.the_geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :rad) 
              AND v.id != :start
            ORDER BY RANDOM() LIMIT 50;
        """), {"lon": req.current_lon, "lat": req.current_lat, "rad": (one_way_target_km * 0.7) / 111.0, "start": start_node}).fetchall()
        
        target_ids = [r.id for r in targets]
        print(f"🛣️ 후보 {len(target_ids)}개 탐색 시작...")
        
        dijkstra_inner_q = f"SELECT segment_id as id, source, target, length as cost FROM {ACTIVE_TABLE_NAME} WHERE path_id NOT IN {exclude_list_str}"

        for t_node in target_ids:
            if len(generated_routes) >= 3: break
            if t_node in used_target_nodes: continue

            try:
                # A -> T (편도) 경로 탐색
                path_query = text(f"""
                    SELECT 
                        ST_X(ST_StartPoint(b.geometry)) AS slon, ST_Y(ST_StartPoint(b.geometry)) AS slat, 
                        ST_X(ST_EndPoint(b.geometry)) AS elon, ST_Y(ST_EndPoint(b.geometry)) AS elat,
                        COALESCE(b.slope, 0) as slope, COALESCE(b.avg_altitude, 0) as elev, b.length as dist
                    FROM pgr_dijkstra($q${dijkstra_inner_q}$q$, :start, :end, false) a
                    JOIN {ACTIVE_TABLE_NAME} b ON a.edge = b.segment_id ORDER BY a.seq;
                """)
                rows = conn.execute(path_query, {"start": start_node, "end": t_node}).fetchall()
                
                if not rows: continue

                # 거리 체크 (0.5 ~ 1.5배)
                dist_sum = sum([float(r.dist) for r in rows]) / 1000.0
                if not (one_way_target_km * 0.5 <= dist_sum <= one_way_target_km * 1.5): continue 

                # --- 왕복 경로 조립 ---
                full_path = []; full_slopes = []; full_elevs = []
                
                # 갈 때
                full_path.append([float(rows[0].slon), float(rows[0].slat)])
                for r in rows:
                    full_path.append([float(r.elon), float(r.elat)])
                    full_slopes.append(float(r.slope)); full_elevs.append(float(r.elev))
                
                # 올 때 (역순)
                full_path.extend(full_path[::-1][1:])
                full_slopes.extend([-s for s in reversed(full_slopes)])
                full_elevs.extend(list(reversed(full_elevs)))
                
                total_dist_km = dist_sum * 2
                
                # 데이터 정리 (스무딩)
                refined_slopes = clean_and_smooth_slopes(full_slopes)
                
                # ★ 핵심 수정: 오르막(양수)만 필터링하여 평균 계산 ★
                # 평지나 내리막은 '힘듦' 점수에 반영하지 않음
                positive_slopes = [s for s in refined_slopes if s > 0]
                if positive_slopes:
                    avg_slope_val = statistics.mean(positive_slopes)
                else:
                    avg_slope_val = 0.0 # 오르막이 하나도 없으면 0
                
                generated_routes.append({
                    "path": full_path, "total_distance": round(total_dist_km, 2),
                    "avg_slope": round(avg_slope_val, 2),
                    "slopes": refined_slopes, "elevations": full_elevs,
                    "voice_guides": generate_voice_guides(refined_slopes, total_dist_km)
                })
                used_target_nodes.add(t_node)
                
            except Exception as e:
                print(f"⚠️ Error: {e}"); continue

    if not generated_routes:
        raise HTTPException(status_code=404, detail="조건에 맞는 코스를 찾지 못했습니다.")
        
    while len(generated_routes) < 3: generated_routes.append(generated_routes[0])
    
    # 평균 오르막 경사도 순으로 정렬 (난이도)
    generated_routes.sort(key=lambda x: x["avg_slope"])
    
    features = []
    labels = ["Easy (완만)", "Normal (보통)", "Hard (도전)"]
    for i, r in enumerate(generated_routes[:3]):
        features.append(Feature(geometry=Geometry(coordinates=r["path"]), properties=Properties(
            label=labels[i], total_distance=r["total_distance"], avg_slope=r["avg_slope"],
            slopes=r["slopes"], elevations=r["elevations"], voice_guides=r["voice_guides"]
        )))

    print(f"🚀 최종 {len(features)}개 왕복 코스 반환 완료")
    return GeoJSONResponse(features=features)

if __name__ == "__main__":
    print("🚀 러닝 앱 서버 시작 (최종 수정 버전)")
    uvicorn.run(app, host="0.0.0.0", port=8000)
