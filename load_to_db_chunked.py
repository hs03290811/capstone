# nano load_to_db_chunked.py (EC2에서 실행)

import os
import geopandas as gpd
import fiona
from sqlalchemy import create_engine
import time
from dotenv import load_dotenv

# (★유지★) .env 파일에서 환경 변수를 읽어옴
load_dotenv() 

print("--- [Phase 1 수정] '공간 필터링(Clip)'으로 서울시 데이터 적재 시작 ---")

# --- 1. 기본 설정 (★ 경로 수정 완료 ★) ---

# (★) 원본 4700만 건 gpkg 파일 경로
NATIONAL_ROADS_GPKG = "processed_segments.gpkg" 

# (★) [수정 완료] EC2 서버에 업로드한 '서울시 경계 파일' 경로
# 1단계에서 scp로 업로드한 EC2 내부 경로입니다.
SEOUL_BOUNDARY_FILE = "/home/ubuntu/seoul_boundary_data/LSMD_ADM_SECT_UMD_11_202510.shp" 

DB_TABLE_NAME = "segments_table"
CHUNK_SIZE = 500000 

# ---------------------------------------------

# (★유지★) DB_URL 조합
DB_USER = os.environ.get("DB_USER")
DB_PASSWORD = os.environ.get("DB_PASSWORD")
DB_HOST = os.environ.get("DB_HOST")
DB_PORT = os.environ.get("DB_PORT", 5432) 
DB_NAME = os.environ.get("DB_NAME")

if not all([DB_USER, DB_PASSWORD, DB_HOST, DB_NAME]):
    print("오류: .env 파일에 DB 접속 정보가 없습니다.")
    exit(1)

DB_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

print(f"원본 파일: '{NATIONAL_ROADS_GPKG}'")
print(f"경계 파일: '{SEOUL_BOUNDARY_FILE}'") # (★) 이 경로 확인
print(f"적재 테이블: {DB_TABLE_NAME}")

start_total_time = time.time()

try:
    # --- 1. 서울시 경계 파일 (쿠키 틀) 로드 ---
    print("서울시 경계 파일 로드 중...")
    seoul_boundary = gpd.read_file(SEOUL_BOUNDARY_FILE)
    
    # --- 2. DB 엔진 연결 ---
    engine = create_engine(DB_URL)
    print(f"DB 엔진 연결 성공. (Host: {DB_HOST})")

    # --- 3. 전국 도로망(4700만 건)을 청크(Chunk)로 읽고 자르기 ---
    with fiona.open(NATIONAL_ROADS_GPKG, 'r') as source:
        
        print(f"총 {len(source)}개 세그먼트 스캔 시작... {CHUNK_SIZE}개씩 분할 처리...")
        
        chunk = [] 
        chunk_counter = 0
        total_seoul_counter = 0 
        is_first_chunk = True
        
        source_crs = source.crs # (★) 원본 CRS 미리 저장

        # (★유지★) 4687만 개 피처를 하나씩 순회
        for feature in source:
            chunk.append(feature)
            
            # (★유지★) 청크가 꽉 차면, '자르기(Clip)' 작업 수행
            if len(chunk) == CHUNK_SIZE:
                chunk_counter += 1
                start_chunk_time = time.time()
                print(f"  > [전국] 청크 {chunk_counter} ({len(chunk)}개) 로드 중...")
                
                # 1. 청크(50만 개)를 GeoDataFrame으로 변환
                gdf_chunk = gpd.GeoDataFrame.from_features(chunk, crs=source_crs)
                
                # --- ★★★ 핵심 공간 필터링 로직 ★★★ ---
                # 2. (중요) CRS가 일치하는지 확인 (최초 1회만)
                if chunk_counter == 1 and seoul_boundary.crs != gdf_chunk.crs:
                     print(f"  > [경고!] CRS가 다릅니다. 경계 파일 CRS를 변환합니다...")
                     print(f"    (원본: {gdf_chunk.crs} / 경계: {seoul_boundary.crs})")
                     seoul_boundary = seoul_boundary.to_crs(gdf_chunk.crs)
                     print(f"  > [완료] 경계 파일 CRS -> {seoul_boundary.crs}로 통일")


                # 3. 50만 개 데이터를 서울시 경계로 '자르기' (Clip)
                print(f"  > [서울시] 청크 {chunk_counter} 자르기(Clip) 작업 중...")
                seoul_roads_in_chunk = gpd.clip(gdf_chunk, seoul_boundary)
                # ----------------------------------------
                
                chunk = []  # 원본 청크 메모리 즉시 비우기
                
                # 4. 잘라낸 결과(서울시 도로)가 있다면 DB에 적재
                if not seoul_roads_in_chunk.empty:
                    print(f"  > [결과] {len(seoul_roads_in_chunk)}건 발견. DB 적재 중...")
                    total_seoul_counter += len(seoul_roads_in_chunk)
                    
                    if_exists_mode = 'replace' if is_first_chunk else 'append'
                    
                    seoul_roads_in_chunk.to_postgis(
                        DB_TABLE_NAME,
                        con=engine,
                        if_exists=if_exists_mode,
                        index=False,
                        schema='public',
                        dtype={'geometry': 'GEOMETRY(LineString, 4326)'}
                    )
                    is_first_chunk = False # 첫 번째 적재 후 False로 변경
                else:
                    print(f"  > [결과] 해당 청크에 서울시 데이터 없음.")
                
                end_chunk_time = time.time()
                print(f"  > 청크 {chunk_counter} 처리 완료! (소요 시간: {end_chunk_time - start_chunk_time:.2f}초)")

        # --- 4. 마지막 남은 청크 처리 ---
        if chunk:
            chunk_counter += 1
            print(f"  > 마지막 [전국] 청크 {chunk_counter} ({len(chunk)}개) 처리 중...")
            gdf_chunk = gpd.GeoDataFrame.from_features(chunk, crs=source_crs)
                 
            # (Clip)
            seoul_roads_in_chunk = gpd.clip(gdf_chunk, seoul_boundary)
            
            if not seoul_roads_in_chunk.empty:
                print(f"  > [결과] 마지막 {len(seoul_roads_in_chunk)}건 발견. DB 적재 중...")
                total_seoul_counter += len(seoul_roads_in_chunk)
                
                if_exists_mode = 'replace' if is_first_chunk else 'append'
                
                seoul_roads_in_chunk.to_postgis(
                    DB_TABLE_NAME,
                    con=engine,
                    if_exists=if_exists_mode,
                    index=False,
                    schema='public',
                    dtype={'geometry': 'GEOMETRY(LineString, 4326)'}
                )
            else:
                print(f"  > [결과] 해당 청크에 서울시 데이터 없음.")

    end_total_time = time.time()
    print("\n[Phase 1] PostGIS에 '서울시' 데이터 (공간 필터링) 적재 완료!")
    print(f"총 적재한 세그먼트(서울): {total_seoul_counter} 건")
    print(f"총 소요 시간: {end_total_time - start_total_time:.2f}초")

except FileNotFoundError:
    print(f"\n[오류] 파일을 찾을 수 없습니다.")
    print(f"1. '{NATIONAL_ROADS_GPKG}' 파일이 있는지 확인하세요.")
    print(f"2. '{SEOUL_BOUNDARY_FILE}' 파일이 있는지 확인하세요.")
except Exception as e:
    print(f"\n데이터베이스 연결 또는 처리 오류: {e}")
    print(f"DB_HOST '{DB_HOST}'에 연결할 수 없습니다. .env 파일이나 RDS 보안 그룹을 확인하세요.")

print("모든 작업 완료.")
