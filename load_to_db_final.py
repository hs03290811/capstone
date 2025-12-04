import os
import geopandas as gpd
import fiona
from sqlalchemy import create_engine
import time
from dotenv import load_dotenv

# (★) 환경 변수 로드
load_dotenv() 

print("--- [Phase 1 최종] 좌표 기반 BBOX 필터링 적재 시작 ---")

# --- 1. 기본 설정 ---
SAVED_FILE_PATH = "processed_segments.gpkg" 
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

DB_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

print(f"원본 파일: '{SAVED_FILE_PATH}'")
print(f"적재 테이블: {DB_TABLE_NAME}")

start_total_time = time.time()

try:
    # --- 2. DB 엔진 연결 ---
    engine = create_engine(DB_URL)
    print(f"DB 엔진 연결 성공. (Host:{DB_HOST})")

    # ★★★ Geometry 타입 정의 (MultiLineString으로 통일) ★★★
    dtype_spec = {'geometry': 'GEOMETRY(MultiLineString, 4326)'}

    # 서울시 대략적인 경계 (Bounding Box) 정의
    MIN_LON, MAX_LON = 126.7, 127.2  # 경도 (Longitude) 범위
    MIN_LAT, MAX_LAT = 37.3, 37.7  # 위도 (Latitude) 범위


    with fiona.open(SAVED_FILE_PATH, 'r') as source:
        
        print(f"총 {len(source)}개의 세그먼트 스캔 시작... BBOX 필터 적용...")
        
        chunk = []
        chunk_counter = 0
        total_scan_counter = 0 
        total_loaded_counter = 0
        is_first_chunk = True

        for feature in source:
            total_scan_counter += 1

            if total_scan_counter % 1000000 == 0:
                print(f"  ... {total_scan_counter // 1000000}00만 건 스캔 중 ...")

            # --- ★★★ 핵심 좌표 필터 로직 (BBOX) ★★★ ---
            try:
                # Geometry의 첫 번째 좌표쌍 추출 (LineString의 시작점)
                # MultiLineString일 경우 첫 번째 라인의 첫 번째 좌표
                coords = feature['geometry']['coordinates']
                lon = coords[0][0][0] if feature['geometry']['type'].startswith('Multi') else coords[0][0]
                lat = coords[0][1][0] if feature['geometry']['type'].startswith('Multi') else coords[0][1]

                # 서울시 BBOX 조건 확인
                if (MIN_LON <= lon <= MAX_LON) and (MIN_LAT <= lat <= MAX_LAT):
                    chunk.append(feature)
            except Exception:
                # 좌표 데이터가 잘못되었거나 형식이 다르면 무시
                continue
            # --------------------------------

            # 현재 청크가 목표 사이즈에 도달하면 적재 시작
            if len(chunk) == CHUNK_SIZE:
                chunk_counter += 1
                total_loaded_counter += len(chunk)
                start_chunk_time = time.time()
                print(f"  > 청크 {chunk_counter} ({len(chunk)}개) DB 적재 중...")
                
                gdf_chunk = gpd.GeoDataFrame.from_features(chunk, crs=source.crs)
                
                if is_first_chunk:
                    # 첫 번째 청크는 테이블을 '생성(replace)'
                    gdf_chunk.to_postgis(name=DB_TABLE_NAME, con=engine, if_exists='replace', index=False, schema='public', dtype=dtype_spec)
                    is_first_chunk = False
                else:
                    # 두 번째부터는 테이블에 '추가(append)'
                    gdf_chunk.to_postgis(name=DB_TABLE_NAME, con=engine, if_exists='append', index=False, schema='public', dtype=dtype_spec)
                
                chunk = []
                end_chunk_time = time.time()
                print(f"  > 청크 {chunk_counter} 적재 완료! (소요 시간: {end_chunk_time - start_chunk_time:.2f}초)")

        # --- 4. 마지막 남은 청크 처리 ---
        if chunk:
            chunk_counter += 1
            total_loaded_counter += len(chunk)
            print(f"  > 마지막 청크 {chunk_counter} ({len(chunk)}개) 처리 중...")
            gdf_chunk = gpd.GeoDataFrame.from_features(chunk, crs=source.crs)
            
            if_exists_mode = 'replace' if is_first_chunk else 'append'
            
            gdf_chunk.to_postgis(name=DB_TABLE_NAME, con=engine, if_exists=if_exists_mode, index=False, schema='public', dtype=dtype_spec)
            print("  > 마지막 청크 적재 완료!")

    end_total_time = time.time()
    print("\n[Phase 1] PostGIS에 데이터 적재 완료!")
    print(f"총 스캔한 세그먼트: {total_scan_counter} 건")
    print(f"총 적재한 세그먼트(서울 BBOX): {total_loaded_counter} 건")
    print(f"총 소요 시간: {end_total_time - start_total_time:.2f}초")

except Exception as e:
    print(f"\n❌ 데이터 적재 오류: {e}")
    print(f"오류 발생. DB 연결 설정 및 RDS 보안 그룹을 확인하세요.")

print("모든 작업 완료.")
