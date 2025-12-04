import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy import create_engine, text
from starlette.middleware.cors import CORSMiddleware
import random
import statistics
import math
import time

# ==========================================
# 1. 설정 및 DB 연결
# ==========================================
DB_URL = "postgresql://postgres:nabxav-nithiC-2ronpo@capstone-db.caty68mm025l.us-east-1.rds.amazonaws.com:5432/postgres"
ACTIVE_TABLE_NAME = "segments_table_loose" 
EXCLUDE_PATH_IDS = ['292097278', '292097273', '1054159545', '1021630677', '1021630678'] 

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
def calculate_bearing(lat1, lon1, lat2, lon2):
    # 두 좌표 간의 방위각(0~360도) 계산
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dLon = lon2 - lon1
    y = math.sin(dLon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dLon)
    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360) % 360

def clean_and_smooth_slopes(slopes: List[float]) -> List[float]:
    capped = [min(abs(s), 20.0) if s >= 0 else max(s, -20.0) for s in slopes]
    smoothed = []
    for i in range(len(capped)):
        start = max(0, i - 1); end = min(len(capped), i + 2)
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

# ==========================================
# 4. API 엔드포인트
# ==========================================
@app.post("/api/recommend", response_model=GeoJSONResponse)
def recommend_course(req: GPSRequest):
    start_time = time.time()
    if not engine: raise HTTPException(status_code=500, detail="DB 연결 안됨")
    
    target_km = req.target_km if req.target_km else 3.0
    one_way_target_km = target_km / 2.0 
    
    print(f"📍 요청: {req.current_lat}, {req.current_lon} / 목표: {target_km}km")
    
    exclude_list_str = "('" + "','".join(map(str, EXCLUDE_PATH_IDS)) + "')"
    
    with engine.connect() as conn:
        # 1. 시작점: 가장 가까운 노드 1개만 확실하게 잡음 (속도 UP & 기준점 통일)
        start_node_row = conn.execute(text(f"""
            SELECT id, ST_Y(the_geom) as lat, ST_X(the_geom) as lon 
            FROM {ACTIVE_TABLE_NAME}_vertices_pgr 
            ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) LIMIT 1;
        """), {"lon": req.current_lon, "lat": req.current_lat}).fetchone()
        
        if not start_node_row: raise HTTPException(status_code=404, detail="도로 데이터 없음")
        start_node = start_node_row.id
        start_lat, start_lon = start_node_row.lat, start_node_row.lon

        # 2. 경로 탐색: 360도 전방위에서 후보 30개 난사 (일단 많이 모음)
        # SQL에서 각도 제한을 하지 않고 랜덤으로 많이 가져온 뒤 파이썬에서 거름
        search_rad = (one_way_target_km * 0.7) / 111.0 
        
        targets = conn.execute(text(f"""
            SELECT v.id FROM {ACTIVE_TABLE_NAME}_vertices_pgr v
            WHERE ST_DWithin(v.the_geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :rad) 
              AND v.id != :start
            ORDER BY RANDOM() LIMIT 30;
        """), {"lon": req.current_lon, "lat": req.current_lat, "rad": search_rad, "start": start_node}).fetchall()
        
        target_ids = [r.id for r in targets]
        dijkstra_q = f"SELECT segment_id as id, source, target, length as cost FROM {ACTIVE_TABLE_NAME} WHERE path_id NOT IN {exclude_list_str}"

        # 수집 단계 (Filtering 없이 일단 유효한 경로 다 모음)
        candidates = []
        for t_node in target_ids:
            if len(candidates) >= 15: break # 최대 15개까지만 찾고 그중에서 고름 (속도 제한)
            
            try:
                # 편도 경로 탐색
                path_rows = conn.execute(text(f"""
                    SELECT ST_X(ST_StartPoint(b.geometry)) AS slon, ST_Y(ST_StartPoint(b.geometry)) AS slat, 
                           ST_X(ST_EndPoint(b.geometry)) AS elon, ST_Y(ST_EndPoint(b.geometry)) AS elat,
                           COALESCE(b.slope, 0) as slope, COALESCE(b.avg_altitude, 0) as elev, b.length as dist
                    FROM pgr_dijkstra($q${dijkstra_q}$q$, :start, :end, false) a
                    JOIN {ACTIVE_TABLE_NAME} b ON a.edge = b.segment_id ORDER BY a.seq;
                """), {"start": start_node, "end": t_node}).fetchall()
                
                if not path_rows: continue
                
                dist_sum = sum([float(r.dist) for r in path_rows]) / 1000.0
                if not (one_way_target_km * 0.5 <= dist_sum <= one_way_target_km * 1.5): continue 

                # 반환점 좌표 (마지막 포인트)
                turn_lat = float(path_rows[-1].elat)
                turn_lon = float(path_rows[-1].elon)
                
                # ★ 방위각(각도) 계산 (시작점 -> 반환점) ★
                bearing = calculate_bearing(start_lat, start_lon, turn_lat, turn_lon)

                # 데이터 조립
                full_path = []; full_slopes = []; full_elevs = []
                full_path.append([float(path_rows[0].slon), float(path_rows[0].slat)])
                for r in path_rows:
                    full_path.append([float(r.elon), float(r.elat)])
                    full_slopes.append(float(r.slope)); full_elevs.append(float(r.elev))
                
                full_path.extend(full_path[::-1][1:])
                full_slopes.extend([-s for s in reversed(full_slopes)])
                full_elevs.extend(list(reversed(full_elevs)))
                
                refined = clean_and_smooth_slopes(full_slopes)
                pos_slopes = [s for s in refined if s > 0]
                avg_slope = statistics.mean(pos_slopes) if pos_slopes else 0.0
                
                candidates.append({
                    "path": full_path, "total_distance": round(dist_sum * 2, 2),
                    "avg_slope": round(avg_slope, 2), "bearing": bearing, # 각도 저장
                    "slopes": refined, "elevations": full_elevs,
                    "voice_guides": generate_voice_guides(refined, dist_sum * 2)
                })
                
            except: continue

    if not candidates:
        raise HTTPException(status_code=404, detail="경로 탐색 실패")

    # ★★★ 3. 각도(Angle) 기반 중복 제거 (핵심 로직) ★★★
    # 경사도 순으로 정렬 (난이도 확보를 위해)
    candidates.sort(key=lambda x: x["avg_slope"])
    
    final_selection = []
    
    # 첫 번째(가장 쉬운 것)는 무조건 선택
    final_selection.append(candidates[0])
    
    # 나머지 중에서 각도 차이가 30도 이상 나는 것만 선택
    for cand in candidates[1:]:
        if len(final_selection) >= 3: break
        
        is_distinct_direction = True
        for selected in final_selection:
            # 두 각도의 차이 계산 (0~180도)
            diff = abs(cand["bearing"] - selected["bearing"])
            if diff > 180: diff = 360 - diff
            
            # 각도 차이가 30도 미만이면 "같은 방향"으로 간주하고 탈락
            if diff < 30: 
                is_distinct_direction = False
                break
        
        if is_distinct_direction:
            final_selection.append(cand)
            
    # 부족하면 채우기 (어쩔 수 없음, 하지만 최대한 다른 걸로)
    if len(final_selection) < 3:
        remaining = [c for c in candidates if c not in final_selection]
        for r in remaining:
            if len(final_selection) >= 3: break
            final_selection.append(r)
            
    while len(final_selection) < 3: final_selection.append(final_selection[0])
    
    # 최종 정렬 (Easy -> Hard)
    final_selection.sort(key=lambda x: x["avg_slope"])
    
    features = []
    labels = ["Easy (완만)", "Normal (보통)", "Hard (도전)"]
    for i, r in enumerate(final_selection):
        features.append(Feature(geometry=Geometry(coordinates=r["path"]), properties=Properties(
            label=labels[i], total_distance=r["total_distance"], avg_slope=r["avg_slope"],
            slopes=r["slopes"], elevations=r["elevations"], voice_guides=r["voice_guides"]
        )))

    print(f"🚀 최종 {len(features)}개 코스 반환 (각도 필터링 완료 / {time.time()-start_time:.2f}초)")
    return GeoJSONResponse(features=features)

if __name__ == "__main__":
    print("🚀 러닝 앱 서버 시작 (최종 완성)")
    uvicorn.run(app, host="0.0.0.0", port=8000)
