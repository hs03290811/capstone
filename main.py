import uvicorn
from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
import os
import json 
from pydantic import BaseModel 

# --- 1. 기본 설정 (★기존 코드 유지★) ---
DB_URL = "postgresql://postgres:nabxav-nithiC-2ronpo@capstone-db.caty68mm025l.us-east-1.rds.amazonaws.com:5432/postgres"
DB_TABLE_NAME = "segments_table"

try:
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        print("DB 연결 성공!")
except Exception as e:
    print(f"DB 연결 실패: {e}")
    engine = None

app = FastAPI()

# --- 2. Pydantic 모델 (★기존 코드 유지★) ---
class RouteRequest(BaseModel):
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float

class VoiceTrigger(BaseModel):
    lat: float
    lon: float
    message: str

class RouteResponse(BaseModel):
    total_distance_m: float
    total_time_min: float 
    coordinates: list[list[float]] 
    voice_triggers: list[VoiceTrigger]

# --- 3. DB 의존성 (★기존 코드 유지★) ---
def get_db():
    if engine is None:
        raise HTTPException(status_code=500, detail="DB 연결이 설정되지 않았습니다.")
    try:
        db = engine.connect()
        yield db
    finally:
        db.close()

# --- 4. API 엔드포인트(Endpoint) 정의 ---

# API 1, 2, 3 (health, test_db, segments_in_view) (★기존 코드 유지★)
@app.get("/health")
def read_health(): return {"status": "OK"}

@app.get("/test_db")
def test_db_connection(db=Depends(get_db)):
    try:
        query = text(f"SELECT segment_id, length, slope FROM {DB_TABLE_NAME} LIMIT 5")
        result = db.execute(query)
        rows = result.fetchall()
        data = [dict(row._mapping) for row in rows]
        if not data:
            return {"message": f"'{DB_TABLE_NAME}' 테이블에서 데이터를 찾을 수 없습니다."}
        return {"data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB 조회 오류: {e}")

