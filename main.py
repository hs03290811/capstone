import uvicorn
from fastapi import FastAPI, HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
import os
from dotenv import load_dotenv # (★추가★) 환경 변수 로더

# (★추가★) .env 파일에서 환경 변수를 읽어옴 (로컬 테스트용)
load_dotenv()

# --- 1. 기본 설정 ---

# (★수정★) 비밀번호를 "환경 변수"에서 읽어옴
DB_USER = os.environ.get("DB_USER")
DB_PASSWORD = os.environ.get("DB_PASSWORD")
DB_HOST = os.environ.get("DB_HOST")
DB_PORT = os.environ.get("DB_PORT", 5432) # 기본값 5432
DB_NAME = os.environ.get("DB_NAME")
DB_TABLE_NAME = "segments_table" # (이건 Git에 있어도 됨)

# DB_URL 조합
if not all([DB_USER, DB_PASSWORD, DB_HOST, DB_NAME]):
    print("경고: DB 환경 변수가 설정되지 않았습니다. API가 DB에 연결되지 않을 수 있습니다.")
    # (로컬 테스트를 위해 기존 값 fallback - 이 부분은 Git에 올리기 전에 지우는 게 좋음)
    # DB_URL = "postgresql://postgres:nabxav-nithiC-2ronpo@capstone-db.caty68mm025l.us-east-1.rds.amazonaws.com:5432/postgres"
    DB_URL = None # 환경 변수가 없으면 DB 연결 안 함
else:
    DB_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# SQLAlchemy 연결 엔진 생성
try:
    if DB_URL:
        engine = create_engine(DB_URL)
        # 프로그램 시작 시 DB 연결 테스트
        with engine.connect() as conn:
            print("DB 연결 성공!")
    else:
        print("DB 연결 정보 없음 (환경 변수 누락). DB 연결을 건너뜁니다.")
        engine = None
except OperationalError as e:
    print(f"DB 연결 실패: {e}")
    print(f"DB_HOST '{DB_HOST}'에 연결할 수 없습니다. RDS 상태와 보안 그룹을 확인하세요.")
    engine = None
except Exception as e:
    print(f"알 수 없는 연결 오류: {e}")
    engine = None


# FastAPI 앱(서버) 생성
app = FastAPI()

# ... (파일의 나머지 부분은 동일) ...
# (@app.get("/health") ...)
# (@app.get("/test_db") ...)
# (@app.get("/segments_in_view") ...)
# (if __name__ == "__main__": ...)

# API 1: GET /health (서버 상태 체크)
@app.get("/health")
def read_health():
    """
    서버가 정상적으로 실행 중인지 확인하는 'Health Check' 엔드포인트입니다.
    {"status": "OK"}를 반환합니다.
    """
    return {"status": "OK"}

# API 2: GET /test_db (Postman DB 조회 테스트용)
@app.get("/test_db")
def test_db_connection():
    """
    PostGIS DB에 연결하여 'segments_table'의
    샘플 데이터 5개를 조회하고 반환합니다.
    DB 연결 및 데이터 적재 테스트용입니다.
    """
    if engine is None:
        raise HTTPException(status_code=500, detail="DB 연결이 설정되지 않았습니다. 서버 로그를 확인하세요.")

    try:
        with engine.connect() as connection:
            # PostGIS의 geometry를 GeoJSON 텍스트로 변환하는 쿼리
            query = text(f"""
                SELECT
                    segment_id,
                    path_id,
                    length,
                    slope,
                    ST_AsGeoJSON(geometry) AS geometry_geojson
                FROM {DB_TABLE_NAME}
                LIMIT 5
            """)

            result = connection.execute(query)
            rows = result.fetchall()

            # 결과를 JSON 친화적인 dict 리스트로 변환
            data = [
                {
                    "segment_id": row.segment_id,
                    "path_id": row.path_id,
                    "length": row.length,
                    "slope": row.slope,
                    "geometry_geojson": row.geometry_geojson # GeoJSON 텍스트
                } for row in rows
            ]

            if not data:
                # 테이블은 있으나 데이터가 없는 경우
                return {"message": f"'{DB_TABLE_NAME}' 테이블에서 데이터를 찾을 수 없습니다."}

            return {"data": data}

    except Exception as e:
        # (예: 'segments_table'이 아직 없는 경우)
        raise HTTPException(status_code=500, detail=f"DB 조회 오류: {e}")

# --- 3. (진짜 API) 지도 BBOX(사각형) 안의 세그먼트 조회 ---
@app.get("/segments_in_view")
def get_segments_in_view(
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float
):
    """
    지도 화면(BBOX) 안의 세그먼트를 조회합니다.
    PostGIS의 공간 인덱스(GIST)를 사용하여 매우 빠릅니다.
    """
    if not engine:
        raise HTTPException(status_code=500, detail="DB 연결 실패 (서버 로그 확인)")

    # (★보안★) SQL Injection을 막기 위해 쿼리와 파라미터를 분리합니다.
    query = text("""
        SELECT
            segment_id,
            path_id,
            length,
            slope,
            ST_AsGeoJSON(geometry) AS geometry_geojson
        FROM segments_table
        WHERE geometry && ST_MakeEnvelope(
            :min_lon, :min_lat,
            :max_lon, :max_lat,
            4326
        )
        LIMIT 1000;
    """)

    try:
        with engine.connect() as conn:
            result = conn.execute(query, {
                "min_lon": min_lon,
                "min_lat": min_lat,
                "max_lon": max_lon,
                "max_lat": max_lat
            })
            rows = result.fetchall()

        # 결과를 JSON 리스트로 변환
        data_list = []
        for row in rows:
            data_list.append({
                "segment_id": row.segment_id,
                "path_id": row.path_id,
                "length": row.length,
                "slope": row.slope,
                "geometry_geojson": row.geometry_geojson
            })

        # (성공) 찾은 데이터와 개수를 반환
        return {"data": data_list, "count": len(data_list)}

    except Exception as e:
        print(f"BBOX 쿼리 오류: {e}")
        raise HTTPException(status_code=500, detail=f"BBOX 쿼리 오류: {e}")


# --- 4. (필수) 서버 실행 ---
# (★수정됨★) 이 블록이 "맨 마지막"으로 이동했습니다.
# 이렇게 해야 FastAPI가 위의 모든 API를 '등록'한 후 서버를 켭니다.
if __name__ == "__main__":
    if engine is None:
        print("DB 엔진이 초기화되지 않아 서버를 시작할 수 없습니다.")
        print("DB_USER, DB_PASSWORD, DB_HOST, DB_NAME 환경 변수를 확인하세요.")
    else:
        print("FastAPI 서버를 8000번 포트에서 시작합니다.")
        print(f"Postman에서 http://(EC2 공용 IP):8000/health 로 테스트하세요.")
        # host="0.0.0.0"은 localhost뿐만 아니라 외부 접속(EC2 공용 IP)도 허용
        uvicorn.run(app, host="0.0.0.0", port=8000)