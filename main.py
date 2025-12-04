import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from sqlalchemy import create_engine, text
from starlette.middleware.cors import CORSMiddleware
import random
import statistics

# main.py 파일 상단에 추가

app = FastAPI()

@app.get("/")
def read_root():
    return {"Hello": "Server is running"}

# --- 1. DB 연결 설정 ---
# 비밀번호, 주소 확인 필수!
DB_URL = "postgresql://postgres:nabxav-nithiC-2ronpo@capstone-db.caty68mm025l.us-east-1.rds.amazonaws.com:5432/postgres"

try:
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        print("✅ DB 연결 성공!")
except Exception as e:
    print(f"❌ DB 연결 실패: {e}")
    engine = None

app = FastAPI()

# CORS 설정 (앱 통신 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 2. 데이터 모델 정의 ---
EXCLUDE_PATH_IDS = ['292097278', '292097273', '1054159545', '1021630677', '1021630678']
# [Input] GPS 요청
class GPSRequest(BaseModel):
    current_lat: float
    current_lon: float
    target_km: Optional[float] = 3.0 

# [Output] GeoJSON 내부 구조
class VoiceGuide(BaseModel):
    index: int          # 경로 상의 좌표 인덱스 (몇 번째 점인지)
    message: str        # 읽어줄 텍스트 (예: "오르막 시작입니다")

class Properties(BaseModel):
    label: str                # Easy, Normal, Hard
    total_distance: float     # 총 거리 (m)
    avg_slope: float          # 평균 경사도 (%)
    slopes: List[float]       # 구간별 경사도 배열 (그래프용)
    elevations: List[float]   # 구간별 고도 배열 (그래프용)
    voice_guides: List[VoiceGuide] # ★ TTS 음성 안내 트리거

class Geometry(BaseModel):
    type: str = "LineString"
    coordinates: List[List[float]] # [[경도, 위도], ...]

class Feature(BaseModel):
    type: str = "Feature"
    geometry: Geometry
    properties: Properties

class GeoJSONResponse(BaseModel):
    type: str = "FeatureCollection"
    features: List[Feature]

# --- 3. 핵심 로직 함수 ---

def generate_voice_guides(slopes: List[float], total_dist: float) -> List[VoiceGuide]:
    """
    경사도 배열을 분석하여 오르막/내리막 시작 지점에 음성 안내를 생성합니다.
    """
    guides = []
    
    # 1. 시작 안내
    guides.append(VoiceGuide(index=0, message="러닝을 시작합니다. 안전에 유의하세요."))
    
    # 2. 경사도 변화 감지 (5% 이상 오르막, -5% 이하 내리막)
    state = "flat" # flat, up, down
    
    for i, s in enumerate(slopes):
        if i == 0: continue
        
        # 너무 잦은 안내 방지 (최소 100m 간격 등 로직 추가 가능)
        if s >= 5.0 and state != "up":
            guides.append(VoiceGuide(index=i, message="전방에 오르막 구간입니다. 호흡을 조절하세요."))
            state = "up"
        elif s <= -5.0 and state != "down":
            guides.append(VoiceGuide(index=i, message="내리막 구간입니다. 무릎 충격에 주의하세요."))
            state = "down"
        elif -3.0 < s < 3.0 and state != "flat":
            state = "flat" # 평지로 복귀

    # 3. 중간/종료 안내 (좌표 개수 기준 대략적 위치)
    mid_idx = len(slopes) // 2
    guides.append(VoiceGuide(index=mid_idx, message="반환점을 지났습니다. 조금만 더 힘내세요!"))
    guides.append(VoiceGuide(index=len(slopes)-1, message="목적지에 도착했습니다. 수고하셨습니다."))
    
    return guides

# --- 4. API 엔드포인트 ---

@app.post("/api/recommend", response_model=GeoJSONResponse)
def recommend_course(req: GPSRequest):
    """
    GPS 좌표 기반 순환형 코스 3개 추천 (TTS 안내 포함)
    """
    if not engine:
        raise HTTPException(status_code=500, detail="DB 연결 안됨")

    print(f"📍 요청 수신: {req.current_lat}, {req.current_lon}")
    
    generated_routes = []

# recommend_course 함수 내부의 with 블록
# --- main.py 파일 내, recommend_course 함수 내부 수정 ---

    with engine.connect() as conn:
        # 1. 시작 노드 찾기
        # ... (start_node_sql 실행) ...
        start_node = conn.execute(start_node_sql, {"lon": req.current_lon, "lat": req.current_lat}).scalar()
        
        # [VERY IMPORTANT] 시작 노드가 있어야 후보군을 찾으므로, start_node를 파라미터로 넘깁니다.
        if not start_node:
             raise HTTPException(status_code=404, detail="주변에 도로 데이터가 없습니다.")

        # 2. ★★★ 목적지 후보군 생성 SQL (최종 수정) ★★★
        # vertices 테이블과 components 테이블을 JOIN하여 Component 1에 속한 노드만 선택합니다.
        target_candidates_sql = text(f"""
            SELECT v.id 
            FROM segments_table_vertices_pgr v
            -- 컴포넌트 테이블과 JOIN하여 소속 확인
            JOIN segments_table_components c ON v.id = c.node 
            WHERE ST_DWithin(v.the_geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 0.027) 
              AND c.component = 1                             -- 최대 연결 요소 (Component 1) 필터
              AND v.id != :start_node_id                      -- 시작 노드와 겹치지 않게 제외
            ORDER BY RANDOM()
            LIMIT 10;
        """)
        
        # 쿼리 실행 (파라미터에 start_node_id 추가)
        targets = conn.execute(target_candidates_sql, {
            "lon": req.current_lon, 
            "lat": req.current_lat,
            "start_node_id": start_node # 시작 노드 ID를 파라미터로 전달
        }).fetchall()
        
        target_ids = [row.id for row in targets]
        
        # ... (나머지 로직은 그대로 유지) ...
        print(f"🛣️ 2. 목적지 후보군 수: {len(target_ids)} 개")
        
        # 후보가 부족할 경우를 대비한 안전장치
        while len(target_ids) < 10:
            target_ids.append(start_node + random.randint(50, 500))

        # ---------------------------------------------------------
        # 3. 경로 생성 및 데이터 추출
        # ---------------------------------------------------------
        # 다익스트라: 좌표, 경사도(slope), 고도(avg_altitude) 가져오기