@app.get("/segments_in_view")
def get_segments_in_view(min_lon: float, min_lat: float, max_lon: float, max_lat: float, db=Depends(get_db)):
    query = text("""
        SELECT segment_id, length, slope, ST_AsGeoJSON(geometry) AS geometry_geojson
        FROM segments_table
        WHERE geometry && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
        LIMIT 1000;
    """)
    try:
        result = db.execute(query, {
            "min_lon": min_lon, "min_lat": min_lat,
            "max_lon": max_lon, "max_lat": max_lat
        })
        rows = result.fetchall()
        data_list = [dict(row._mapping) for row in rows] 
        return {"data": data_list, "count": len(data_list)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BBOX 쿼리 오류: {e}")


# --- (★최종★) API 4: POST /api/recommend ---
@app.post("/api/recommend", response_model=RouteResponse)
def get_recommendation(request: RouteRequest, db=Depends(get_db)):
    
    # === 1단계: (Lat/Lon) -> 가장 가까운 정점(Vertex) ID 찾기 ===
    find_vertex_sql = """
        SELECT id
        FROM segments_table_vertices_pgr 
        ORDER BY
            the_geom <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)
        LIMIT 1;
    """
    try:
        start_node = db.execute(text(find_vertex_sql), 
                                {"lon": request.start_lon, "lat": request.start_lat}
                               ).scalar()
        end_node = db.execute(text(find_vertex_sql), 
                              {"lon": request.end_lon, "lat": request.end_lat}
                             ).scalar()

        if not start_node or not end_node:
            raise HTTPException(status_code=404, detail="경로의 시작/종료 노드를 찾을 수 없습니다.")
        print(f"경로 탐색 시작: Node {start_node} -> Node {end_node}")
    except Exception as e:
        print(f"[오류] 1단계 (정점 찾기): {e}")
        raise HTTPException(status_code=500, detail="[SQL 1] 정점 탐색 중 오류")

    
    # === 1.5단계: BBOX 좌표 계산 ===
    bbox_sql = """
        WITH nodes AS (
            SELECT the_geom FROM segments_table_vertices_pgr
            WHERE id IN (:start_node, :end_node)
        ),
        expanded_box AS (
            SELECT ST_Expand(ST_Collect(the_geom), 0.05) AS box FROM nodes
        )
        SELECT 
            ST_XMin(box) AS min_lon, ST_YMin(box) AS min_lat,
            ST_XMax(box) AS max_lon, ST_YMax(box) AS max_lat
        FROM expanded_box;
    """
    try:
        bbox_coords = db.execute(text(bbox_sql), {
            "start_node": start_node,
            "end_node": end_node
        }).fetchone()
        if not bbox_coords: raise Exception("BBOX 계산 실패")
    except Exception as e:
        print(f"[오류] 1.5단계 (BBOX 계산): {e}")
        raise HTTPException(status_code=500, detail="[SQL 1.5] BBOX 계산 중 오류")


    # === 2단계: pgr_dijkstra (★분기점 'cnt' 포함★) ===
    dijkstra_sql = """
        WITH
        path AS (
            SELECT * FROM pgr_dijkstra(
                'SELECT 
                    seg.segment_id AS id, 
                    seg.source, 
                    seg.target, 
                    seg.length AS cost 
                 FROM segments_table AS seg
                 WHERE seg.geometry && ST_MakeEnvelope(
                    :min_lon, :min_lat, :max_lon, :max_lat, 4326
                 )',
                :start_node, 
                :end_node,   
                directed := false 
            )
        ),
        path_segments AS (
            SELECT 
                p.seq, 
                p.node,
                -- (★핵심★) 'vertices' 테이블과 JOIN하여 'cnt' (연결된 도로 개수)를 가져옴
                v.cnt, 
                seg.segment_id, seg.slope, seg.length,
                ST_AsGeoJSON(seg.geometry) AS geom_json
            FROM path p
            JOIN segments_table seg ON p.edge = seg.segment_id
            -- (★핵심★) 'node' ID로 vertices 테이블과 JOIN
            JOIN segments_table_vertices_pgr v ON p.node = v.id
            ORDER BY p.seq
        )
        SELECT 
            *,
            LAG(slope, 1, 0) OVER (ORDER BY seq) AS prev_slope 
        FROM path_segments;
    """
    
    try:
        params = {
            "start_node": start_node, "end_node": end_node,
            "min_lon": bbox_coords.min_lon, "min_lat": bbox_coords.min_lat,
            "max_lon": bbox_coords.max_lon, "max_lat": bbox_coords.max_lat
        }
        results = db.execute(text(dijkstra_sql), params).fetchall()
        
        if not results:
            raise HTTPException(status_code=404, detail="경로를 찾을 수 없습니다 (No path found).")
            
    except HTTPException as e:
        raise e
    except Exception as e:
        print(f"[오류] 2단계 (다익스트라): {e}")
        raise HTTPException(status_code=500, detail="[SQL 2] 다익스트라 실행 중 오류")
        
    # === 3단계: 결과 처리 및 'voice_triggers' 생성 (★'분기점' 로직 추가★) ===
    coordinates = []      
    voice_triggers = []   
    total_distance_m = 0
    distance_checkpoint_m = 1000.0 
    
    print("--- 3단계: 경로 결과 처리 및 트리거 생성 시작 ---")

    for i, row in enumerate(results):
        # (★) row: (seq, node, cnt, segment_id, slope, length, geom_json, prev_slope)
        
        geom = json.loads(row.geom_json)
        segment_coords = geom['coordinates']
        
        if i == 0:
            coordinates.append(segment_coords[0]) 
            voice_triggers.append(VoiceTrigger(
                lat=segment_coords[0][1], lon=segment_coords[0][0],
                message="경로 안내를 시작합니다."
            ))
        coordinates.extend(segment_coords[1:])
        
        total_distance_m += row.length

        # (트리거 1) 경사도 급변 지점 (상한선 적용)
        if (row.slope > 10.0 and row.prev_slope < 5.0) and (row.slope < 30.0): 
            trigger = VoiceTrigger(
                lat=segment_coords[0][1], lon=segment_coords[0][0],
                message=f"잠시 후, 경사 {int(row.slope)}%의 오르막 구간입니다."
            )
            voice_triggers.append(trigger)
        
        # (★신규★) (트리거 2) 주요 분기점 (삼거리 이상)
        # (i > 0 : 출발지는 제외)
        if i > 0 and row.cnt is not None and row.cnt > 2:
            print(f"  [!] 주요 분기점(삼거리 이상) 감지! (Node: {row.node}, Cnt: {row.cnt})")
            trigger = VoiceTrigger(
                lat=segment_coords[0][1], lon=segment_coords[0][0],
                message="주요 분기점입니다. 경로를 확인하세요."
            )
            voice_triggers.append(trigger)

        # (트리거 3) 거리 분기점 (1km, 2km...)
        if total_distance_m >= distance_checkpoint_m:
            trigger = VoiceTrigger(
                lat=segment_coords[0][1], lon=segment_coords[0][0],
                message=f"{int(distance_checkpoint_m/1000)}km 지점을 통과했습니다."
            )
            voice_triggers.append(trigger)
            distance_checkpoint_m += 1000.0 
            
    if coordinates:
        last_coord = coordinates[-1]
        voice_triggers.append(VoiceTrigger(
            lat=last_coord[1], lon=last_coord[0],
            message="목적지에 도착했습니다."
        ))

    total_time_min = (total_distance_m / 1000) / 4.0 * 60 # (시속 4km/h 기준)

    return RouteResponse(
        total_distance_m=total_distance_m,
        total_time_min=total_time_min,
        coordinates=coordinates,
        voice_triggers=voice_triggers
    )

# --- 5. (필수) 서버 실행 (★기존 코드 유지★) ---
if __name__ == "__main__":
    print("FastAPI 서버를 8000번 포트에서 시작합니다.")
    print("Postman에서 http://(EC2 공용 IP):8000/health 로 테스트하세요.")
    uvicorn.run(app, host="0.0.0.0", port=8000)
