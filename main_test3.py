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
CAU_LON = 126.956; CAU_LAT = 37.503

try:
    engine = create_engine(DB_URL)
    print(f"✅ DB 연결 성공! (Target: {ACTIVE_TABLE_NAME})")
except Exception as e:
    print(f"❌ DB 연결 실패: {e}")
    engine = None

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# --- 데이터 모델 ---
class GPSRequest(BaseModel):
    current_lat: float; current_lon: float; target_km: Optional[float] = 3.0 
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
    capped = [min(abs(s), 20.0) if s >= 0 else max(s, -20.0) for s in slopes]
    smoothed = []
    for i in range(len(capped)):
        start = max(0, i - window_size // 2)
        end = min(len(capped), i + window_size // 2 + 1)
        smoothed.append(statistics.mean(capped[start:end]))
    return [round(s, 2) for s in smoothed]

def generate_voice_guides(slopes: List[float], total_dist: float) -> List[VoiceGuide]:
    guides = [VoiceGuide(index=0, message="러닝을 시작합니다. 왕복 코스입니다.")]
    mid_idx = len(slopes) // 2
    state = "flat"
    for i, s in enumerate(slopes):
        if i < 5: continue
        if i == mid_idx: guides.append(VoiceGuide(index=i, message="반환점입니다! 왔던 길을 되돌아갑니다."))
        
        if s >= 4.0 and state != "up":
            guides.append(VoiceGuide(index=i, message="오르막 구간입니다. 호흡을 조절하세요."))
            state = "up"
        elif s <= -4.0 and state != "down":
            guides.append(VoiceGuide(index=i, message="내리막 구간입니다. 무릎 충격에 주의하세요."))
            state = "down"
        elif -2.0 < s < 2.0 and state != "flat": state = "flat"
    guides.append(VoiceGuide(index=len(slopes)-1, message="목적지에 도착했습니다. 수고하셨습니다."))
    return guides

def get_dist(p1, p2):
    # 하버사인 공식 간략화 (거리 계산용)
    return math.sqrt((p1[0]-p2[0])**2 + (p1[1]-p2[1])**2)

# ==========================================
# 4. API 엔드포인트
# ==========================================
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
        # ★★★ 1. 시작점 후보군 확보 (거리 분산 로직) ★★★
        # 반경 500m 내의 노드들을 많이(50개) 가져옴
        raw_start_nodes = conn.execute(text(f"""
            SELECT id, ST_X(the_geom) as lon, ST_Y(the_geom) as lat 
            FROM {ACTIVE_TABLE_NAME}_vertices_pgr 
            WHERE ST_DWithin(the_geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 0.005)
            ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) LIMIT 50;
        """), {"lon": req.current_lon, "lat": req.current_lat}).fetchall()
        
        if not raw_start_nodes:
            raise HTTPException(status_code=404, detail="주변 도로 데이터 없음")

        # 서로 100m (약 0.001도) 이상 떨어진 노드만 선별
        selected_start_nodes = []
        for node in raw_start_nodes:
            if len(selected_start_nodes) >= 5: break # 최대 5개 선택
            
            is_far_enough = True
            for selected in selected_start_nodes:
                # 유클리드 거리 근사치 비교 (0.001도 ≈ 100m)
                if get_dist((node.lon, node.lat), (selected.lon, selected.lat)) < 0.001:
                    is_far_enough = False
                    break
            
            if is_far_enough:
                selected_start_nodes.append(node)
        
        start_node_ids = [n.id for n in selected_start_nodes]
        print(f"🏃 선별된 시작점 {len(start_node_ids)}개 (서로 100m 이격): {start_node_ids}")

        # ★★★ 2. Round-Robin 탐색 ★★★
        TARGET_COLLECTION_SIZE = 10 
        search_rad = (one_way_target_km * 0.7) / 111.0 
        dijkstra_q = f"SELECT segment_id as id, source, target, length as cost FROM {ACTIVE_TABLE_NAME} WHERE path_id NOT IN {exclude_list_str}"

        for start_node in start_node_ids:
            if len(generated_routes) >= TARGET_COLLECTION_SIZE: break
            
            sectors = [(0, 120), (120, 240), (240, 360)]
            random.shuffle(sectors)
            path_found = False

            for min_d, max_d in sectors:
                if path_found: break 
                
                targets = conn.execute(text(f"""
                    SELECT v.id FROM {ACTIVE_TABLE_NAME}_vertices_pgr v
                    WHERE ST_DWithin(v.the_geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :rad) 
                      AND v.id != :start
                      AND degrees(ST_Azimuth(ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), v.the_geom)) BETWEEN :min_d AND :max_d
                    ORDER BY RANDOM() LIMIT 5;
                """), {"lon": req.current_lon, "lat": req.current_lat, "rad": search_rad, "start": start_node, "min_d": min_d, "max_d": max_d}).fetchall()
                
                target_ids = [r.id for r in targets]

                for t_node in target_ids:
                    if t_node in used_target_nodes: continue
                    try:
                        rows = conn.execute(text(f"""
                            SELECT ST_X(ST_StartPoint(b.geometry)) AS slon, ST_Y(ST_StartPoint(b.geometry)) AS slat, 
                                   ST_X(ST_EndPoint(b.geometry)) AS elon, ST_Y(ST_EndPoint(b.geometry)) AS elat,
                                   COALESCE(b.slope, 0) as slope, COALESCE(b.avg_altitude, 0) as elev, b.length as dist
                            FROM pgr_dijkstra($q${dijkstra_q}$q$, :start, :end, false) a
                            JOIN {ACTIVE_TABLE_NAME} b ON a.edge = b.segment_id ORDER BY a.seq;
                        """), {"start": start_node, "end": t_node}).fetchall()
                        
                        if not rows: continue
                        
                        dist_sum = sum([float(r.dist) for r in rows]) / 1000.0
                        if not (one_way_target_km * 0.5 <= dist_sum <= one_way_target_km * 1.5): continue 

                        full_path = []; full_slopes = []; full_elevs = []
                        full_path.append([float(rows[0].slon), float(rows[0].slat)])
                        for r in rows:
                            full_path.append([float(r.elon), float(r.elat)])
                            full_slopes.append(float(r.slope)); full_elevs.append(float(r.elev))
                        
                        full_path.extend(full_path[::-1][1:])
                        full_slopes.extend([-s for s in reversed(full_slopes)])
                        full_elevs.extend(list(reversed(full_elevs)))
                        
                        total_dist = dist_sum * 2
                        refined_slopes = clean_and_smooth_slopes(full_slopes)
                        pos_slopes = [s for s in refined_slopes if s > 0]
                        avg_slope = statistics.mean(pos_slopes) if pos_slopes else 0.0
                        
                        generated_routes.append({
                            "path": full_path, "total_distance": round(total_dist, 2),
                            "avg_slope": round(avg_slope, 2),
                            "slopes": refined_slopes, "elevations": full_elevs,
                            "voice_guides": generate_voice_guides(refined_slopes, total_dist)
                        })
                        used_target_nodes.add(t_node)
                        path_found = True
                        print(f"✅ 시작점({start_node}) 경로 확보!")
                        break 
                    except: continue

    if not generated_routes:
        raise HTTPException(status_code=404, detail="경로 탐색 실패")

    generated_routes.sort(key=lambda x: x["avg_slope"])
    final_features = []
    labels = ["Easy (완만)", "Normal (보통)", "Hard (도전)"]
    
    if len(generated_routes) >= 3:
        indices = [0, len(generated_routes)//2, -1]
        selected_routes = [generated_routes[i] for i in indices]
    else:
        selected_routes = generated_routes[:]
        while len(selected_routes) < 3: selected_routes.append(selected_routes[0])
    
    for i, r in enumerate(selected_routes):
        final_features.append(Feature(geometry=Geometry(coordinates=r["path"]), properties=Properties(
            label=labels[i], total_distance=r["total_distance"], avg_slope=r["avg_slope"],
            slopes=r["slopes"], elevations=r["elevations"], voice_guides=r["voice_guides"]
        )))

    print(f"🚀 최종 {len(final_features)}개 코스 반환 (Start Node 분산 적용)")
    return GeoJSONResponse(features=final_features)

if __name__ == "__main__":
    print("🚀 러닝 앱 서버 시작 (최종 완성)")
    uvicorn.run(app, host="0.0.0.0", port=8000)
