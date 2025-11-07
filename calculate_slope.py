# 래스터(DEM)에서 좌표 목록의 고도를 추출하는 함수
def get_elevations(raster, coords):
    # rasterio.sample.sample_gen을 사용해 좌표의 래스터 값을 샘플링
    # coords는 [(x1, y1), (x2, y2), ...] 형태의 리스트
    return [val[0] for val in raster.sample(coords)]

print("경사도 계산 중...")
slopes = []

# (주의) 이 작업은 세그먼트가 많으면 매우 오래 걸릴 수 있습니다.
for segment in segments_gdf.geometry:
    # 세그먼트의 시작점과 끝점 좌표 추출
    start_point = segment.coords[0] # (x, y)
    end_point = segment.coords[-1] # (x, y)
    
    # 좌표 리스트로 고도 한 번에 추출
    elevations = get_elevations(dem_raster, [start_point, end_point])
    start_elevation = elevations[0]
    end_elevation = elevations[1]
    
    # 경사도 계산 (rise / run)
    rise = end_elevation - start_elevation
    run = segment.length # segment.length는 이미 10m에 가까움
    
    if run == 0:
        slope = 0 # 길이가 0인 경우 (이론상으론 없어야 함)
    else:
        slope = (rise / run) * 100 # 백분율(%) 경사도
        
    slopes.append(slope)

# 계산된 경사도를 GeoDataFrame에 새 컬럼으로 추가
segments_gdf['slope'] = slopes
dem_raster.close() # DEM 파일 닫기
print("경사도 계산 완료.")