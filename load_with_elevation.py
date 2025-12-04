import os
import geopandas as gpd
import fiona
import rasterio
from shapely.geometry import Point
from sqlalchemy import create_engine
import time
from dotenv import load_dotenv

# .env 로드
load_dotenv() 

print("--- [Phase 1 - Refactoring] '고도(Elevation)' 데이터 추출 및 적재 시작 ---")

# --- 1. 파일 경로 설정 (★확인 필요★) ---
NATIONAL_ROADS_GPKG = "processed_segments.gpkg" 
SEOUL_BOUNDARY_FILE = "/home/ubuntu/seoul_boundary_data/LSMD_ADM_SECT_UMD_11_202510.shp"
DEM_FILE = "merged_dem.tif"

DB_TABLE_NAME = "segments_table"
CHUNK_SIZE = 100000 # (메모리 절약을 위해 10만으로 조정)

# --- 2. DB 연결 ---
DB_USER = os.environ.get("DB_USER")
DB_PASSWORD = os.environ.get("DB_PASSWORD")
DB_HOST = os.environ.get("DB_HOST")
DB_PORT = os.environ.get("DB_PORT", 5432) 
DB_NAME = os.environ.get("DB_NAME")

if not all([DB_USER, DB_PASSWORD, DB_HOST, DB_NAME]):
    print("오류: .env 파일 설정 확인 필요.")
    exit(1)

DB_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
engine = create_engine(DB_URL)

# --- 3. 고도 추출 함수 (핵심) ---
def extract_elevation(gdf, dem_src):
    """
    GeoDataFrame의 모든 LineString에 대해 start_elev, end_elev 컬럼을 추가합니다.
    """
    # 1. 좌표계 통일 (DEM과 도로 데이터가 다를 경우 대비)
    if gdf.crs != dem_src.crs:
        # (주의: 보통 DEM도 4326이지만, 다를 경우 변환 필요)
        # 여기서는 일단 도로 데이터를 DEM 좌표계로 변환해서 샘플링
        gdf_proj = gdf.to_crs(dem_src.crs)
    else:
        gdf_proj = gdf

    start_points = []
    end_points = []

    # 2. 모든 도로의 시점/종점 좌표 추출
    for geom in gdf_proj.geometry:
        # geom은 LineString 또는 MultiLineString
        if geom.geom_type == 'LineString':
            start_points.append(geom.coords[0]) # (x, y)
            end_points.append(geom.coords[-1])
        else:
            # 예외 처리 (MultiLineString 등)
            start_points.append(geom.geoms[0].coords[0])
            end_points.append(geom.geoms[-1].coords[-1])

    # 3. Rasterio로 고도 샘플링 (Batch 처리)
    # sample() 함수는 (x, y) 좌표 리스트를 받아 값을 반환
    start_elevs = [val[0] for val in dem_src.sample(start_points)]
    end_elevs = [val[0] for val in dem_src.sample(end_points)]

    # 4. 결과 컬럼 추가
    gdf['start_elev'] = start_elevs
    gdf['end_elev'] = end_elevs
    
    # (옵션) 기존 'slope' 컬럼은 제거하거나, 고도 기반으로 재계산할 수 있음.
    # 일단은 원본 유지를 위해 둡니다.
    
    return gdf

# --- 4. 메인 로직 실행 ---
try:
    print(f"1. 서울 경계 로드 중... ({SEOUL_BOUNDARY_FILE})")
    seoul_boundary = gpd.read_file(SEOUL_BOUNDARY_FILE)
    
    print(f"2. DEM 파일 열기... ({DEM_FILE})")
    dem_src = rasterio.open(DEM_FILE)
    print(f"   - DEM CRS: {dem_src.crs}")

    print(f"3. 전국 도로망 스캔 및 처리 시작...")
    
    start_time = time.time()
    
    with fiona.open(NATIONAL_ROADS_GPKG, 'r') as source:
        source_crs = source.crs
        chunk = []
        chunk_counter = 0
        total_seoul = 0
        is_first = True

        for feature in source:
            chunk.append(feature)

            if len(chunk) >= CHUNK_SIZE:
                chunk_counter += 1
                print(f"  > 청크 {chunk_counter} 처리 중... (Clip -> Elevation -> DB)")
                
                # A. GDF 변환
                gdf_chunk = gpd.GeoDataFrame.from_features(chunk, crs=source_crs)
                
                # B. 서울시 경계로 자르기 (Clip)
                if seoul_boundary.crs != gdf_chunk.crs:
                    seoul_boundary = seoul_boundary.to_crs(gdf_chunk.crs)
                
                seoul_roads = gpd.clip(gdf_chunk, seoul_boundary)
                
                if not seoul_roads.empty:
                    # C. ★★★ 고도 추출 (Elevation) ★★★
                    seoul_roads = extract_elevation(seoul_roads, dem_src)
                    
                    # D. DB 적재
                    if_exists_mode = 'replace' if is_first else 'append'
                    seoul_roads.to_postgis(
                        DB_TABLE_NAME, engine, if_exists=if_exists_mode, index=False,
                        dtype={'geometry': 'GEOMETRY(LineString, 4326)'}
                    )
                    
                    count = len(seoul_roads)
                    total_seoul += count
                    print(f"    - {count}건 적재 완료. (현재 총 {total_seoul}건)")
                    is_first = False
                
                chunk = [] # 메모리 비우기

        # 마지막 청크 처리
        if chunk:
            print("  > 마지막 청크 처리 중...")
            gdf_chunk = gpd.GeoDataFrame.from_features(chunk, crs=source_crs)
            seoul_roads = gpd.clip(gdf_chunk, seoul_boundary)
            if not seoul_roads.empty:
                seoul_roads = extract_elevation(seoul_roads, dem_src)
                if_exists_mode = 'replace' if is_first else 'append'
                seoul_roads.to_postgis(
                    DB_TABLE_NAME, engine, if_exists=if_exists_mode, index=False,
                    dtype={'geometry': 'GEOMETRY(LineString, 4326)'}
                )
                total_seoul += len(seoul_roads)
                print(f"    - 마지막 {len(seoul_roads)}건 적재 완료.")

    dem_src.close()
    print(f"\n--- 작업 완료 ---")
    print(f"총 적재된 서울시 도로: {total_seoul} 건")
    print(f"소요 시간: {time.time() - start_time:.2f} 초")

except Exception as e:
    print(f"\n[오류 발생]: {e}")
