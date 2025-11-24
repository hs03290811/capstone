// 칼로리 계산 유틸리티: 속도 기반 MET 추정과 경사 보정만 사용한다.
// 구조 개요: 기본 프로필 상수, 입력 타입 정의, MET 추정 함수, 샘플 칼로리 계산 함수.

export type CalorieSamplePayload = {
  // 러너 체중(kg)
  weightKg?: number;
  // 순간 속도(km/h)
  speedKmh?: number;
  // 경사도(%)
  inclinePercent?: number;
  // 샘플 구간 시간(초)
  sampleSeconds?: number;
};

// 안전한 기본 입력값: 무게 60kg, 경사 0%, 시간 0초, 속도 0km/h.
export const DEFAULT_PROFILE: Required<CalorieSamplePayload> = {
  weightKg: 60,
  speedKmh: 0,
  inclinePercent: 0,
  sampleSeconds: 0,
};

// 속도 → MET 테이블. 속도 구간 사이에서는 선형 보간한다.
const SPEED_MET_TABLE = [
  { speedKmh: 0, met: 1 },
  { speedKmh: 3, met: 2.5 },
  { speedKmh: 5, met: 4 },
  { speedKmh: 6.5, met: 6 },
  { speedKmh: 8, met: 8.5 },
  { speedKmh: 10, met: 10.5 },
  { speedKmh: 12, met: 12.5 },
];

// 경사(±15%)에 대한 GAP 보정 계수. +15%면 +15% 증폭, -15%면 -15% 감쇠.
const GAP_INCLINE_COEFFICIENT = 0.15;
const INCLINE_LIMIT_PERCENT = 15;

// 경사 계수를 계산한다. 경사 범위를 ±15%로 제한하고, 선형으로 가중한다.
const computeInclineFactor = (inclinePercent: number): number => {
  const boundedIncline = Math.max(-INCLINE_LIMIT_PERCENT, Math.min(INCLINE_LIMIT_PERCENT, inclinePercent));
  return 1 + (boundedIncline / INCLINE_LIMIT_PERCENT) * GAP_INCLINE_COEFFICIENT;
};

// 속도와 경사만을 사용해 MET를 추정한다.
export const estimateMet = (payload: CalorieSamplePayload): number => {
  const speedKmh = Math.max(0, payload.speedKmh ?? DEFAULT_PROFILE.speedKmh);
  const inclinePercent = payload.inclinePercent ?? DEFAULT_PROFILE.inclinePercent;

  // 속도 기반 MET 보간
  let baseMet = SPEED_MET_TABLE[0].met;
  for (let i = 1; i < SPEED_MET_TABLE.length; i += 1) {
    const prev = SPEED_MET_TABLE[i - 1];
    const curr = SPEED_MET_TABLE[i];
    if (speedKmh <= curr.speedKmh) {
      const ratio = (speedKmh - prev.speedKmh) / (curr.speedKmh - prev.speedKmh || 1);
      baseMet = prev.met + ratio * (curr.met - prev.met);
      break;
    }
    baseMet = curr.met;
  }

  const inclineFactor = computeInclineFactor(inclinePercent);
  const metWithIncline = baseMet * inclineFactor;

  // MET는 최소 1로 유지해 과도한 감쇠를 방지한다.
  return Math.max(1, metWithIncline);
};

// 샘플 구간 칼로리를 계산한다: MET × 체중(kg) × 시간(시간).
export const computeCalorieSample = (payload: CalorieSamplePayload): number => {
  const weightKg = Math.max(0, payload.weightKg ?? DEFAULT_PROFILE.weightKg);
  const sampleSeconds = Math.max(0, payload.sampleSeconds ?? DEFAULT_PROFILE.sampleSeconds);
  const durationHours = sampleSeconds / 3600;

  const met = estimateMet(payload);
  return met * weightKg * durationHours;
};