from shapely.geometry import LineString, Point
import numpy as np

# 10m 세그먼트로 라인을 자르는 함수
def split_line_into_segments(line, segment_length):
    segments = []
    current_distance = 0
    total_length = line.length

    while current_distance < total_length:
        start_point = line.interpolate(current_distance)
        
        # 다음 지점 계산
        end_distance = current_distance + segment_length
        if end_distance > total_length:
            end_distance = total_length
            
        end_point = line.interpolate(end_distance)
        
        # 두 점으로 새로운 LineString (세그먼트) 생성
        segment = LineString([start_point, end_point])
        segments.append(segment)
        
        current_distance = end_distance
        
        # 마지막 지점에 도달하면 중지
        if current_distance == total_length:
            break
            
    return segments

print("도로 세그먼트 분할 중...")
all_segments_data = [] # 최종 데이터를 담을 리스트
segment_id_counter = 0 # 고유 ID 카운터

# 원본 도로(roads_gdf)를 하나씩 순회
for index, road in roads_gdf.iterrows():
    original_line = road.geometry
    original_path_id = road['path_id'] # 원본 SHP의 도로 ID
    
    # 함수를 사용해 10m 세그먼트로 분할
    new_segments = split_line_into_segments(original_line, 10.0)
    
    for segment_geom in new_segments:
        all_segments_data.append({
            'segment_id': segment_id_counter,
            'path_id': original_path_id,
            'geometry': segment_geom,
            'length': segment_geom.length
        })
        segment_id_counter += 1

# 리스트를 새로운 GeoDataFrame으로 변환
segments_gdf = gpd.GeoDataFrame(all_segments_data, crs=roads_gdf.crs)
print(f"총 {len(segments_gdf)}개의 10m 세그먼트 생성 완료.")