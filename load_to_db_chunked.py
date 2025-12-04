import os
import geopandas as gpd
import fiona
from sqlalchemy import create_engine
import time
from dotenv import load_dotenv # 환경 변수 로더

# .env 파일에서 환경 변수를 읽어옴
load_dotenv() 

print("--- [Phase 1 수정] '서울시' 데이터만 필터링하여 적재 시작 ---")

# --- 1. 기본 설정 (★ 사용자가 수정/확인 ★) ---
SAVED_FILE_PATH = "processed_segments.gpkg" 
FILTER_COLUMN = "CTY_NM" 
FILTER_VALUE = "서울특별시"

DB_TABLE_NAME = "segments_table"
CHUNK_SIZE = 500000 
# ---------------------------------------------


# DB_URL 조합 (사용자님의 설정 기반)
DB_USER = os.environ.get("DB_USER")
DB_PASSWORD = os.environ.get("DB_PASSWORD")
DB_HOST = os.environ.get("DB_HOST")
DB_PORT = os.environ.get("DB_PORT", 5432) 
DB_NAME = os.environ.get("DB_NAME")

if not all([DB_USER, DB_PASSWORD, DB_HOST, DB_NAME]):
    print("오류: DB_USER, DB_PASSWORD, DB_HOST, DB_NAME 환경 변수를 설정해야 합니다.")
    print(".env 파일을 확인하세요.")
    exit(1)

DB_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}" # DB_URL을 환경변수 기반으로 재구성

print(f"원본 파일: '{SAVED_FILE_PATH}'")
print(f"필터 조건: [{FILTER_COLUMN}] == '{FILTER_VALUE}'")
print(f"적재 테이블: {DB_TABLE_NAME}")

start_total_time = time.time()

try:
    # --- 2. DB 엔진 연결 ---
    engine = create_engine(DB_URL)
    print(f"DB 엔진 연결 성공. (Host:{DB_HOST})")

    with fiona.open(SAVED_FILE_PATH, 'r') as source:
        
        print(f"총 {len(source)}개의 세그먼트 스캔 시작... {CHUNK_SIZE}개씩 분할 적재...")
        
        chunk = []
        chunk_counter = 0
        total_scan_counter = 0
        total_seoul_counter = 0
        is_first_chunk = True

        for feature in source:
            total_scan_counter += 1

            if total_scan_counter % 1000000 == 0:
                print(f"  ... {total_scan_counter // 1000000}00만 건 스캔 중 ...")

            # --- ★★★ 핵심 필터 로직 ★★★ ---
            if feature['properties'].get(FILTER_COLUMN) == FILTER_VALUE:
                chunk.append(feature)
            # --------------------------------

            # 현재 청크(서울시 데이터)가 목표 사이즈(CHUNK_SIZE)에 도달하면
            if len(chunk) == CHUNK_SIZE:
                chunk_counter += 1
                total_seoul_counter += len(chunk)
                start_chunk_time = time.time()
                print(f"  > [서울시] 청크 {chunk_counter} ({len(chunk)}개) DB 적재 중...")
                
                gdf_chunk = gpd.GeoDataFrame.from_features(chunk, crs=source.crs)
                
                # ★★★ 1. 첫 번째 청크: 테이블 생성 (MultiLineString) ★★★
                if is_first_chunk:
                    gdf_chunk.to_postgis(
                        name=DB_TABLE_NAME,
                        con=engine,
                        if_exists='replace',
                        index=False,
                        schema='public',
                        dtype={'geometry': 'GEOMETRY(MultiLineString, 4326)'} 
                    )
                    is_first_chunk = False
                # ★★★ 2. 나머지 청크: 데이터 추가 (MultiLineString으로 통일) ★★★
                else:
                    gdf_chunk.to_postgis(
                        name=DB_TABLE_NAME,
                        con=engine,
                        if_exists='append',
                        index=False,
                        schema='public',
                        dtype={'geometry': 'GEOMETRY(MultiLineString, 4326)'} 
                    )
                
                chunk = []
                end_chunk_time = time.time()
                print(f"  > 청크 {chunk_counter} 적재 완료! (소요 시간: {end_chunk_time - start_chunk_time:.2f}초)")

        # --- 4. 마지막 남은 청크 처리 ---
        if chunk:
            chunk_counter += 1
            total_seoul_counter += len(chunk)
            print(f"  > 마지막 [서울시] 청크 {chunk_counter} ({len(chunk)}개) 처리 중...")
            gdf_chunk = gpd.GeoDataFrame.from_features(chunk, crs=source.crs)
            
            if_exists_mode = 'replace' if is_first_chunk else 'append'
            
            # ★★★ 3. 마지막 청크: 데이터 추가 (MultiLineString으로 통일) ★★★
            gdf_chunk.to_postgis(
                name=DB_TABLE_NAME,
                con=engine,
                if_exists=if_exists_mode,
                index=False,
                schema='public',
                dtype={'geometry': 'GEOMETRY(MultiLineString, 4326)'} 
            )
            print("  > 마지막 청크 적재 완료!")

    end_total_time = time.time()
    print("\n[Phase 1] PostGIS에 '서울시' 데이터 적재 완료!")
    print(f"총 스캔한 세그먼트(전국): {total_scan_counter} 건")
    print(f"총 적재한 세그먼트(서울): {total_seoul_counter} 건")
    print(f"총 소요 시간: {end_total_time - start_total_time:.2f}초")

except Exception as e:
    print(f"\n데이터베이스 연결 또는 적재 오류: {e}")
    # ★ DB_HOST 대신 환경변수 설정을 확인하도록 메시지 수정
    print(f"오류 발생. DB 연결 설정 및 RDS 보안 그룹을 확인하세요.")

print("모든 작업 완료.")
