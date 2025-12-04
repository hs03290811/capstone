import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { ToastAndroid } from 'react-native';
import Config from 'react-native-config';
import * as geolib from 'geolib'; // 거리 계산 라이브러리
import { computeCalorieSample } from '../utils/calorieCalculator';
import {
    buildSlopeSegments,
    coordinatesToGeoJson,
    geoJsonToCoordinates,
    normalizeDifficultyType,
    summarizeSegments,
} from '../utils/courseHelpers';
import MOCK_RECOMMENDATION_PAYLOAD from '../utils/mockRecommendations';

const RunningContext = createContext();
const HISTORY_STORAGE_KEY = 'running_history_records';
const USER_PROFILE_STORAGE_KEY = 'running_user_profile';
const DEFAULT_PROFILE = {
    weightKg: 65,
};
const DEFAULT_INCLINE_PERCENT = 0;
let inMemoryHistory = null; // AsyncStorage/백엔드가 없는 테스트 환경용 메모리 캐시
let inMemoryProfile = null; // 프로필도 테스트 환경에서 기억하기 위한 메모리 캐시

export const RunningProvider = ({ children }) => {
    // ----------------------------------------------------
    // --- 핵심 상태 (State) ---
    // ----------------------------------------------------
    const [isRunning, setIsRunning] = useState(false);
    const [totalDistanceMeters, setTotalDistanceMeters] = useState(0);
    const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
    const [lastKnownPosition, setLastKnownPosition] = useState(null);
    const [recommendedCourse, setRecommendedCourse] = useState(null);
    const [recommendedCourseInfo, setRecommendedCourseInfo] = useState(null);
    const [recommendedCourseSegments, setRecommendedCourseSegments] = useState([]); // 지도/목록에서 재사용할 경사 세그먼트
    const [recommendedCourseSummary, setRecommendedCourseSummary] = useState(null); // 경사 합계를 빠르게 불러오기 위한 요약값
    const [recommendedCourseVoiceGuides, setRecommendedCourseVoiceGuides] = useState([]);
    const [recommendedCourses, setRecommendedCourses] = useState([]);
    const [isRecommendationLoading, setIsRecommendationLoading] = useState(false);
    const [historyRecords, setHistoryRecords] = useState([]); // 백엔드/스토리지 데이터만 사용
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [isHistorySyncAttempted, setIsHistorySyncAttempted] = useState(false);
    const [userPath, setUserPath] = useState([]);
    const [userProfile, setUserProfile] = useState(DEFAULT_PROFILE); // 체중만 관리하는 간단한 프로필 상태
    const [isProfileLoading, setIsProfileLoading] = useState(true); // 프로필 로딩 여부(초기 경고 방지)
    const [isProfileLoaded, setIsProfileLoaded] = useState(false); // 프로필 로드 완료 여부
    const [caloriesBurned, setCaloriesBurned] = useState(0); // 실시간 누적 칼로리 상태
    
    const intervalRef = useRef(null);
    const totalDistanceKm = totalDistanceMeters / 1000;

    const formatTime = (totalSeconds) => {
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    };

    // ----------------------------------------------------
    // --- 핵심 함수 (Actions) ---
    // ----------------------------------------------------
    
    const startRunning = () => {
        if (isRunning) return;

        // 러닝 타이머만 증가시키고, 실제 이동 거리는 GPS 업데이트로만 반영한다.
        setIsRunning(true);
        console.log("러닝 시작: 타이머 가동");

        intervalRef.current = setInterval(() => {
            setCurrentTimeSeconds(prevTime => prevTime + 1);
        }, 1000);
    };

    const stopRunning = () => {
        if (!isRunning) return;
        setIsRunning(false);
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    };
    
    const lastKnownPositionRef = useRef(null);

    // GPS 위치 수신 및 거리 계산 (FE 1 호출용)
    const updateUserLocation = useCallback((latitude, longitude, altitude = null) => {
        if (!isRunning) return;

        const newPosition = { latitude, longitude };
        if (Number.isFinite(altitude)) {
            newPosition.altitude = Number(altitude);
        }

        const prevPosition = lastKnownPositionRef.current;
        if (prevPosition) {
            const distanceInMeters = geolib.getDistance(
                prevPosition,
                newPosition
            );
            setTotalDistanceMeters(prevDistance => prevDistance + distanceInMeters);
        }

        lastKnownPositionRef.current = newPosition;
        setLastKnownPosition(newPosition);
        setUserPath((prev) => [...prev, newPosition]);

    }, [isRunning]);

    /**
     * 추천 코스 조회 플로우
     * 1) 상태 리셋 → 2) 추천 API 호출 → 3) GeoJSON 응답을 내부 표준 구조로 변환 → 4) 경사 세그먼트/거리 재계산 후 저장
     * - 백엔드가 반환하는 FeatureCollection 포맷만 처리하며, 과거 route 배열 포맷은 제거했다.
     */
    const fetchCourseRecommendation = async (distanceKm, _slope, currentLocation) => {
        setIsRecommendationLoading(true);
        setRecommendedCourse(null);
        setRecommendedCourseInfo(null);
        setRecommendedCourseSegments([]);
        setRecommendedCourseSummary(null);
        setRecommendedCourseVoiceGuides([]);

        // 백엔드 응답 스펙(GeoJSON FeatureCollection) 전용 파서
        const normalizeCoursePayload = (payload = {}) => {
            if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) return [];

            return payload.features.map((feature, index) => {
                const coordinates = Array.isArray(feature?.geometry?.coordinates)
                    ? feature.geometry.coordinates
                    : [];
                const slopeValues = Array.isArray(feature?.properties?.slopes)
                    ? feature.properties.slopes
                    : [];
                // 백엔드가 km 단위(예: 1.86)나 m 단위(예: 5200)로 혼재해 내려오는 경우를 모두 처리한다.
                const rawDistance = Number(feature?.properties?.total_distance ?? 0);
                const totalDistanceMeters = rawDistance > 0 && rawDistance < 50
                    ? rawDistance * 1000
                    : rawDistance;
                const estimatedTimeMinutes = feature?.properties?.total_time_min;
                const averageSlope = Number(feature?.properties?.avg_slope);
                const elevations = Array.isArray(feature?.properties?.elevations)
                    ? feature.properties.elevations
                    : [];
                const voiceGuides = Array.isArray(feature?.properties?.voice_guides)
                    ? feature.properties.voice_guides
                    : [];

                return {
                    id: feature?.properties?.label ?? index,
                    courseName: feature?.properties?.label || `추천 코스 ${index + 1}`,
                    coordinates,
                    slopeValues,
                    elevations,
                    voiceGuides,
                    totalDistanceMeters,
                    estimatedTimeMinutes,
                    difficultyType: normalizeDifficultyType(feature?.properties?.type),
                    averageSlope,
                };
            });
        };

        const buildCourseEntities = (normalizedCourses = []) => {
            const entities = (Array.isArray(normalizedCourses) ? normalizedCourses : []).map((item, index) => {
                const coursePath = coordinatesToGeoJson(item.coordinates);
                const latLngs = geoJsonToCoordinates(coursePath);

                // 1) 좌표-경사 배열 길이를 맞춰 잘라낸다.
                const trimmedSlopeValues = Array.isArray(item.slopeValues)
                    ? item.slopeValues.slice(0, Math.max(0, latLngs.length - 1))
                    : [];

                const rawSlopeSegments = buildSlopeSegments(latLngs, trimmedSlopeValues);
                const rawDistanceSum = rawSlopeSegments.reduce((sum, seg) => sum + seg.distanceMeters, 0);

                const resolvedVoiceGuides = (Array.isArray(item.voiceGuides) ? item.voiceGuides : [])
                    .map((guide) => {
                        const indexValue = Number(guide?.index);
                        const message = typeof guide?.message === 'string' ? guide.message.trim() : '';
                        if (!Number.isFinite(indexValue) || !message) return null;
                        const coordinate = latLngs?.[indexValue];
                        if (!coordinate) return null;
                        return { index: indexValue, message, coordinate };
                    })
                    .filter(Boolean);

                // 2) 서버 total_distance와 직선거리 합이 어긋나는 경우 비율로 스케일링
                const targetDistanceMeters = Number(item.totalDistanceMeters) || rawDistanceSum;
                const rescaledSegments = rawDistanceSum > 0 && targetDistanceMeters > 0
                    ? rawSlopeSegments.map((seg) => ({
                        ...seg,
                        distanceMeters: (seg.distanceMeters * targetDistanceMeters) / rawDistanceSum,
                    }))
                    : rawSlopeSegments;

                // 3) 부동소수점 누적 오차로 합계가 살짝 어긋나면 마지막 세그먼트에 보정값을 반영한다.
                const scaledDistanceSum = rescaledSegments.reduce((sum, seg) => sum + seg.distanceMeters, 0);
                const distanceGap = targetDistanceMeters - scaledDistanceSum;
                const normalizedSlopeSegments = rescaledSegments.map((seg, segIndex) => {
                    if (segIndex !== rescaledSegments.length - 1) return seg;
                    const adjusted = Math.max(0, seg.distanceMeters + distanceGap);
                    return { ...seg, distanceMeters: adjusted };
                });

                const slopeSummary = summarizeSegments(normalizedSlopeSegments);

                const totalDistanceMeters = targetDistanceMeters || slopeSummary.totalDistanceKm * 1000;
                const estimatedTimeMinutes =
                    Number(item.estimatedTimeMinutes) || Math.round((totalDistanceMeters / 1000 / 8) * 60);
                const averageSlope = Number.isFinite(item.averageSlope)
                    ? item.averageSlope
                    : (() => {
                        // 경사 평균값이 누락된 경우, 각 세그먼트 경사도를 거리 가중 평균으로 계산한다.
                        const weighted = normalizedSlopeSegments.reduce(
                            (acc, seg) => {
                                const slopeValue = Number(seg.slopeValue);
                                if (!Number.isFinite(slopeValue)) return acc;
                                return {
                                    distance: acc.distance + seg.distanceMeters,
                                    sum: acc.sum + slopeValue * seg.distanceMeters,
                                };
                            },
                            { distance: 0, sum: 0 },
                        );

                        return weighted.distance > 0 ? weighted.sum / weighted.distance : null;
                    })();

                return {
                    id: String(item.id ?? index),
                    courseName: item.courseName || `추천 코스 ${index + 1}`,
                    totalDistanceKm: totalDistanceMeters / 1000,
                    estimatedTimeMinutes,
                    coursePath,
                    slopeSegments: normalizedSlopeSegments,
                    slopeSummary,
                    voiceGuides: resolvedVoiceGuides,
                    difficultyType: item.difficultyType ?? normalizeDifficultyType(item?.type),
                    averageSlope,
                };
            });

            // 팀 기준에 맞춰 상대 난이도로 재분류: 평균 경사도가 가장 낮은 코스는 easy, 다음은 normal, 가장 높은 코스는 hard.
            const difficultyMetric = entities.map((course, idx) => {
                const averageSlope = Number(course.averageSlope);
                // 경사 평균이 없을 때는 요약 값으로 대체 (steep 비율을 %처럼 사용)
                const fallbackSlope = (() => {
                    const summary = course.slopeSummary;
                    if (!summary) return null;
                    const total = (summary.flat || 0) + (summary.moderate || 0) + (summary.steep || 0);
                    if (total <= 0) return null;
                    return (summary.steep || 0) / total * 100;
                })();

                return {
                    index: idx,
                    metric: Number.isFinite(averageSlope) ? Math.abs(averageSlope) : Math.abs(fallbackSlope ?? 0),
                };
            });

            const sorted = difficultyMetric.slice().sort((a, b) => a.metric - b.metric);
            const labels = ['easy', 'normal', 'hard'];
            const assigned = {};

            sorted.forEach((item, position) => {
                const label = labels[Math.min(position, labels.length - 1)];
                assigned[item.index] = label;
            });

            return sorted.map((item) => {
                const course = entities[item.index];
                return {
                    ...course,
                    difficultyType: assigned[item.index] || course.difficultyType || null,
                };
            });
        };

        // 유효성 에러 메시지 추출용 헬퍼 (새 API의 detail 배열 대응)
        const extractValidationMessage = (payload = {}) => {
            const details = payload?.detail;

            // FastAPI 기본 형태: detail: [ { loc: [...], msg: '...', type: '...' } ]
            if (Array.isArray(details) && details.length > 0) {
                const first = details[0];
                const locText = Array.isArray(first?.loc) ? first.loc.join(' > ') : '';
                const msgText = first?.msg || first?.message || '';
                return [locText, msgText].filter(Boolean).join(': ');
            }

            // 문자열 detail만 내려오는 경우도 처리
            if (typeof details === 'string') return details;

            // 객체 detail에서 msg/message/error 필드 추출
            if (details && typeof details === 'object') {
                const locText = Array.isArray(details.loc) ? details.loc.join(' > ') : '';
                const msgText = details.msg || details.message || details.error;
                if (msgText) return [locText, msgText].filter(Boolean).join(': ');
            }

            // 최상위 message/error/detail 문자열도 후보로 사용
            const candidate = payload?.message || payload?.error || (typeof payload?.detail === 'string' ? payload.detail : null);
            return typeof candidate === 'string' ? candidate : null;
        };

        try {
            const targetKm = Number(distanceKm) || 0;
            const currentLat = currentLocation?.latitude ?? lastKnownPosition?.latitude;
            const currentLon = currentLocation?.longitude ?? lastKnownPosition?.longitude;

            if (!Number.isFinite(currentLat) || !Number.isFinite(currentLon)) {
                showUserNotification('현재 위치를 확인할 수 없습니다. 위치 권한을 확인해주세요.');
                setIsRecommendationLoading(false);
                return [];
            }

            // 실제 추천 API 호출
            const response = await fetch(`${Config.API_BASE_URL}/api/recommend`, {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    current_lat: currentLat,
                    current_lon: currentLon,
                    target_km: targetKm,
                }),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                const validationMessage = extractValidationMessage(data);
                const statusMessage = response.status ? `HTTP ${response.status}` : null;
                const composedMessage = validationMessage
                    ? `추천 코스 API 호출에 실패했습니다. (${validationMessage})`
                    : statusMessage
                        ? `추천 코스 API 호출에 실패했습니다. (${statusMessage})`
                        : '추천 코스 API 호출에 실패했습니다.';
                throw new Error(composedMessage);
            }

            const normalized = buildCourseEntities(normalizeCoursePayload(data));

            // 실제 백엔드에서 받은 데이터만 저장하고, 응답이 비었으면 빈 배열을 사용한다.
            setRecommendedCourses(normalized);
            return normalized;
        } catch (error) {
            console.log('추천 코스 호출 실패', error);
            showUserNotification(error.message || '코스 추천에 실패했습니다. 네트워크 상태를 확인해주세요.');
            // API가 불안정할 때를 대비해 간단한 목업 코스 데이터를 폴백으로 제공한다.
            try {
                const mocked = buildCourseEntities(normalizeCoursePayload(MOCK_RECOMMENDATION_PAYLOAD));
                if (mocked.length > 0) {
                    setRecommendedCourses(mocked);
                    showUserNotification('임시 코스를 불러왔습니다. 백엔드 연결이 복구되면 다시 시도해주세요.');
                    return mocked;
                }
            } catch (mockError) {
                console.log('목업 추천 로드 실패', mockError);
            }

            setRecommendedCourses([]);
            return [];
        } finally {
            setIsRecommendationLoading(false);
        }
    };

    const selectRecommendedCourse = (courseId) => {
        const target = recommendedCourses.find((course) => course.id === courseId);
        if (!target) return null;
        setRecommendedCourse(target.coursePath);
        setRecommendedCourseInfo({
            totalDistanceKm: target.totalDistanceKm,
            estimatedTimeMinutes: target.estimatedTimeMinutes,
            courseName: target.courseName,
            difficultyType: target.difficultyType,
            slopeSummary: target.slopeSummary,
            averageSlope: target.averageSlope,
        });
        setRecommendedCourseSegments(target.slopeSegments || []);
        setRecommendedCourseSummary(target.slopeSummary || null);
        setRecommendedCourseVoiceGuides(target.voiceGuides || []);
        return target;
    };

    // 모든 러닝 상태 초기화
    const resetRunData = () => {
        setTotalDistanceMeters(0);
        setCurrentTimeSeconds(0);
        setRecommendedCourse(null);
        setRecommendedCourseInfo(null);
        setRecommendedCourseSegments([]);
        setRecommendedCourseSummary(null);
        setRecommendedCourseVoiceGuides([]);
        setRecommendedCourses([]);
        setLastKnownPosition(null);
        setUserPath([]);
        setCaloriesBurned(0);
    };

    const showUserNotification = (message) => {
        // 사용자에게 간단한 안내를 전달하는 토스트 (안드로이드 기준)
        ToastAndroid?.show?.(message, ToastAndroid.SHORT);
    };

    const resolveAsyncStorage = useCallback(async () => {
        try {
            const asyncStorageModule = require('@react-native-async-storage/async-storage');
            return asyncStorageModule?.default || asyncStorageModule;
        } catch (error) {
            // 선택 의존성 미설치 시에도 앱이 계속 동작하도록 무시
            console.log('AsyncStorage 모듈 조회 실패: 로컬/백엔드 폴백으로 대체');
            return null;
        }
    }, []);

    /**
     * 사용자 프로필(체중) 정보를 단순 로드.
     * - 성별/나이/경사는 더 이상 관리하지 않는다.
     */
    const loadProfile = useCallback(async () => {
        setIsProfileLoading(true);

        let resolvedProfile = { ...DEFAULT_PROFILE };
        let shouldNotifyDefault = true;

        try {
            const AsyncStorage = await resolveAsyncStorage();
            if (AsyncStorage?.getItem) {
                const stored = await AsyncStorage.getItem(USER_PROFILE_STORAGE_KEY);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    resolvedProfile = {
                        weightKg: parsed?.weightKg ?? DEFAULT_PROFILE.weightKg,
                    };
                    inMemoryProfile = JSON.stringify(resolvedProfile);
                    shouldNotifyDefault = false;
                }
            }
        } catch (error) {
            console.log('사용자 프로필 로드 실패, 기본값으로 대체', error);
        }

        if (shouldNotifyDefault) {
            try {
                if (inMemoryProfile) {
                    const parsed = JSON.parse(inMemoryProfile);
                    resolvedProfile = {
                        weightKg: parsed?.weightKg ?? DEFAULT_PROFILE.weightKg,
                    };
                    shouldNotifyDefault = false;
                }
            } catch (error) {
                console.log('메모리 프로필 로드 실패, 기본값 사용', error);
            }
        }

        setUserProfile(resolvedProfile);
        if (shouldNotifyDefault) {
            showUserNotification('체중 기본값을 사용합니다.');
        }

        setIsProfileLoaded(true);
        setIsProfileLoading(false);
    }, [resolveAsyncStorage]);

    /**
     * 체중 프로필을 저장하고 상태와 캐시에 반영한다.
     * - AsyncStorage 저장 → 실패 시 메모리 캐시 폴백.
     */
    const saveProfile = useCallback(async ({ weightKg }) => {
        const safeProfile = {
            weightKg: Number.isFinite(Number(weightKg)) && Number(weightKg) > 0
                ? Number(weightKg)
                : DEFAULT_PROFILE.weightKg,
        };

        setUserProfile(safeProfile);
        setIsProfileLoaded(true);
        setIsProfileLoading(false);

        try {
            const AsyncStorage = await resolveAsyncStorage();
            if (AsyncStorage?.setItem) {
                await AsyncStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(safeProfile));
                inMemoryProfile = JSON.stringify(safeProfile);
                showUserNotification('프로필이 저장되었습니다.');
                return true;
            }
        } catch (error) {
            console.log('AsyncStorage 프로필 저장 실패, 메모리 캐시로 대체', error);
        }

        try {
            inMemoryProfile = JSON.stringify(safeProfile);
            showUserNotification('프로필이 저장되었습니다. (임시 캐시)');
            return true;
        } catch (error) {
            console.log('메모리 프로필 저장 실패', error);
        }

        showUserNotification('프로필 저장에 실패했습니다. 네트워크 상태를 확인해주세요.');
        return false;
    }, [resolveAsyncStorage]);

    const readHistoryFromStorage = useCallback(async () => {
        // AsyncStorage를 우선 시도하고, 없는 경우 메모리 캐시로 폴백
        try {
            const AsyncStorage = await resolveAsyncStorage();
            if (AsyncStorage?.getItem) {
                const stored = await AsyncStorage.getItem(HISTORY_STORAGE_KEY);
                if (stored) {
                    return JSON.parse(stored);
                }
            }
        } catch (error) {
            console.log('AsyncStorage 로드 실패, 메모리 캐시 시도', error);
        }

        if (inMemoryHistory) {
            return JSON.parse(inMemoryHistory);
        }
        return null;
    }, [resolveAsyncStorage]);

    const fetchHistoryFromBackend = useCallback(async () => {
        // 백엔드 연동 지점: 실제 API 호출로 대체 가능
        return null;
    }, []);

    const loadHistoryRecords = useCallback(async () => {
        if (isHistorySyncAttempted) return;

        setIsHistoryLoading(true);
        try {
            let loadedHistory = await readHistoryFromStorage();
            if (!loadedHistory || !Array.isArray(loadedHistory)) {
                loadedHistory = await fetchHistoryFromBackend();
            }

            if (loadedHistory && Array.isArray(loadedHistory)) {
                setHistoryRecords(loadedHistory);
                return;
            }

            // 백엔드/스토리지에 기록이 없을 때는 빈 배열로 초기화한다.
            setHistoryRecords([]);
            showUserNotification('저장된 러닝 기록이 없어 빈 목록을 사용합니다.');
        } catch (error) {
            console.log('러닝 기록 초기화 실패', error);
            setHistoryRecords([]);
            showUserNotification('러닝 기록을 불러오는 중 문제가 발생해 빈 목록을 사용합니다.');
        } finally {
            setIsHistorySyncAttempted(true);
            setIsHistoryLoading(false);
        }
    }, [fetchHistoryFromBackend, isHistorySyncAttempted, readHistoryFromStorage]);

    useEffect(() => {
        // 앱 시작/로그인 시 단 한 번 기록을 동기화
        loadHistoryRecords();
        loadProfile();
    }, [loadHistoryRecords, loadProfile]);

    const persistHistoryRecords = useCallback(async (records) => {
        // 저장 성공 여부를 boolean으로 반환하여 상태 업데이트 분기 처리
        try {
            const AsyncStorage = await resolveAsyncStorage();
            if (AsyncStorage?.setItem) {
                await AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
                return true;
            }
        } catch (error) {
            console.log('AsyncStorage 저장 실패, 메모리 캐시 시도', error);
        }

        try {
            // 메모리 캐시 폴백 (테스트 환경)
            inMemoryHistory = JSON.stringify(records);
            return true;
        } catch (error) {
            console.log('메모리 캐시 저장 실패', error);
        }

        // 백엔드 업로드 연동 지점 - 실패 시 false 반환
        return false;
    }, []);

    const addRunRecord = async ({
        title,
        date,
        distanceKm,
        duration,
        averageSpeed,
        averagePace,
        slopeBreakdown,
        calories,
        path,
        notes,
    }) => {
        const newRecord = {
            id: Date.now().toString(),
            title,
            date,
            distanceKm,
            duration,
            averageSpeed,
            averagePace,
            slopeBreakdown: slopeBreakdown || { flat: 100, moderate: 0, steep: 0 },
            calories,
            path,
            notes: notes?.trim?.() || '러닝 결과 저장됨',
        };
        const nextRecords = [newRecord, ...historyRecords];
        const isSaved = await persistHistoryRecords(nextRecords);

        if (isSaved) {
            setHistoryRecords(nextRecords);
            return true;
        }

        showUserNotification('러닝 기록 저장에 실패했습니다. 네트워크 상태를 확인해주세요.');
        return false;
    };

    /**
     * 저장된 러닝 기록의 제목/메모를 수정한다.
     * - 기본 지표는 서버/센서에서 수집된 값을 유지한 채 텍스트만 교체한다.
     */
    const updateRunRecord = async (recordId, { title, notes }) => {
        const targetIndex = historyRecords.findIndex((record) => record.id === recordId);
        if (targetIndex === -1) {
            showUserNotification('수정할 기록을 찾을 수 없습니다.');
            return false;
        }

        const current = historyRecords[targetIndex];
        const updated = {
            ...current,
            title: title?.trim?.() || current.title,
            notes: notes?.trim?.() || current.notes,
        };

        const nextRecords = [...historyRecords];
        nextRecords[targetIndex] = updated;

        const isSaved = await persistHistoryRecords(nextRecords);
        if (isSaved) {
            setHistoryRecords(nextRecords);
            showUserNotification('기록이 업데이트되었습니다.');
            return true;
        }

        showUserNotification('기록을 수정하는 중 문제가 발생했습니다.');
        return false;
    };

    /**
     * 선택한 러닝 기록을 완전히 삭제한다.
     */
    const deleteRunRecord = async (recordId) => {
        const filtered = historyRecords.filter((record) => record.id !== recordId);
        if (filtered.length === historyRecords.length) {
            showUserNotification('삭제할 기록을 찾을 수 없습니다.');
            return false;
        }

        const isSaved = await persistHistoryRecords(filtered);
        if (isSaved) {
            setHistoryRecords(filtered);
            showUserNotification('기록이 삭제되었습니다.');
            return true;
        }

        showUserNotification('기록 삭제에 실패했습니다.');
        return false;
    };

    /**
     * 프로필이 없을 때 체중 기본값을 사용하여 샘플 칼로리를 계산한다.
     */
    const sampleCalories = useCallback(({ speedKmh, sampleSeconds }) => {
        const hasWeight = Number.isFinite(userProfile?.weightKg) && userProfile.weightKg > 0;
        const isProfileMissing = !hasWeight;
        const usedDefaultProfile = isProfileLoaded && isProfileMissing;

        const targetIncline = (() => {
            const weighted = recommendedCourseSegments.reduce(
                (acc, seg) => {
                    const slopeValue = Number(seg?.slopeValue);
                    if (!Number.isFinite(slopeValue) || !Number.isFinite(seg?.distanceMeters) || seg.distanceMeters <= 0) {
                        return acc;
                    }
                    return {
                        distance: acc.distance + seg.distanceMeters,
                        sum: acc.sum + slopeValue * seg.distanceMeters,
                    };
                },
                { distance: 0, sum: 0 },
            );

            if (weighted.distance <= 0) return DEFAULT_INCLINE_PERCENT;
            return weighted.sum / weighted.distance;
        })();

        const payload = {
            weightKg: isProfileMissing ? DEFAULT_PROFILE.weightKg : userProfile.weightKg,
            speedKmh,
            inclinePercent: targetIncline,
            sampleSeconds,
        };

        if (usedDefaultProfile) {
            showUserNotification('프로필이 없어 체중 기본값을 사용합니다.');
        }

        return {
            calories: computeCalorieSample(payload),
            usedDefaultProfile,
            isProfileLoading,
        };
    }, [isProfileLoaded, isProfileLoading, recommendedCourseSegments, userProfile]);

    // Provider 언마운트 시 타이머가 남지 않도록 정리한다.
    useEffect(() => {
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, []);

    // 러닝 중 거리·시간 변화에 따라 실시간 누적 칼로리 계산
    useEffect(() => {
        const hasValidDistance = Number.isFinite(totalDistanceMeters) && totalDistanceMeters >= 0;
        const hasValidTime = Number.isFinite(currentTimeSeconds) && currentTimeSeconds > 0;

        if (!hasValidDistance || !hasValidTime) {
            setCaloriesBurned(0);
            return;
        }

        const safeWeight = Number.isFinite(userProfile?.weightKg) && userProfile.weightKg > 0
            ? userProfile.weightKg
            : DEFAULT_PROFILE.weightKg;

        const averageIncline = (() => {
            const weighted = userPath.slice(0, -1).reduce(
                (acc, point, index) => {
                    const next = userPath[index + 1];
                    const segmentDistance = geolib.getDistance(point, next);
                    if (!Number.isFinite(segmentDistance) || segmentDistance <= 0) return acc;

                    const currentAlt = Number.isFinite(point?.altitude) ? Number(point.altitude) : null;
                    const nextAlt = Number.isFinite(next?.altitude) ? Number(next.altitude) : null;
                    const inclinePercent = currentAlt != null && nextAlt != null
                        ? ((nextAlt - currentAlt) / segmentDistance) * 100
                        : DEFAULT_INCLINE_PERCENT;

                    return {
                        distance: acc.distance + segmentDistance,
                        sum: acc.sum + inclinePercent * segmentDistance,
                    };
                },
                { distance: 0, sum: 0 },
            );

            if (weighted.distance <= 0) return DEFAULT_INCLINE_PERCENT;
            return weighted.sum / weighted.distance;
        })();

        const speedKmh = (totalDistanceMeters / 1000) / (currentTimeSeconds / 3600);
        if (!Number.isFinite(speedKmh) || speedKmh <= 0) {
            setCaloriesBurned(0);
            return;
        }

        const estimatedCalories = computeCalorieSample({
            weightKg: safeWeight,
            speedKmh,
            inclinePercent: averageIncline,
            sampleSeconds: currentTimeSeconds,
        });

        setCaloriesBurned(estimatedCalories);
    }, [currentTimeSeconds, totalDistanceMeters, userPath, userProfile]);

    // ----------------------------------------------------
    // --- 노출할 값들 (Value) ---
    // ----------------------------------------------------
    const value = {
        isRunning, totalDistanceMeters, totalDistanceKm, formattedTime: formatTime(currentTimeSeconds),
        lastKnownPosition,
        recommendedCourse, recommendedCourseInfo, recommendedCourseSegments, recommendedCourseSummary, recommendedCourseVoiceGuides, recommendedCourses, isRecommendationLoading,
        historyRecords, userPath, isHistoryLoading, userProfile, caloriesBurned,isProfileLoading, isProfileLoaded,

        startRunning, stopRunning,
        fetchCourseRecommendation, selectRecommendedCourse, resetRunData, updateUserLocation,
        addRunRecord, updateRunRecord, deleteRunRecord,
        loadProfile, saveProfile, sampleCalories,
    };

    return (
        <RunningContext.Provider value={value}>
            {children}
        </RunningContext.Provider>
    );
};

export const useRunning = () => {
    const context = useContext(RunningContext);
    if (context === undefined) {
        throw new Error('useRunning must be used within a RunningProvider');
    }
    return context;
};