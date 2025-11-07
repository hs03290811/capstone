import geopandas as gpd
import rasterio
from sqlalchemy import create_engine

# 1. 데이터 로드
print("데이터 로드 중...")
dem_path = "path/to/your_dem.tif"
roads_path = "path/to/your_roads.shp"

# 래스터(DEM) 파일 열기
dem_raster = rasterio.open(dem_path)

# 벡터(도로망) 파일 열기
# 'path_id'가 도로의 고유 ID라고 가정합니다. 없다면 'id' 등 원본 SHP의 컬럼명을 사용하세요.
roads_gdf = gpd.read_file(roads_path)

print(f"총 {len(roads_gdf)}개의 도로 로드 완료.")

# --- (중요) 좌표계 통일 (CRS) ---
# 두 데이터의 좌표계(CRS)가 다르면 심각한 오류가 발생합니다.
# DEM의 좌표계로 도로망을 변환합니다.
if roads_gdf.crs != dem_raster.crs:
    print(f"좌표계 변환 중: {roads_gdf.crs} -> {dem_raster.crs}")
    roads_gdf = roads_gdf.to_crs(dem_raster.crs)