# --- main.py 파일 내, path_sql 쿼리 수정 (Component 필터링 적용) ---

# --- main.py 파일 내, path_sql 쿼리 수정 (Component 필터링 적용) ---

        for t_node in target_ids:
            if len(generated_routes) >= 3: break

            path_sql = text(f"""
                SELECT 
                    ST_Y(ST_StartPoint(b.geometry)) AS lat, 
                    ST_X(ST_StartPoint(b.geometry)) AS lon, 
                    COALESCE(b.slope, 0) as slope,
                    COALESCE(b.avg_altitude, 0) as elev,
                    b.length as dist
                FROM pgr_dijkstra(
                    'SELECT 
                        s.segment_id AS id, 
                        s.source, 
                        s.target, 
                        s.length AS cost 
                    FROM segments_table s
                    JOIN segments_table_components c ON s.segment_id = c.id
                    -- ★★★ 핵심 필터: Component ID 1 내에서만 경로 탐색 ★★★
                    WHERE c.component = 1 AND s.path_id NOT IN (''' + ''','''.join(EXCLUDE_PATH_IDS) + ''')',
                    :start, :end, false
                ) a
                JOIN segments_table b ON a.edge = b.segment_id
                ORDER BY a.seq;
            """)
            
            # ... (나머지 로직은 그대로 유지) ...


            # ... (나머지 로직은 그대로 유지) ...

            # 12 spaces
            try:
                rows = conn.execute(path_sql, {"start": start_node, "end": t_node}).fetchall()
            except Exception:
                # 16 spaces
                print(f"⚠️ TARGET {t_node} - DB 쿼리 실패 (SQL 에러 가능성)")
                continue 
            
            # 12 spaces
            if not rows:
                # 16 spaces (에러가 발생했던 바로 그 라인)
                print(f"❌ 3. Target {t_node} - 경로 탐색 실패 (단절 노드 가능성)")
                continue
            
            # 12 spaces
            path_list = [] # [[경도, 위도], ...]
            slope_list = []
            elev_list = []
            total_dist = 0.0
            
            # 12 spaces
            for r in rows:
                # 16 spaces
                path_list.append([float(r.lon), float(r.lat)])
                slope_list.append(float(r.slope))
                elev_list.append(float(r.elev))
                total_dist += float(r.dist)

            # 12 spaces
            if path_list and path_list[0] != path_list[-1]:
                # 16 spaces
                path_list.append(path_list[0])
                slope_list.append(0.0)
                elev_list.append(elev_list[0])

            # 12 spaces
            avg_slope = statistics.mean([abs(s) for s in slope_list]) if slope_list else 0
            refined_slopes = clean_and_smooth_slopes(slope_list)
            voice_guides = generate_voice_guides(refined_slopes, total_dist)

            # 12 spaces
            generated_routes.append({
                "path": path_list,
                "slopes": refined_slopes, 
                "elevations": elev_list,
                "total_distance": round(total_dist, 2),
                "avg_slope": round(avg_slope, 2),
                "voice_guides": voice_guides
            })

    if not generated_routes:
        raise HTTPException(status_code=404, detail="경로를 찾을 수 없습니다.")

    # ---------------------------------------------------------
    # 4. 응답 생성 (GeoJSON FeatureCollection)
    # ---------------------------------------------------------
    # 경사도 순으로 정렬 (Easy -> Normal -> Hard)
    generated_routes.sort(key=lambda x: x["avg_slope"])

    features = []
    labels = ["Easy (완만)", "Normal (보통)", "Hard (도전)"]
    
    for i, route in enumerate(generated_routes):
        if i >= 3: break
        
        feature = Feature(
            geometry=Geometry(coordinates=route["path"]),
            properties=Properties(
                label=labels[i],
                total_distance=route["total_distance"],
                avg_slope=route["avg_slope"],
                slopes=route["slopes"],          # 그래프용
                elevations=route["elevations"],  # 그래프용
                voice_guides=route["voice_guides"] # TTS용
            )
        )
        features.append(feature)

    print(f"✅ 추천 완료: {len(features)}개 코스 (평균경사도: {[f.properties.avg_slope for f in features]})")

    return GeoJSONResponse(features=features)

if __name__ == "__main__":
    print("🚀 러닝 앱 서버 시작 (TTS 포함)")
    uvicorn.run(app, host="0.0.0.0", port=8000)
