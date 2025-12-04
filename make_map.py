import folium
import json

# 1. GeoJSON 파일 읽기 (위에서 만든 파일명과 똑같아야 합니다)
geo_file = 'track.geojson'

try:
    with open(geo_file, 'r', encoding='utf-8') as f:
        geo_data = json.load(f)
        
    # 2. 지도의 중심 잡기 (데이터의 첫 번째 좌표를 기준으로)
    first_point = geo_data['features'][0]['geometry']['coordinates'][0]
    center_lat, center_lon = first_point[1], first_point[0] 

    # 3. 지도 생성
    m = folium.Map(location=[center_lat, center_lon], zoom_start=17)

    # 4. 지도에 데이터 올리기
    folium.GeoJson(
        geo_data,
        name='Soongsil Track'
    ).add_to(m)

    # 5. 저장하기
    m.save('my_map.html')
    print("✅ 성공! 'my_map.html' 파일이 생성되었습니다. 웹 브라우저로 열어보세요!")

except Exception as e:
    print(f"❌ 오류 발생: {e}")

