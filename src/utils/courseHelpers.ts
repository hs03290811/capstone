import * as geolib from 'geolib';

export type LatLng = { latitude: number; longitude: number };

export type ColoredSegment = {
  coordinates: LatLng[];
  slope: 'flat' | 'moderate' | 'steep';
  color: string;
  distanceMeters: number;
  slopeValue?: number | null;
};

// API 및 화면 전역에서 공유하는 난이도 타입 정의
export type DifficultyType = 'hard' | 'normal' | 'easy';

// 난이도별 표시 라벨 (영문+한글 병기)
export const DIFFICULTY_LABELS: Record<DifficultyType, string> = {
  hard: 'Hard (도전)',
  normal: 'Normal (보통)',
  easy: 'Easy (완만)',
};

export const SLOPE_COLORS: Record<ColoredSegment['slope'], string> = {
  flat: '#34C759',
  moderate: '#FFCC00',
  steep: '#FF3B30',
};

// 경사도 수치에 따라 구간 난이도를 분류하는 보조 함수
export function classifySlope(value?: number | null): ColoredSegment['slope'] {
  if (!Number.isFinite(value)) return 'flat';
  if (value >= 13) return 'steep';
  if (value >= 5) return 'moderate';
  return 'flat';
}

/** GeoJSON FeatureCollection(LineString) → RN Maps 좌표 배열 */
export function geoJsonToCoordinates(course: unknown): LatLng[] {
  // 좌표 배열을 LatLng 객체로 변환하면서 lat/long 순서 오류를 보정하는 내부 헬퍼
  const normalizePair = (pair: [number, number]): LatLng | null => {
    const [first, second] = pair;
    const isLatFirst = Math.abs(first) <= 90 && Math.abs(second) <= 180 && Math.abs(second) > 90;

    const latitude = isLatFirst ? first : second;
    const longitude = isLatFirst ? second : first;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

    return { latitude, longitude };
  };

  // API에서 전달되는 좌표 형태가 다양해졌기 때문에, 아래 순서로 형식을 판별합니다.
  // 1) 이미 LatLng 객체 배열인 경우 → 그대로 반환
  if (Array.isArray(course) && course.every((item) => typeof item?.latitude === 'number' && typeof item?.longitude === 'number')) {
    return course as LatLng[];
  }

  // 2) 서버가 단순 배열([[lon, lat] 또는 [lat, lon], ...])을 내려준 경우 → 바로 변환
  if (Array.isArray(course) && (course as unknown[]).every((pair) => Array.isArray(pair) && pair.length >= 2)) {
    return (course as Array<[number, number]>).map(normalizePair).filter(Boolean) as LatLng[];
  }

  // 3) 기존 GeoJSON FeatureCollection(LineString) 포맷 → 좌표 추출
  const collection = (course as { features?: Array<{ geometry?: { type?: string; coordinates?: [number, number][] } }> })?.features;
  if (!Array.isArray(collection) || collection.length === 0) return [];

  return collection.flatMap((feature) => {
    if (feature?.geometry?.type !== 'LineString') return [];
    const coordinates = feature.geometry.coordinates;
    if (!Array.isArray(coordinates)) return [];

    return coordinates.map(normalizePair).filter(Boolean) as LatLng[];
  });
}

/** 단순 좌표 배열([[lon, lat], ...])을 기존 화면 로직에서 사용하는 GeoJSON 형태로 감싼다. */
export function coordinatesToGeoJson(coordinates: Array<[number, number]>) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: coordinates.filter((pair) => Array.isArray(pair) && pair.length >= 2),
        },
      },
    ],
  };
}

/**
 * 좌표 배열을 세 가지 경사도로 순환 배정하여 색상 세그먼트로 반환합니다.
 * 실제 API 연동 전까지 시각화를 제공하기 위한 임시 로직입니다.
 */
export function buildSlopeSegments(
  coordinates: LatLng[],
  slopeValues: Array<number | null | undefined> = [],
): ColoredSegment[] {
  if (coordinates.length < 2) return [];

  // 좌표 구간별 경사도를 실제 값에 맞춰 색상으로 표시
  return coordinates.slice(0, -1).map((point, index) => {
    const next = coordinates[index + 1];
    const slopeValue = slopeValues[index];
    const slope = classifySlope(slopeValue);
    const distanceMeters = geolib.getDistance(point, next);

    return {
      coordinates: [point, next],
      slope,
      color: SLOPE_COLORS[slope],
      distanceMeters,
      slopeValue: slopeValue ?? null,
    };
  });
}

export function summarizeSegments(segments: ColoredSegment[]) {
  const initial = { flat: 0, moderate: 0, steep: 0 };
  const totals = segments.reduce((acc, segment) => {
    acc[segment.slope] += segment.distanceMeters;
    return acc;
  }, initial);

  const totalDistanceMeters = totals.flat + totals.moderate + totals.steep;

  return {
    ...totals,
    totalDistanceKm: totalDistanceMeters / 1000,
  };
}

// 서버/스토리지에서 내려오는 난이도 문자열을 표준 타입으로 맞추는 헬퍼
export function normalizeDifficultyType(raw?: string | null): DifficultyType | null {
  if (!raw) return null;

  const lower = raw.toString().trim().toLowerCase();

  if (['hard', '도전', '어려움', '고난도'].includes(lower)) return 'hard';
  if (['normal', '보통', '중간'].includes(lower)) return 'normal';
  if (['easy', '완만', '쉬움'].includes(lower)) return 'easy';

  return null;
}

// 경사 요약 값을 기반으로 난이도를 역산하는 헬퍼 (데이터 미제공 시 정보 없음 반환)
export function getDifficultyBySlope(
  summary?: { flat: number; moderate: number; steep: number } | null,
): DifficultyType | null {
  if (!summary) return null;

  const total = (summary.flat || 0) + (summary.moderate || 0) + (summary.steep || 0);
  if (total <= 0) return null;

  const steepRatio = (summary.steep || 0) / total;
  if (steepRatio > 0.25) return 'hard';
  if (steepRatio > 0.15) return 'normal';
  return 'easy';
}

/**
 * 난이도 텍스트를 일관성 있게 계산하는 공용 함수
 * - 명시적 difficultyType이 있으면 이를 우선 사용하고,
 * - 없으면 경사 요약(summary) 비율로 산출합니다.
 */
export function buildDifficultyLabel(input: {
  difficultyType?: string | null;
  slopeSummary?: { flat: number; moderate: number; steep: number } | null;
}): string {
  const normalized = normalizeDifficultyType(input?.difficultyType);
  if (normalized) return DIFFICULTY_LABELS[normalized];

  const derived = getDifficultyBySlope(input?.slopeSummary ?? null);
  if (derived) return DIFFICULTY_LABELS[derived];

  return '정보 없음';
}

export function getBoundingRegion(coordinates: LatLng[], paddingFactor = 1.3) {
  if (!coordinates.length) {
    return {
      latitude: 37.5665,
      longitude: 126.978,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
  }

  let minLat = coordinates[0].latitude;
  let maxLat = coordinates[0].latitude;
  let minLng = coordinates[0].longitude;
  let maxLng = coordinates[0].longitude;

  coordinates.forEach((point) => {
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLng = Math.min(minLng, point.longitude);
    maxLng = Math.max(maxLng, point.longitude);
  });

  const latitudeDelta = Math.max((maxLat - minLat) * paddingFactor, 0.005);
  const longitudeDelta = Math.max((maxLng - minLng) * paddingFactor, 0.005);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}
