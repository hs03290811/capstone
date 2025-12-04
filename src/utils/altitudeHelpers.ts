import type { LatLng } from './courseHelpers';

const SEA_LEVEL_PRESSURE = 1013.25;

export type AltitudePoint = LatLng & { altitude?: number | null };

export type AltitudeSegment = {
  coordinates: LatLng[];
  color: string;
  gainMeters: number;
};

const ALTITUDE_GRADIENT = [
  { threshold: -8, color: '#0EA5E9' }, // 급 하강
  { threshold: -3, color: '#22C55E' }, // 완만한 하강
  { threshold: 2, color: '#A3E635' }, // 거의 평지
  { threshold: 6, color: '#F59E0B' }, // 중간 상승
  { threshold: Infinity, color: '#EF4444' }, // 가파른 상승
];

export function pressureToAltitude(pressure?: number | null): number | null {
  if (!Number.isFinite(pressure)) return null;
  const ratio = (pressure as number) / SEA_LEVEL_PRESSURE;
  return 44330 * (1 - Math.pow(ratio, 0.1903));
}

function pickAltitudeColor(gainMeters: number): string {
  const clampedGain = Math.max(-20, Math.min(20, gainMeters));
  const palette = ALTITUDE_GRADIENT.find((item) => clampedGain <= item.threshold);
  return palette?.color ?? '#A3E635';
}

export function buildAltitudeSegments(points: AltitudePoint[]): AltitudeSegment[] {
  if (!Array.isArray(points) || points.length < 2) return [];
  const hasAltitude = points.some((point) => Number.isFinite(point?.altitude));
  if (!hasAltitude) return [];

  return points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    const currentAlt = Number.isFinite(point.altitude) ? (point.altitude as number) : null;
    const nextAlt = Number.isFinite(next.altitude) ? (next.altitude as number) : currentAlt;
    const gainMeters = currentAlt != null && nextAlt != null ? nextAlt - currentAlt : 0;

    return {
      coordinates: [
        { latitude: point.latitude, longitude: point.longitude },
        { latitude: next.latitude, longitude: next.longitude },
      ],
      color: pickAltitudeColor(gainMeters),
      gainMeters,
    };
  });
}

export function summarizeAltitude(points: AltitudePoint[]) {
  return points.slice(1).reduce(
    (acc, point, index) => {
      const prev = points[index];
      if (!Number.isFinite(point.altitude) || !Number.isFinite(prev?.altitude)) return acc;
      const diff = (point.altitude as number) - (prev.altitude as number);
      if (diff > 0) acc.gain += diff;
      else if (diff < 0) acc.loss += Math.abs(diff);
      return acc;
    },
    { gain: 0, loss: 0 }
  );
}

export function formatRelativeAltitude(relative?: number | null) {
  if (!Number.isFinite(relative)) return '기준 측정 중';
  const value = relative as number;
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)} m`;
}
