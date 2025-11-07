import os
import glob # 파일 경로를 쉽게 찾기 위해 사용
import geopandas as gpd
import rasterio
from rasterio.merge import merge # DEM 병합을 위해 사용
from shapely.geometry import LineString
from sqlalchemy import create_engine
import numpy as np

# --- 1. 기본 설정 (사용자 경로에 맞게 수정) ---

# 기본 디렉토리 경로 (사용자가 제공한 경로)
BASE_DIR = "/Users/peachee/Desktop/CAU/capstone/source"
DEM_DIR = os.path.join(BASE_DIR, "dem")
SHP_DIR = os.path.join(BASE_DIR, "shp")

# (주의!) SHP_DIR에 있는 수많은 SHP 파일 중, '도로'에 해당하는 파일명을 정확히 입력해야 합니다.
# 이미지에서 'gis_osm_roads_free_1.shp'가 도로 파일로 추정됩니다.
ROADS_SHP_NAME = "gis_osm_roads_free_1.shp"

# 병합된 DEM 파일을 저장할 경로
MERGED_DEM_PATH = os.path.join(DEM_DIR, "merged_dem.tif")

# (중요!) 경사도 계산을 위한 '미터(m)' 기반 좌표계 (CRS)
# .hgt 파일(EPSG:4326)에서 m 단위 계산을 위해 UTM 같은 좌표계로 변환이 필요합니다.
# 대한민국 중부 원점이니 "EPSG:5179" 또는 "EPSG:5186"을 사용합니다.
METRIC_CRS = "EPSG:5179" 


# --- 2. DEM 병합 함수 (.hgt -> .tif) ---

def merge_dem_files(dem_dir, output_path):
    """
    디렉토리 내의 모든 .hgt 파일을 찾아 하나의 .tif 파일로 병합합니다.
    """
    print(f"'{output_path}' 파일이 있는지 확인 중...")
    if os.path.exists(output_path):
        print("파일이 이미 존재합니다. DEM 병합 단계를 건너뜁니다.")
        return

    print(f"DEM 파일 병합 시작... (.hgt -> {output_path})")
    
    # dem_dir에서 모든 .hgt 파일 찾기
    hgt_files = glob.glob(os.path.join(dem_dir, "*.hgt"))
    if not hgt_files:
        print(f"경고: '{dem_dir}'에서 .hgt 파일을 찾을 수 없습니다.")
        return

    # 래스터 파일 목록 열기
    raster_objects = []
    for file in hgt_files:
        raster_objects.append(rasterio.open(file))
    
    # 래스터 병합
    merged_data, out_transform = merge(raster_objects)
    
    # 병합된 래스터의 메타데이터 업데이트
    out_meta = raster_objects[0].meta.copy()
    out_meta.update({
        "driver": "GTiff",
        "height": merged_data.shape[1],
        "width": merged_data.shape[2],
        "transform": out_transform,
        "crs": raster_objects[0].crs # .hgt는 보통 EPSG:4326
    })

    # 병합된 파일 저장
    with rasterio.open(output_path, "w", **out_meta) as dest:
        dest.write(merged_data)
        
    # 열었던 래스터 객체들 닫기
    for r in raster_objects:
        r.close()
        
    print("DEM 파일 병합 완료.")


# --- 3. 도로 세그먼트 분할 함수 ---

def split_line_into_segments(line, segment_length):
    """
    하나의 LineString을 'segment_length' 길이의 여러 세그먼트로 분할
    """
    segments = []
    current_distance = 0
    total_length = line.length

    while current_distance < total_length:
        start_point = line.interpolate(current_distance)
        
        end_distance = current_distance + segment_length
        if end_distance > total_length:
            end_distance = total_length
            
        end_point = line.interpolate(end_distance)
        
        # (방어 코드) 점이 같아서 길이가 0인 세그먼트 방지
        if start_point.equals(end_point):
            break
            
        segment = LineString([start_point, end_point])
        segments.append(segment)
        current_distance = end_distance
        
    return segments


# --- 4. 고도 추출 함수 ---

def get_elevations(raster, coords):
    """
    래스터(DEM)에서 좌표 목록의 고도를 추출
    """
    # .hgt는 데이터가 없는 경우 -32768 같은 비정상적인 값을 가질 수 있습니다.
    # raster.sample은 이 값들을 그대로 반환합니다. 
    # 여기서는 단순 샘플링을 사용하지만, 실제로는 NoData 값 처리가 필요할 수 있습니다.
    return [val[0] for val in raster.sample(coords)]


# --- 5. 메인 데이터 처리 파이프라인 ---

