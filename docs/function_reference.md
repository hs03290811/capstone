# 함수 요약 문서

앱 전반에서 사용되는 주요 함수와 파라미터, 동작을 정리했습니다. 러닝 진행/기록 관리, 코스 처리, 칼로리 계산, 고도 처리 순으로 나열합니다.

## 러닝 컨텍스트 (src/providers/running_provider.js)

| 함수 | 파라미터 | 동작 요약 |
| --- | --- | --- |
| `startRunning()` | 없음 | 러닝 상태를 활성화하고 1초마다 경과 시간을 증가시키는 타이머를 시작합니다. 이미 실행 중이면 아무 동작을 하지 않습니다. |
| `stopRunning()` | 없음 | 러닝 상태를 비활성화하고 실행 중인 타이머를 정리합니다. |
| `updateUserLocation(latitude, longitude, altitude?)` | `latitude`: 위도, `longitude`: 경도, `altitude`(선택): 고도 | 러닝 중일 때만 호출을 처리하며, 이전 위치와 새 위치 사이의 거리를 누적 거리로 더하고 사용자의 이동 경로를 기록합니다. |
| `fetchCourseRecommendation(distanceKm, _slope, currentLocation)` | `distanceKm`: 목표 거리(km), `_slope`: 미사용 자리, `currentLocation`: `{latitude, longitude}` | 추천 코스 API를 호출해 GeoJSON 데이터를 정규화한 뒤 코스 목록과 세부 정보를 상태에 저장합니다. 실패 시 토스트 알림을 띄우고 준비된 목업 데이터를 폴백으로 사용합니다. |
| `selectRecommendedCourse(courseId)` | `courseId`: 추천 코스 식별자 | 추천 코스 목록에서 선택한 코스를 지도/정보 패널에 반영하고 경사 세그먼트·요약값을 설정합니다. 대상이 없으면 `null`을 반환합니다. |
| `resetRunData()` | 없음 | 누적 거리, 시간, 추천 코스, 경사 정보, 기록된 경로, 칼로리 상태를 모두 초기화합니다. |
| `showUserNotification(message)` | `message`: 사용자에게 표시할 문자열 | 안드로이드 토스트로 짧은 알림을 노출합니다(환경에 따라 무시될 수 있음). |
| `loadProfile()` | 없음 | AsyncStorage(또는 메모리 캐시)에서 체중·경사 프로필을 읽어 상태에 반영합니다. 저장된 값이 없으면 기본값을 사용하고 사용자에게 알립니다. |
| `saveProfile({ weightKg, inclinePercent })` | `weightKg`: 체중(kg), `inclinePercent`: 경사(%) | 안전한 값으로 보정 후 상태와 스토리지(또는 메모리 캐시)에 저장하고 성공 여부를 반환합니다. 실패 시 안내 토스트를 띄웁니다. |
| `loadHistoryRecords()` | 없음 | 러닝 기록을 AsyncStorage → 백엔드 → 빈 배열 순으로 로드하며, 결과를 상태에 저장합니다. 로딩/동기화 여부 플래그를 관리합니다. |
| `addRunRecord(record)` | `record`: `{ title, date, distanceKm, duration, averageSpeed, averagePace, slopeBreakdown, calories, path, notes }` | 새 러닝 기록을 생성해 기존 기록 앞에 추가하고 저장 성공 시 상태를 업데이트합니다. 실패하면 알림을 띄웁니다. |
| `updateRunRecord(recordId, { title, notes })` | `recordId`: 수정 대상 ID, `title`: 새 제목, `notes`: 새 메모 | 지정한 기록의 텍스트 필드를 갱신해 저장하고 성공 시 사용자에게 알립니다. 대상이 없거나 저장 실패 시 토스트로 알립니다. |
| `deleteRunRecord(recordId)` | `recordId`: 삭제 대상 ID | 특정 기록을 제거해 저장한 뒤 성공 시 상태를 갱신하고 안내합니다. 대상을 찾지 못하거나 저장 실패 시 알림을 띄웁니다. |
| `computeCalorieSample({ weightKg, speedKmh, inclinePercent, sampleSeconds })` | 체중, 속도, 경사, 구간 시간 | 공용 칼로리 계산 유틸을 호출해 지정 구간의 예상 칼로리를 반환합니다. |
| `sampleCalories({ speedKmh, sampleSeconds })` | `speedKmh`: 속도(km/h), `sampleSeconds`: 구간 시간(초) | 저장된 프로필(없으면 기본값)을 사용해 칼로리를 계산하고, 기본값 사용 여부 및 프로필 로딩 상태를 함께 반환합니다. |

