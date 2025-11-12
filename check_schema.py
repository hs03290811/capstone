import fiona

# (★) 원본 gpkg 파일 경로. (load_to_db_chunked.py와 동일하게)
GPKG_PATH = "processed_segments.gpkg" 

try:
    with fiona.open(GPKG_PATH, 'r') as source:
        
        print("\n--- 1. 컬럼(속성) 목록 ---")
        # 이 파일이 가진 모든 컬럼 이름을 보여줍니다.
        print(source.schema['properties'].keys())
        
        print("\n--- 2. 실제 데이터 샘플 (첫 5개) ---")
        # 처음 5개 데이터의 속성값을 모두 보여줍니다.
        count = 0
        for feature in source:
            print(feature['properties'])
            count += 1
            if count >= 5:
                break
                
except Exception as e:
    print(f"파일 열기 오류: {e}")
    print(f"'{GPKG_PATH}' 파일이 현재 위치에 있는지 확인하세요.")
