import os
import geopandas as gpd
import fiona
from sqlalchemy import create_engine
import time
from dotenv import load_dotenv # (★추가★) 환경 변수 로더

# (★추가★) .env 파일에서 환경 변수를 읽어옴 (로컬 테스트용)
load_dotenv()

# --- 1. 기본 설정 (EC2 경로) ---
SAVED_FILE_PATH = "processed_segments.gpkg"

# (★수정★) 비밀번호를 "환경 변수"에서 읽어옴
# (Git에 "절대" 올라가면 안 되는 민감 정보)
DB_USER = os.environ.get("DB_USER")
DB_PASSWORD = os.environ.get("DB_PASSWORD")
DB_HOST = os.environ.get("DB_HOST")
DB_PORT = os.environ.get("DB_PORT", 5432) # 기본값 5432
DB_NAME = os.environ.get("DB_NAME")

# DB_URL 조합
if not all([DB_USER, DB_PASSWORD, DB_HOST, DB_NAME]):
    print("오류: DB_USER, DB_PASSWORD, DB_HOST, DB_NAME 환경 변수를 설정해야 합니다.")
    # (로컬 테스트를 위해 기존 값 fallback - 이 부분은 Git에 올리기 전에 지우는 게 좋음)
    # DB_URL = "postgresql://postgres:nabxav-nithiC-2ronpo@capstone-db.caty68mm025l.us-east-1.rds.amazonaws.com:5432/postgres"
    exit(1) # 환경 변수가 없으면 스크립트 중단

DB_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
DB_TABLE_NAME = "segments_table"
CHUNK_SIZE = 500000

print(f"'{SAVED_FILE_PATH}'에서 처리된 데이터 청크(chunk) 로드 시작...")
print(f"대상 DB: {DB_TABLE_NAME}")

try:
    # --- 2. DB 엔진 연결 ---
    engine = create_engine(DB_URL)
    print("DB 엔진 연결 성공.")

    # ... (파일의 나머지 부분은 동일) ...
    # (fiona.open(SAVED_FILE_PATH, 'r') as source: ...)
    # (... for feature in source: ...)
    # (... gdf_chunk.to_postgis(...) ...)

# (★참고★) fiona, geopandas 등을 `pip install python-dotenv`도 필요합니다.

    with fiona.open(SAVED_FILE_PATH, 'r') as source:
        
        print(f"총 {len(source)}개의 세그먼트 발견. {CHUNK_SIZE}개씩 분할 적재 시작...")
        
        chunk = []  # 현재 청크를 담을 리스트
        chunk_counter = 0
        is_first_chunk = True

        # 4687만 개 피처를 하나씩 순회
        for feature in source:
            chunk.append(feature)
            
            # 현재 청크가 목표 사이즈(CHUNK_SIZE)에 도달하면
            if len(chunk) == CHUNK_SIZE:
                chunk_counter += 1
                start_chunk_time = time.time()
                print(f"  > 청크 {chunk_counter} ({len(chunk)}개) 처리 중...")
                
                # 리스트(chunk)를 GeoDataFrame으로 변환 (이때만 메모리 사용)
                gdf_chunk = gpd.GeoDataFrame.from_features(chunk, crs=source.crs)
                
                # GeoDataFrame을 PostGIS에 적재
                if is_first_chunk:
                    # 첫 번째 청크는 테이블을 '생성(replace)'
                    gdf_chunk.to_postgis(
                        name=DB_TABLE_NAME,
                        con=engine,
                        if_exists='replace',  # ★★★
                        index=False,
                        schema='public'
                    )
                    is_first_chunk = False
                else:
                    # 두 번째부터는 테이블에 '추가(append)'
                    gdf_chunk.to_postgis(
                        name=DB_TABLE_NAME,
                        con=engine,
                        if_exists='append',   # ★★★
                        index=False,
                        schema='public'
                    )
                
                chunk = []  # 현재 청크 리스트 비우기 (메모리 확보)
                end_chunk_time = time.time()
                print(f"  > 청크 {chunk_counter} 적재 완료! (소요 시간: {end_chunk_time - start_chunk_time:.2f}초)")

        # --- 4. 마지막 남은 청크 처리 ---
        if chunk:  # 50만 개가 안 되는 마지막 꼬투리 처리
            chunk_counter += 1
            print(f"  > 마지막 청크 {chunk_counter} ({len(chunk)}개) 처리 중...")
            gdf_chunk = gpd.GeoDataFrame.from_features(chunk, crs=source.crs)
            
            # (첫 번째 청크가 50만 개 미만인 경우도 있으므로 is_first_chunk 체크)
            if_exists_mode = 'replace' if is_first_chunk else 'append'
            
            gdf_chunk.to_postgis(
                name=DB_TABLE_NAME,
                con=engine,
                if_exists=if_exists_mode,
                index=False,
                schema='public'
            )
            print("  > 마지막 청크 적재 완료!")

    end_total_time = time.time()
    print("\n[5단계] PostGIS에 모든 데이터 적재 완료!")
    print(f"총 소요 시간: {end_total_time - start_total_time:.2f}초")

except Exception as e:
    print(f"\n데이터베이스 연결 또는 적재 오류: {e}")
    # (이제 DB_URL이 아닌 DB_HOST를 출력)
    print(f"DB_HOST '{DB_HOST}'에 연결할 수 없습니다. 환경 변수를 확인하세요.")

print("모든 작업 완료.")