import os
import glob
import rasterio
import numpy as np
import statistics
from sqlalchemy import create_engine, text
from pyproj import Transformer

# ==========================================
# 1. 기본 설정 (★ 실행 전 반드시 확인/수정 ★)
# ==========================================
DB_URL = "postgresql://postgres:nabxav-nithiC-2ronpo@capstone-db.caty68mm025l.us-east-1.rds.amazonaws.com:5432/postgres"
TABLE_NAME = "segments_table" # ★★★ 현재 작업 테이블 이름 ★★★
DEM_FOLDER = "/home/ubuntu/dem" # ★★★ 서버의 실제 DEM 파일 경로 ★★★

# 중앙대 근처 좌표와 반경 (3km) 정의
CAU_LON = 126.956
CAU_LAT = 37.503
RADIUS_DEGREE = 0.027 # 3km 근사치

# ==========================================
# 2. DB 연결 및 DEM 파일 로딩
# ==========================================
engine = create_engine(DB_URL)
print("✅ DB 연결 성공")

dem_files = glob.glob(os.path.join(DEM_FOLDER, "*.hgt")) + glob.glob(os.path.join(DEM_FOLDER, "*.tif"))
if not dem_files:
    print("❌ DEM 파일을 찾을 수 없습니다. 경로를 확인하세요.")
    exit()

src_list = [rasterio.open(f) for f in dem_files]
print(f"📂 {len(src_list)}개의 DEM 파일을 로드했습니다.")

# ==========================================
# 3. 고도 추출 헬퍼 함수
# ==========================================
def get_elevation(lat, lon):
    """여러 DEM 파일에서 해당 좌표의 고도를 찾습니다."""
    for src in src_list:
        try:
            # src.index의 인자는 (lon, lat) 순서입니다.
            row, col = src.index(lon, lat) 
            data = src.read(1)
            if 0 <= row < data.shape[0] and 0 <= col < data.shape[1]:
                val = data[row, col]
                if val > -1000 and val < 9000:  
                    return float(val)
        except Exception:
            continue
    return None

# ==========================================
# 4. 데이터 업데이트 실행 함수 (수정된 로직)
# ==========================================
def run_slope_update():
    print(f"🔎 테이블 [{TABLE_NAME}]에서 업데이트 대상을 조회합니다...")
    print(f"   -> 중앙대 반경 {RADIUS_DEGREE}도 이내만 필터링합니다.")
    
    updated_count = 0

    with engine.connect() as conn:
        
        # 1. 대상 데이터 조회: 3km 반경 내만 필터링하고 PostGIS 함수로 좌표 추출
        sql_select = text(f"""
            SELECT 
                segment_id, 
                length, 
                ST_Y(ST_StartPoint(geometry)) AS start_lat, 
                ST_X(ST_StartPoint(geometry)) AS start_lon, 
                ST_Y(ST_EndPoint(geometry)) AS end_lat, 
                ST_X(ST_EndPoint(geometry)) AS end_lon
            FROM {TABLE_NAME}
            WHERE geometry IS NOT NULL 
              AND length > 0
              -- ★★★ 3KM 반경 필터링 조건 ★★★
              AND ST_DWithin(
                  geometry, 
                  ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 
                  :radius_degree
              );
        """)
        
        try:
            # 쿼리 실행 시 좌표와 반경 값을 파라미터로 전달
            rows = conn.execute(sql_select, {
                "lon": CAU_LON, 
                "lat": CAU_LAT, 
                "radius_degree": RADIUS_DEGREE
            }).fetchall()
            
            print(f"✅ 총 {len(rows)}개 레코드 조회 성공. 업데이트를 시작합니다.")
        except Exception as e:
            # Geometry 컬럼 이름이 'geometry'가 아닐 경우 실패할 수 있습니다.
            print(f"❌ 쿼리 실행 실패. Geometry 컬럼 이름이 'geometry'가 맞는지 확인하세요. 오류: {e}")
            return
        
        
        # 2. 레코드 순회 및 업데이트
        for r in rows:
            # r[0]: segment_id, r[1]: length, r[2]: start_lat, r[3]: start_lon, r[4]: end_lat, r[5]: end_lon
            
            seg_id = r[0]
            length_m = r[1]
            start_lat, start_lon = r[2], r[3]
            end_lat, end_lon = r[4], r[5]

            # 2-1. 고도 추출 (DEM)
            start_elev = get_elevation(start_lat, start_lon)
            end_elev = get_elevation(end_lat, end_lon)

            if start_elev is None or end_elev is None or length_m == 0:
                continue

            # 2-2. 경사도 및 평균 고도 계산
            rise = end_elev - start_elev
            slope_pct = (rise / length_m) * 100.0
            avg_alt = (start_elev + end_elev) / 2.0

            # 2-3. DB 업데이트 (FLOAT 값 삽입)
            update_sql = text(f"""
                UPDATE {TABLE_NAME}
                SET slope = :slope, avg_altitude = :alt
                WHERE segment_id = :id
            """)
            
            conn.execute(update_sql, {
                "slope": round(slope_pct, 4), 
                "alt": round(avg_alt, 2), 
                "id": seg_id
            })
            
            updated_count += 1
            if updated_count % 1000 == 0:
                conn.commit()
                print(f"🚀 {updated_count}개 커밋 완료...")

        conn.commit() # 최종 커밋
    print(f"✨ 최종 {updated_count}개 레코드 업데이트 완료!")


if __name__ == "__mainv__":
    run_slope_update()
