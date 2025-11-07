캡스톤 디자인: 전국 도로 경사도 API 서버

이 프로젝트는 전국 도로망(.shp)과 DEM(.tif) 데이터를 처리하여, 각 도로 세그먼트의 경사도를 계산하고, 이를 PostGIS DB에 적재한 뒤 FastAPI로 API를 제공하는 캡스톤 프로젝트의 백엔드/인프라입니다.

1. 아키텍처

API Server (WAS): AWS EC2 (t3.large, 8GB RAM) + FastAPI (Python)

Database (DB): AWS RDS (db.t3.micro, 1GB RAM) + PostgreSQL + PostGIS

Data Pipeline: Local Mac (Preprocessing) -> EC2 (Chunk Load) -> RDS (Storage)

2. API 엔드포인트

GET /health: 서버 상태 체크

GET /test_db: DB 연결 및 샘플 5줄 조회

GET /segments_in_view: (핵심 API) 지도 뷰포트(BBOX) 내의 세그먼트 조회

Params: min_lon, min_lat, max_lon, max_lat

Example: http://(EC2 공용 IP):8000/segments_in_view?min_lon=127.02&min_lat=37.49&max_lon=127.03&max_lat=37.50

3. (★필수★) 환경 변수 설정

이 프로젝트는 **보안(Security)**을 위해 DB 접속 정보(비밀번호, 주소)를 코드에 하드코딩하지 않고 환경 변수를 사용합니다.

(A) 로컬(Mac)에서 테스트/개발 시

code 폴더에 .env라는 이름의 '새 파일'을 만드세요. (.gitignore에 이미 등록되어 Git에 올라가지 않습니다.)
(주의: pip install python-dotenv 라이브러리가 필요합니다.)

.env 파일 예시:

DB_USER="postgres"
DB_PASSWORD="nabxav-nithiC-2ronpo"
DB_HOST="capstone-db.caty68mm025l.us-east-1.rds.amazonaws.com"
DB_PORT="5432"
DB_NAME="postgres"


(B) EC2 서버에서 실행 시

EC2 서버(ubuntu@ip-...:~$) 터미널에서 source venv/bin/activate로 venv를 켠 후, 서버를 켜기 전에 다음 export 명령어를 실행하여 '환경 변수'를 '주입'합니다.

(주의: pip install python-dotenv가 EC2의 venv에도 설치되어 있어야 합니다.)

# 1. (venv) 활성화
source venv/bin/activate

# 2. (★필수★) 환경 변수 주입
export DB_USER="postgres"
export DB_PASSWORD="nabxav-nithiC-2ronpo"
export DB_HOST="capstone-db.caty68mm025l.us-east-1.rds.amazonaws.com"
export DB_PORT="5432"
export DB_NAME="postgres"

# 3. API 서버 켜기 (이제 스크립트가 환경 변수를 읽음)
python3 main.py


4. Python 라이브러리 목록

venv에 설치해야 하는 필수 라이브러리 목록입니다.

fastapi
uvicorn[standard]
sqlalchemy
psycopg2-binary
geopandas
geoalchemy2
fiona
python-dotenv


(설치: pip install fastapi "uvicorn[standard]" sqlalchemy psycopg2-binary geopandas geoalchemy2 fiona python-dotenv)