> 제공 값: 컨텍스트는 위 함수 외에도 러닝 진행 여부, 총 거리·시간, 추천 코스 정보, 기록 목록, 프로필, 누적 칼로리 등의 상태 값을 노출합니다.

## 코스/경사 유틸 (src/utils/courseHelpers.ts)

| 함수 | 파라미터 | 동작 요약 |
| --- | --- | --- |
| `smoothSlopeValues(slopeValues, options?)` | `slopeValues`: 경사 배열, `options.windowSize`: 이동 평균 길이, `options.clampMax`: 경사 절댓값 상한 | 중앙값 기반의 이동 평균으로 경사 데이터를 부드럽게 만들고 ±`clampMax` 범위로 잘라낸 배열을 반환합니다. |
| `classifySlope(value)` | `value`: 경사도(%) | 경사 수치에 따라 `flat`, `moderate`, `steep` 중 하나의 난이도 구간을 반환합니다. |
| `geoJsonToCoordinates(course)` | `course`: GeoJSON FeatureCollection 또는 단순 좌표 배열 | 다양한 입력 형식을 표준 `{latitude, longitude}` 배열로 변환하며, 위도·경도 순서를 자동 교정합니다. |
| `coordinatesToGeoJson(coordinates)` | `coordinates`: `[lon, lat]` 또는 `[lat, lon]` 배열 | 주어진 좌표 배열을 LineString 형태의 GeoJSON FeatureCollection으로 감쌉니다. |
| `buildSlopeSegments(coordinates, slopeValues?)` | `coordinates`: 위치 배열, `slopeValues`: 경사 배열 | 인접 좌표쌍 간 거리를 계산하고, 스무딩된 경사값으로 색상·난이도가 지정된 세그먼트 목록을 생성합니다. |
| `summarizeSegments(segments)` | `segments`: `buildSlopeSegments` 결과 | 평지/중간/급경사 거리 합과 총 거리를 km 단위로 요약한 객체를 반환합니다. |
| `normalizeDifficultyType(raw)` | `raw`: 난이도 문자열 | 서버/스토리지 난이도 문자열을 `hard`·`normal`·`easy` 중 하나로 정규화하거나 정보가 없으면 `null`을 반환합니다. |
| `getDifficultyBySlope(summary)` | `summary`: `{ flat, moderate, steep }` 거리 요약 | 급경사 비율을 기준으로 난이도(`hard`/`normal`/`easy`)를 추정합니다. |
| `buildDifficultyLabel({ difficultyType, slopeSummary })` | 명시적 난이도 또는 경사 요약 | 명시 난이도가 우선이며, 없을 경우 경사 비율로 난이도 레이블(영문·한글 병기)을 생성합니다. |
| `getBoundingRegion(coordinates, paddingFactor?)` | `coordinates`: 좌표 배열, `paddingFactor`: 여백 비율 | 지도 표시를 위한 중심 좌표와 latitude/longitude 델타 값을 계산해 반환합니다. 좌표가 없으면 서울 시청 근처 기본값을 제공합니다. |

## 칼로리 계산 유틸 (src/utils/calorieCalculator.ts)

| 함수 | 파라미터 | 동작 요약 |
| --- | --- | --- |
| `estimateMet({ speedKmh, inclinePercent })` | 속도(km/h), 경사(%) | 속도-기반 MET 테이블을 선형 보간하고 경사 보정 계수를 곱해 추정 MET 값을 계산합니다(최소 1 보장). |
| `computeCalorieSample({ weightKg, speedKmh, inclinePercent, sampleSeconds })` | 체중(kg), 속도(km/h), 경사(%), 구간 시간(초) | 추정 MET에 체중·시간을 곱해 샘플 구간의 칼로리를 계산합니다. |

## 고도 처리 유틸 (src/utils/altitudeHelpers.ts)

| 함수 | 파라미터 | 동작 요약 |
| --- | --- | --- |
| `pressureToAltitude(pressure)` | `pressure`: 기압(hPa) | 해수면 기준 기압을 사용해 고도를 미터 단위로 환산합니다. 유효하지 않은 값이면 `null`을 반환합니다. |
| `buildAltitudeSegments(points)` | `points`: `{ latitude, longitude, altitude }` 배열 | 인접 지점 간 고도 차이를 계산해 색상·고도 변화값이 포함된 세그먼트를 생성합니다. 고도 데이터가 없으면 빈 배열을 반환합니다. |
| `summarizeAltitude(points)` | `points`: 고도 포함 좌표 배열 | 각 구간의 상승/하강량을 합산해 `{ gain, loss }` 형태로 반환합니다. |
| `formatRelativeAltitude(relative)` | `relative`: 기준 대비 고도(m) | 유효한 값이면 `±X.X m` 형식의 문자열로, 없으면 `"기준 측정 중"`으로 표시합니다. |
