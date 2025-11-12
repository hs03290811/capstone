-- (이 내용을 "create_topology.sql" 파일에 붙여넣기)
-- 1. 컬럼 추가 (이미 있다고 오류 떠도 괜찮음)
ALTER TABLE segments_table ADD COLUMN source INTEGER;
ALTER TABLE segments_table ADD COLUMN target INTEGER;

-- 2. "1~2시간짜리" 토폴로지 생성
SELECT pgr_createTopology('segments_table', 0.00001, 'geometry', 'segment_id', 'source', 'target');

-- 3. "10~20분짜리" 인덱스 생성
CREATE INDEX ON segments_table (source);
CREATE INDEX ON segments_table (target);
