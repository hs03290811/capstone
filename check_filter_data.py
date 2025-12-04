import fiona

# 님의 원본 파일 경로
SAVED_FILE_PATH = "processed_segments.gpkg" 
FILTER_COLUMN = "CTY_NM" 

def check_data_schema():
    try:
        with fiona.open(SAVED_FILE_PATH, 'r') as source:
            print("=========================================")
            print(f"1. 원본 파일 스키마 확인 (사용 가능한 컬럼):")
            
            # 모든 속성 컬럼 이름 출력
            print(f"   {source.schema['properties'].keys()}")
            
            print("\n2. 첫 3개 레코드의 CTY_NM 값 확인:")
            # 첫 3개 레코드의 CTY_NM 값 출력
            i = 0
            for feature in source:
                if i >= 3: break
                city_value = feature['properties'].get(FILTER_COLUMN)
                print(f"   [레코드 {i+1}] '{FILTER_COLUMN}' 값: '{city_value}'")
                i += 1
            print("=========================================")
            
    except Exception as e:
        print(f"❌ 파일을 열 수 없습니다. 경로를 다시 확인하세요: {e}")

if __name__ == "__main__":
    check_data_schema()
