import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    useRef,
    useCallback,
} from 'react';
import { ToastAndroid } from 'react-native';
import * as geolib from 'geolib';
import axios from 'axios'; // 💡 Axios 활성화
import courseCandidatesMock from '../assets/mock/recommended_courses.json';
import initialHistory from '../assets/mock/history.json';

// ✅ [중요] 백엔드 주소 + 엔드포인트 분리
const API_BASE_URL = 'http://54.209.205.37:8000';
const API_URL = `${API_BASE_URL}/api/recommend`;

// 경사도 타입 상수 정의
export const SLOPE_TYPES = {
    FLAT: 'FLAT',
    MODERATE: 'MODERATE',
    STEEP: 'STEEP',
};

// Mock Data 및 상수
const METER_PER_SECOND = 3;

const RunningContext = createContext();
const HISTORY_STORAGE_KEY = 'running_history_records';
const USER_PROFILE_STORAGE_KEY = 'running_user_profile';
const DEFAULT_PROFILE = {
    weightKg: 65,
    inclinePercent: 0,
};
let inMemoryHistory = null;
let inMemoryProfile = null;

export const RunningProvider = ({ children }) => {
    // ----------------------------------------------------
    // --- 핵심 상태 (State) ---
    // ----------------------------------------------------
    const [isRunning, setIsRunning] = useState(false);
    const [totalDistanceMeters, setTotalDistanceMeters] = useState(0);
    const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
    const [lastKnownPosition, setLastKnownPosition] = useState(null);
    const [selectedSlope, setSelectedSlope] = useState(SLOPE_TYPES.FLAT);
    const [recommendedCourse, setRecommendedCourse] = useState(null);
    const [recommendedCourseInfo, setRecommendedCourseInfo] = useState(null);
    const [recommendedCourses, setRecommendedCourses] = useState([]);
    const [isRecommendationLoading, setIsRecommendationLoading] = useState(false);
    const [historyRecords, setHistoryRecords] = useState(initialHistory);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [isHistorySyncAttempted, setIsHistorySyncAttempted] = useState(false);
    const [userPath, setUserPath] = useState([]);
    const [userProfile, setUserProfile] = useState(DEFAULT_PROFILE);
    const [isProfileLoading, setIsProfileLoading] = useState(true);
    const [isProfileLoaded, setIsProfileLoaded] = useState(false);
    const [caloriesBurned, setCaloriesBurned] = useState(0);
    const [voiceTriggers, setVoiceTriggers] = useState([]);

    const intervalRef = useRef(null);
    const totalDistanceKm = totalDistanceMeters / 1000;

    const formatTime = (totalSeconds) => {
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(
            2,
            '0',
        );
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    };

    // ----------------------------------------------------
    // --- 핵심 함수 (Actions) ---
    // ----------------------------------------------------

    // 러닝 시작
    const startRunning = () => {
        if (isRunning) return;

        setIsRunning(true);
        console.log('러닝 시작: 타이머 가동');

        intervalRef.current = setInterval(() => {
            setCurrentTimeSeconds((prevTime) => prevTime + 1);
        }, 1000);
    };

    // 러닝 종료
    const stopRunning = () => {
        if (!isRunning) return;

        setIsRunning(false);

        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    };

    // 경사도 선택
    const selectSlope = (slopeType) => {
        setSelectedSlope(slopeType);
    };

    // GPS 위치 업데이트
    const updateUserLocation = (latitude, longitude) => {
        if (!isRunning) return;

        const newPosition = { latitude, longitude };

        if (lastKnownPosition) {
            const distanceInMeters = geolib.getDistance(
                lastKnownPosition,
                newPosition,
            );
            setTotalDistanceMeters((prevDistance) => prevDistance + distanceInMeters);
        }
        setLastKnownPosition(newPosition);
        setUserPath((prev) => [...prev, newPosition]);
    };

    // 💡 실제 백엔드 연동 함수
    // 💡 실제 백엔드 연동 함수 - fetch 버전
    const fetchCourseRecommendation = async (distance) => {
        setIsRecommendationLoading(true);
        setRecommendedCourse(null);
        setRecommendedCourseInfo(null);

        // 🔹 위치 없으면 서울시청 기본값 사용
        let currentLat, currentLon;

        if (
            lastKnownPosition &&
            typeof lastKnownPosition.latitude === 'number' &&
            typeof lastKnownPosition.longitude === 'number'
        ) {
            // 러닝 중 마지막으로 추적된 GPS 위치 사용
            currentLat = lastKnownPosition.latitude;
            currentLon = lastKnownPosition.longitude;
            console.log('[GPS] lastKnownPosition 사용:', currentLat, currentLon);
        } else {
            // 위치 정보가 없으면 기본값(서울시청) 사용
            console.log('[GPS] 위치 정보 없음 — 기본값(서울 시청)으로 요청 보냄');
            currentLat = 37.5665;
            currentLon = 126.9780;
        }

        try {
            // 🔥 새 스펙: current_lat, current_lon, target_km 만 보냄
            const requestData = {
                current_lat: currentLat,
                current_lon: currentLon,
                target_km: distance,
            };

            console.log('[fetchCourseRecommendation] 요청 URL:', API_URL);
            console.log('[fetchCourseRecommendation] POST body:', requestData);

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(requestData),
            });

            console.log('[fetch] status:', response.status);

            const rawText = await response.text();
            console.log('[fetch] raw response:', rawText);

            let rawData = {};
            try {
                rawData = JSON.parse(rawText);
            } catch (e) {
                console.log('[fetch] JSON 파싱 실패, 빈 객체로 처리:', e);
            }

            // [중요] 백엔드 응답 형식에 맞게 데이터 파싱
            let rawCourses = [];

            // 1) { courses: [...] } 형태인 경우
            if (Array.isArray(rawData?.courses)) {
                rawCourses = rawData.courses;
            // 2) 응답이 이미 배열인 경우: [ {...}, {...} ]
            } else if (Array.isArray(rawData)) {
                rawCourses = rawData;
            // 3) 응답이 객체 하나인 경우: { id: 1, ... }
            } else if (rawData && typeof rawData === 'object') {
                rawCourses = [rawData];
            }

            console.log('[fetch] parsed courses length:', rawCourses.length);

            // 🔥 모든 코스를 프론트가 쓰기 좋은 구조로 변환
            const normalizedCourses = rawCourses.map((course, index) => {
                const coursePath =
                    course.coordinates?.map((coord) => ({
                        latitude: coord.lat,
                        longitude: coord.lon,
                    })) || course.coursePath || [];

                const totalDistanceKm =
                    typeof course.totalDistanceKm === 'number'
                        ? course.totalDistanceKm
                        : (course.total_distance_m || 0) / 1000;

                const estimatedTimeMinutes =
                    typeof course.estimatedTimeMinutes === 'number'
                        ? course.estimatedTimeMinutes
                        : course.total_time_min || 0;

                const courseName =
                    course.courseName ||
                    course.message ||
                    `추천 코스 ${index + 1}`;

                return {
                    id: course.id ?? index,
                    coursePath,
                    totalDistanceKm,
                    estimatedTimeMinutes,
                    courseName,
                    voice_triggers: course.voice_triggers || [],
                };
            });

            console.log(
                '[fetch] normalized courses:',
                normalizedCourses.map((c) => ({
                    id: c.id,
                    totalDistanceKm: c.totalDistanceKm,
                    estimatedTimeMinutes: c.estimatedTimeMinutes,
                })),
            );

            // ✅ 변환된 코스를 상태에 저장
            setRecommendedCourses(normalizedCourses);

            // ✅ 첫 번째 코스를 기본 선택
            const initialCourse = normalizedCourses[0];
            if (initialCourse) {
                setRecommendedCourse(initialCourse.coursePath);
                setRecommendedCourseInfo({
                    totalDistanceKm: initialCourse.totalDistanceKm,
                    estimatedTimeMinutes: initialCourse.estimatedTimeMinutes,
                    courseName: initialCourse.courseName,
                });
                setVoiceTriggers(initialCourse.voice_triggers || []);
            }

            console.log('코스 추천 API(fetch) 호출 성공, 상태에 데이터 저장 완료');

            // ✅ 성공 여부는 normalizedCourses 기준으로 판단
            return normalizedCourses.length > 0;
        } catch (error) {
            console.error('코스 추천 API(fetch) 호출 실패:', error);
            // 실패 시 상태 초기화
            setRecommendedCourses([]);
            setRecommendedCourse(null);
            setRecommendedCourseInfo(null);
            setVoiceTriggers([]);
            return false;
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
        });
        return target;
    };

    // 모든 러닝 상태 초기화
    const resetRunData = () => {
        setTotalDistanceMeters(0);
        setCurrentTimeSeconds(0);
        setRecommendedCourse(null);
        setRecommendedCourseInfo(null);
        setRecommendedCourses([]);
        setLastKnownPosition(null);
        setUserPath([]);
        setCaloriesBurned(0);
        setVoiceTriggers([]);
    };

    // ----------------------------------------------------
    // --- 히스토리/프로필 관리 로직 (유지) ---
    // ----------------------------------------------------
    const showUserNotification = (message) => {
        ToastAndroid?.show?.(message, ToastAndroid.SHORT);
    };

    const resolveAsyncStorage = useCallback(async () => {
        try {
            const asyncStorageModule = require('@react-native-async-storage/async-storage');
            return asyncStorageModule?.default || asyncStorageModule;
        } catch (error) {
            console.log(
                'AsyncStorage 모듈 조회 실패: 로컬/백엔드 폴백으로 대체',
            );
            return null;
        }
    }, []);

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
                        inclinePercent:
                            parsed?.inclinePercent ?? DEFAULT_PROFILE.inclinePercent,
                    };
                    inMemoryProfile = JSON.stringify(resolvedProfile);
                    shouldNotifyDefault = false;
                }
            }
        } catch (error) {
            console.log('사용자 프로필 로드 실패, 기본값으로 대체');
        }

        if (shouldNotifyDefault) {
            try {
                if (inMemoryProfile) {
                    const parsed = JSON.parse(inMemoryProfile);
                    resolvedProfile = {
                        weightKg: parsed?.weightKg ?? DEFAULT_PROFILE.weightKg,
                        inclinePercent:
                            parsed?.inclinePercent ?? DEFAULT_PROFILE.inclinePercent,
                    };
                    shouldNotifyDefault = false;
                }
            } catch (error) {
                console.log('메모리 프로필 로드 실패, 기본값 사용');
            }
        }

        setUserProfile(resolvedProfile);
        if (shouldNotifyDefault) {
            showUserNotification('체중/경사 기본값을 사용합니다.');
        }

        setIsProfileLoaded(true);
        setIsProfileLoading(false);
    }, [resolveAsyncStorage]);

    const saveProfile = useCallback(
        async ({ weightKg, inclinePercent }) => {
            const safeProfile = {
                weightKg:
                    Number.isFinite(Number(weightKg)) && Number(weightKg) > 0
                        ? Number(weightKg)
                        : DEFAULT_PROFILE.weightKg,
                inclinePercent: Number.isFinite(Number(inclinePercent))
                    ? Number(inclinePercent)
                    : DEFAULT_PROFILE.inclinePercent,
            };

            setUserProfile(safeProfile);
            setIsProfileLoaded(true);
            setIsProfileLoading(false);

            try {
                const AsyncStorage = await resolveAsyncStorage();
                if (AsyncStorage?.setItem) {
                    await AsyncStorage.setItem(
                        USER_PROFILE_STORAGE_KEY,
                        JSON.stringify(safeProfile),
                    );
                    inMemoryProfile = JSON.stringify(safeProfile);
                    showUserNotification('프로필이 저장되었습니다.');
                    return true;
                }
            } catch (error) {
                console.log('AsyncStorage 프로필 저장 실패, 메모리 캐시로 대체');
            }

            try {
                inMemoryProfile = JSON.stringify(safeProfile);
                showUserNotification('프로필이 저장되었습니다. (임시 캐시)');
                return true;
            } catch (error) {
                console.log('메모리 프로필 저장 실패');
            }

            showUserNotification(
                '프로필 저장에 실패했습니다. 네트워크 상태를 확인해주세요.',
            );
            return false;
        },
        [resolveAsyncStorage],
    );

    const readHistoryFromStorage = useCallback(async () => {
        try {
            const AsyncStorage = await resolveAsyncStorage();
            if (AsyncStorage?.getItem) {
                const stored = await AsyncStorage.getItem(HISTORY_STORAGE_KEY);
                if (stored) {
                    return JSON.parse(stored);
                }
            }
        } catch (error) {
            console.log('AsyncStorage 로드 실패, 메모리 캐시 시도');
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

            setHistoryRecords(initialHistory);
            showUserNotification(
                '기존 러닝 기록을 불러오지 못해 기본 값을 사용합니다.',
            );
        } catch (error) {
            console.log('러닝 기록 초기화 실패');
            setHistoryRecords(initialHistory);
            showUserNotification(
                '러닝 기록을 불러오지 못해 기본 값을 사용합니다.',
            );
        } finally {
            setIsHistorySyncAttempted(true);
            setIsHistoryLoading(false);
        }
    }, [fetchHistoryFromBackend, isHistorySyncAttempted, readHistoryFromStorage]);

    useEffect(() => {
        loadHistoryRecords();
        loadProfile();
    }, [loadHistoryRecords, loadProfile]);

    const persistHistoryRecords = useCallback(
        async (records) => {
            try {
                const AsyncStorage = await resolveAsyncStorage();
                if (AsyncStorage?.setItem) {
                    await AsyncStorage.setItem(
                        HISTORY_STORAGE_KEY,
                        JSON.stringify(records),
                    );
                    return true;
                }
            } catch (error) {
                console.log('AsyncStorage 저장 실패, 메모리 캐시 시도');
            }

            try {
                inMemoryHistory = JSON.stringify(records);
                return true;
            } catch (error) {
                console.log('메모리 캐시 저장 실패');
            }

            return false;
        },
        [resolveAsyncStorage],
    );

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

        showUserNotification(
            '러닝 기록 저장에 실패했습니다. 네트워크 상태를 확인해주세요.',
        );
        return false;
    };

    // ----------------------------------------------------
    // --- 칼로리 샘플 계산 (팀원 로직 유지) ---
    // ----------------------------------------------------

    const computeCalorieSample = ({
        weightKg,
        speedKmh,
        inclinePercent,
        sampleSeconds,
    }) => {
        const met = 1 + speedKmh * 0.7 + inclinePercent * 0.1;
        const caloriesPerMinute = (met * 3.5 * weightKg) / 200;
        return Math.round(caloriesPerMinute * (sampleSeconds / 60));
    };

    const sampleCalories = useCallback(
        ({ speedKmh, sampleSeconds }) => {
            const hasWeight =
                Number.isFinite(userProfile?.weightKg) && userProfile.weightKg > 0;
            const hasIncline = Number.isFinite(userProfile?.inclinePercent);
            const isProfileMissing = !(hasWeight && hasIncline);
            const usedDefaultProfile = isProfileLoaded && isProfileMissing;

            const payload = {
                weightKg: isProfileMissing
                    ? DEFAULT_PROFILE.weightKg
                    : userProfile.weightKg,
                speedKmh,
                inclinePercent: isProfileMissing
                    ? DEFAULT_PROFILE.inclinePercent
                    : userProfile.inclinePercent,
                sampleSeconds,
            };

            if (usedDefaultProfile) {
                showUserNotification(
                    '프로필이 없어 체중/경사 기본값을 사용합니다.',
                );
            }

            return {
                calories: computeCalorieSample(payload),
                usedDefaultProfile,
                isProfileLoading,
            };
        },
        [isProfileLoaded, isProfileLoading, userProfile],
    );

    useEffect(() => {
        const hasValidDistance =
            Number.isFinite(totalDistanceMeters) && totalDistanceMeters >= 0;
        const hasValidTime =
            Number.isFinite(currentTimeSeconds) && currentTimeSeconds > 0;

        if (!hasValidDistance || !hasValidTime) {
            setCaloriesBurned(0);
            return;
        }

        const safeWeight =
            Number.isFinite(userProfile?.weightKg) && userProfile.weightKg > 0
                ? userProfile.weightKg
                : DEFAULT_PROFILE.weightKg;
        const safeIncline = Number.isFinite(userProfile?.inclinePercent)
            ? userProfile.inclinePercent
            : DEFAULT_PROFILE.inclinePercent;

        const speedKmh =
            (totalDistanceMeters / 1000) / (currentTimeSeconds / 3600);

        if (!Number.isFinite(speedKmh) || speedKmh <= 0) {
            setCaloriesBurned(0);
            return;
        }

        const estimatedCalories = computeCalorieSample({
            weightKg: safeWeight,
            speedKmh,
            inclinePercent: safeIncline,
            sampleSeconds: currentTimeSeconds,
        });

        setCaloriesBurned(estimatedCalories);
    }, [currentTimeSeconds, totalDistanceMeters, userProfile]);

    const value = {
        isRunning,
        totalDistanceMeters,
        totalDistanceKm,
        formattedTime: formatTime(currentTimeSeconds),
        lastKnownPosition,
        selectedSlope,
        recommendedCourse,
        recommendedCourseInfo,
        recommendedCourses,
        isRecommendationLoading,
        historyRecords,
        userPath,
        isHistoryLoading,
        userProfile,
        caloriesBurned,
        isProfileLoading,
        isProfileLoaded,
        voiceTriggers,

        startRunning,
        stopRunning,
        selectSlope,
        fetchCourseRecommendation,
        selectRecommendedCourse,
        resetRunData,
        updateUserLocation,
        addRunRecord,
        loadProfile,
        saveProfile,
        sampleCalories,
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