import * as geolib from 'geolib';

export type LatLng = { latitude: number; longitude: number };

export type ColoredSegment = {
  coordinates: LatLng[];
  slope: 'flat' | 'moderate' | 'steep';
  color: string;
  distanceMeters: number;
};

export const SLOPE_COLORS: Record<ColoredSegment['slope'], string> = {
  flat: '#34C759',
  moderate: '#FFCC00',
  steep: '#FF3B30',
};

/** GeoJSON FeatureCollection(LineString) → RN Maps 좌표 배열 */
export function geoJsonToCoordinates(course: unknown): LatLng[] {
  const collection = (course as { features?: Array<{ geometry?: { type?: string; coordinates?: [number, number][] } }> })?.features;
  if (!Array.isArray(collection) || collection.length === 0) return [];

  return collection.flatMap((feature) => {
    if (feature?.geometry?.type !== 'LineString') return [];
    const coordinates = feature.geometry.coordinates;
    if (!Array.isArray(coordinates)) return [];

    return coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));
  });
}

/**
 * 좌표 배열을 세 가지 경사도로 순환 배정하여 색상 세그먼트로 반환합니다.
 * 실제 API 연동 전까지 시각화를 제공하기 위한 임시 로직입니다.
 */
export function buildSlopeSegments(coordinates: LatLng[]): ColoredSegment[] {
  if (coordinates.length < 2) return [];

  const slopeCycle: ColoredSegment['slope'][] = ['flat', 'moderate', 'steep'];

  return coordinates.slice(0, -1).map((point, index) => {
    const next = coordinates[index + 1];
    const slope = slopeCycle[index % slopeCycle.length];
    const distanceMeters = geolib.getDistance(point, next);

    return {
      coordinates: [point, next],
      slope,
      color: SLOPE_COLORS[slope],
      distanceMeters,
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
