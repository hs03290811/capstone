import os
import geopandas as gpd
from sqlalchemy import create_engine
import time

# --- 1. 기본 설정 (사용자 경로에 맞게 수정됨) ---

# (수정 1) 경로의 띄어쓰기 제거 ("/CAU/ capstone" -> "/CAU/capstone")
#BASE_DIR = "/Users/peachee/Desktop/CAU/capstone/source"
#SAVED_FILE_PATH = os.path.join(BASE_DIR, "processed_segments.gpkg")
# (B) EC2 경로 (새로 추가)
# (뜻: "이 스크립트와 '같은 폴더'에 있는 파일을 찾아라")
SAVED_FILE_PATH = "processed_segments.gpkg"

# (수정 2) DB_URL을 Homebrew 기본 설정(사용자명 peachee, 비번 없음)으로 변경
# 'postgres:password'는 기본값이 아닙니다.
DB_URL = "postgresql://postgres:nabxav-nithiC-2ronpo@capstone-db.caty68mm025l.us-east-1.rds.amazonaws.com:5432/postgres"
DB_TABLE_NAME = "segments_table"

print(f"'{SAVED_FILE_PATH}'에서 처리된 데이터 로드 중...")

# --- 2. 저장된 파일 로드 ---
try:
    start_load = time.time()
    # 'layer' 파라미터는 run_preprocessing.py에서 저장할 때 사용한 이름과 같아야 함
    processed_gdf = gpd.read_file(SAVED_FILE_PATH, layer="segments")
    end_load = time.time()
    print(f"로드 성공: {len(processed_gdf)}개의 세그먼트 (소요 시간: {end_load - start_load:.2f}초)")
except Exception as e:
    print(f"파일 로드 오류: {e}")
    print(f"'{SAVED_FILE_PATH}' 파일이 존재하는지 확인하세요.")
    print("오류가 계속되면 'run_preprocessing.py'를 다시 실행하여 gpkg 파일을 생성해야 할 수 있습니다.")
    exit() # 스크립트 중단

# --- 3. PostGIS DB에 적재 (5단계) ---
print(f"\n[5단계] PostGIS에 데이터 적재 중 (테이블: {DB_TABLE_NAME})...")
try:
    engine = create_engine(DB_URL)
    
    start_db = time.time()
    # .gpkg에서 읽을 때 'geometry' 컬럼명은 이미 올바릅니다.
    processed_gdf.to_postgis(
        name=DB_TABLE_NAME,
        con=engine,
        if_exists='replace',   # 'replace': 기존 테이블 덮어쓰기 / 'append': 추가하기
        index=False,
        schema='public',       # 'public' 스키마에 저장
        chunksize=1000         # 1000개씩 나눠서 DB에 넣기 (대용량 데이터 메모리 관리)
    )
    end_db = time.time()
    print("데이터베이스 적재 완료!")
    print(f"총 소요 시간: {end_db - start_db:.2f}초")

except Exception as e:
    print(f"데이터베이스 연결 또는 적재 오류: {e}")
    print(f"DB_URL이 올바른지 확인하세요: {DB_URL}")
    print("PostgreSQL 서버가 실행 중인지 확인하세요 (brew services start postgresql@17)")

print("모든 작업 완료.")