def main_process():
    
    # --- 1단계: 데이터 로드 ---
    print("\n[1단계] 데이터 로드 및 좌표계 설정...")
    try:
        dem_raster = rasterio.open(MERGED_DEM_PATH)
        roads_gdf = gpd.read_file(os.path.join(SHP_DIR, ROADS_SHP_NAME))
    except Exception as e:
        print(f"파일 로드 오류: {e}")
        print(f"DEM 경로: {MERGED_DEM_PATH}")
        print(f"SHP 경로: {os.path.join(SHP_DIR, ROADS_SHP_NAME)}")
        return

    dem_crs = dem_raster.crs
    print(f"DEM CRS: {dem_crs}") # (예: EPSG:4326)
    print(f"원본 도로 CRS: {roads_gdf.crs}")

    # --- 2단계: 도로 데이터를 '미터' 좌표계로 변환 ---
    print(f"\n[2단계] 도로 좌표계 변환 -> {METRIC_CRS} (미터 단위 계산용)")
    roads_gdf_metric = roads_gdf.to_crs(METRIC_CRS)
    print(f"총 {len(roads_gdf_metric)}개의 도로 변환 완료.")

    # --- 3단계: 10m 세그먼트로 분할 ---
    print("\n[3단계] 도로 10m 세그먼트로 분할 중...")
    all_segments_data = []
    segment_id_counter = 0

    for index, road in roads_gdf_metric.iterrows():
        original_line = road.geometry
        
        # (주의!) 'path_id'가 SHP 파일에 실제 있는지 확인하세요.
        # 없다면 'osm_id' 등 다른 고유 ID를 사용하거나, road.name (인덱스)을 사용하세요.
        # 여기서는 'osm_id'를 사용한다고 가정합니다. (OpenStreetMap 데이터이므로)
        original_path_id = road.get('osm_id', index) # 'osm_id'가 없으면 인덱스 사용
        
        new_segments = split_line_into_segments(original_line, 10.0)
        
        for segment_geom in new_segments:
            all_segments_data.append({
                'segment_id': segment_id_counter,
                'path_id': original_path_id,
                'geometry': segment_geom,
                'length': segment_geom.length # (중요) 미터 단위 길이
            })
            segment_id_counter += 1

    if not all_segments_data:
        print("오류: 생성된 세그먼트가 없습니다. SHP 파일이나 좌표계를 확인하세요.")
        return
        
    # 분할된 세그먼트를 GeoDataFrame으로 변환
    segments_gdf_metric = gpd.GeoDataFrame(all_segments_data, crs=METRIC_CRS)
    print(f"총 {len(segments_gdf_metric)}개의 10m 세그먼트 생성 완료.")

    # --- 4단계: 경사도 계산 ---
    print("\n[4단계] 경사도 계산 시작...")
    
    # (중요) 고도 추출을 위해 세그먼트를 다시 DEM의 좌표계(EPSG:4326)로 변환
    print(f"고도 추출을 위해 세그먼트 좌표계 재변환 -> {dem_crs}")
    segments_gdf_dem_crs = segments_gdf_metric.to_crs(dem_crs)
    
    # (중요) 'length' 컬럼은 변환 전의 미터(m) 단위 값을 그대로 사용
    # GeoPandas는 재변환 시 geometry만 바꾸고 다른 컬럼은 유지합니다.
    segments_gdf_dem_crs['length'] = segments_gdf_metric['length']
    
    slopes = []
    for index, segment in segments_gdf_dem_crs.iterrows():
        geom = segment.geometry
        run = segment.length # 2단계에서 계산한 '미터' 단위 길이 (Rise / Run의 'Run')
        
        start_point = geom.coords[0]
        end_point = geom.coords[-1]
        
        elevations = get_elevations(dem_raster, [start_point, end_point])
        start_elevation = elevations[0]
        end_elevation = elevations[1]
        
        rise = float(end_elevation) - float(start_elevation)
        
        if run == 0 or np.isnan(rise):
            slope = 0.0
        else:
            slope = (rise / run) * 100 # 백분율(%) 경사도
            
        slopes.append(slope)

    segments_gdf_dem_crs['slope'] = slopes
    dem_raster.close()
    print("경사도 계산 완료.")

        # --- 5단계: PostGIS DB에 적재 (수정됨 -> 파일로 저장) ---
    print("\n[5단계] 중간 결과 파일로 저장 중...")
    
    # 저장할 파일 경로
    OUTPUT_FILE_PATH = os.path.join(BASE_DIR, "processed_segments.gpkg")

    try:
        # (중요) 'geom' 컬럼을 'geometry'로 이름을 바꿔서 저장 (PostGIS/GPKG 표준)
        segments_gdf_dem_crs.rename(columns={'geom': 'geometry'}, inplace=True)
        
        # GeoPackage 파일로 저장 (Shapefile보다 훨씬 좋음)
        segments_gdf_dem_crs.to_file(
            OUTPUT_FILE_PATH, 
            driver="GPKG", 
            layer="segments"
        )
        print(f"데이터 파일 저장 완료! -> {OUTPUT_FILE_PATH}")
        print("이제 'load_to_db.py' 스크립트를 실행하여 DB에 적재하세요.")

    except Exception as e:
        print(f"파일 저장 오류: {e}")


# --- 6. 스크립트 실행 ---
if __name__ == "__main__":
    
    # 1. DEM 파일 병합 (처음 한 번만 실행됨)
    merge_dem_files(DEM_DIR, MERGED_DEM_PATH)
    
    # 2. 메인 처리 파이프라인 실행
    main_process()