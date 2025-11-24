// src/providers/running_provider.js

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { ToastAndroid } from 'react-native';
import * as geolib from 'geolib'; // 거리 계산 라이브러리
import courseCandidatesMock from '../assets/mock/recommended_courses.json';
import initialHistory from '../assets/mock/history.json';

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
    const [selectedSlope, setSelectedSlope] = useState(SLOPE_TYPES.FLAT);
    const [recommendedCourse, setRecommendedCourse] = useState(null);
    const [recommendedCourseInfo, setRecommendedCourseInfo] = useState(null);
    const [recommendedCourses, setRecommendedCourses] = useState([]);
    const [isRecommendationLoading, setIsRecommendationLoading] = useState(false);
    const [historyRecords, setHistoryRecords] = useState(initialHistory);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [isHistorySyncAttempted, setIsHistorySyncAttempted] = useState(false);
    const [userPath, setUserPath] = useState([]);
    const [userProfile, setUserProfile] = useState(DEFAULT_PROFILE); // 체중·경사만 관리하는 간단한 프로필 상태
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

        setIsRunning(true);
        console.log("러닝 시작: 타이머 가동");

        intervalRef.current = setInterval(() => {
            // 시간 업데이트 (기존 로직 유지)
            setCurrentTimeSeconds(prevTime => prevTime + 1);
            
            // --- [임시 추가] 자체 테스트를 위한 Mock 거리 로직 재도입 ---
            setTotalDistanceMeters(prevDistance => prevDistance + METER_PER_SECOND);
            
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
    
    // 경사도 선택 함수
    const selectSlope = (slopeType) => {
        setSelectedSlope(slopeType); 
    };

    // GPS 위치 수신 및 거리 계산 (FE 1 호출용)
    const updateUserLocation = (latitude, longitude) => {
        if (!isRunning) return;

        const newPosition = { latitude, longitude };

        if (lastKnownPosition) {
            const distanceInMeters = geolib.getDistance(
                lastKnownPosition,
                newPosition
            );
            setTotalDistanceMeters(prevDistance => prevDistance + distanceInMeters);
        }
        setLastKnownPosition(newPosition);
        setUserPath((prev) => [...prev, newPosition]);
    };

    // Mock API 연동 함수
    const fetchCourseRecommendation = async (distance, slope) => {
        setIsRecommendationLoading(true);
        setRecommendedCourse(null);
        setRecommendedCourseInfo(null);
        await new Promise(resolve => setTimeout(resolve, 800));
        const mockData = courseCandidatesMock.courses || [];
        setRecommendedCourses(mockData);
        setIsRecommendationLoading(false);
        return mockData;
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
        // [선택] 경사도도 초기화하려면: setSelectedSlope(SLOPE_TYPES.FLAT);
    };

    /**
     * 러닝 기록을 저장하는 간단한 헬퍼 (FE 내 임시 저장용)
     */
    const showUserNotification = (message) => {
        // 사용자에게 동기화/저장 실패를 알리는 토스트 (안드로이드 기준)
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
     * 사용자 프로필(체중/경사) 정보를 단순 로드.
     * - 성별/나이 등은 더 이상 관리하지 않는다.
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
                        inclinePercent: parsed?.inclinePercent ?? DEFAULT_PROFILE.inclinePercent,
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
                        inclinePercent: parsed?.inclinePercent ?? DEFAULT_PROFILE.inclinePercent,
                    };
                    shouldNotifyDefault = false;
                }
            } catch (error) {
                console.log('메모리 프로필 로드 실패, 기본값 사용', error);
            }
        }

        setUserProfile(resolvedProfile);
        if (shouldNotifyDefault) {
            showUserNotification('체중/경사 기본값을 사용합니다.');
        }

        setIsProfileLoaded(true);
        setIsProfileLoading(false);
    }, [resolveAsyncStorage]);

    /**
     * 체중/경사 프로필을 저장하고 상태와 캐시에 반영한다.
     * - AsyncStorage 저장 → 실패 시 메모리 캐시 폴백.
     */
    const saveProfile = useCallback(async ({ weightKg, inclinePercent }) => {
        const safeProfile = {
            weightKg: Number.isFinite(Number(weightKg)) && Number(weightKg) > 0
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

            setHistoryRecords(initialHistory);
            showUserNotification('기존 러닝 기록을 불러오지 못해 기본 값을 사용합니다.');
        } catch (error) {
            console.log('러닝 기록 초기화 실패', error);
            setHistoryRecords(initialHistory);
            showUserNotification('러닝 기록을 불러오지 못해 기본 값을 사용합니다.');
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

    // ----------------------------------------------------
    // --- 칼로리 샘플 계산 (새 API 필드) ---
    // ----------------------------------------------------

    /**
     * 샘플 칼로리 계산을 위한 간단한 헬퍼.
     * 새 API 요구사항에 맞춰 weightKg, speedKmh, inclinePercent, sampleSeconds만 사용한다.
     */
    const computeCalorieSample = ({ weightKg, speedKmh, inclinePercent, sampleSeconds }) => {
        const met = 1 + speedKmh * 0.7 + inclinePercent * 0.1; // 임시 MET 추정치
        const caloriesPerMinute = (met * 3.5 * weightKg) / 200;
        return Math.round(caloriesPerMinute * (sampleSeconds / 60));
    };

    /**
     * 프로필이 없을 때 체중/경사 기본값을 사용하여 샘플 칼로리를 계산한다.
     */
    const sampleCalories = useCallback(({ speedKmh, sampleSeconds }) => {
        const hasWeight = Number.isFinite(userProfile?.weightKg) && userProfile.weightKg > 0;
        const hasIncline = Number.isFinite(userProfile?.inclinePercent);
        const isProfileMissing = !(hasWeight && hasIncline);
        const usedDefaultProfile = isProfileLoaded && isProfileMissing;

        const payload = {
            weightKg: isProfileMissing ? DEFAULT_PROFILE.weightKg : userProfile.weightKg,
            speedKmh,
            inclinePercent: isProfileMissing ? DEFAULT_PROFILE.inclinePercent : userProfile.inclinePercent,
            sampleSeconds,
        };

        if (usedDefaultProfile) {
            showUserNotification('프로필이 없어 체중/경사 기본값을 사용합니다.');
        }

        return {
            calories: computeCalorieSample(payload),
            usedDefaultProfile,
            isProfileLoading,
        };
    }, [isProfileLoaded, isProfileLoading, userProfile]);

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
        const safeIncline = Number.isFinite(userProfile?.inclinePercent)
            ? userProfile.inclinePercent
            : DEFAULT_PROFILE.inclinePercent;

        const speedKmh = (totalDistanceMeters / 1000) / (currentTimeSeconds / 3600);

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

    // ----------------------------------------------------
    // --- 노출할 값들 (Value) ---
    // ----------------------------------------------------
    const value = {
        isRunning, totalDistanceMeters, totalDistanceKm, formattedTime: formatTime(currentTimeSeconds),
        lastKnownPosition,
        selectedSlope, recommendedCourse, recommendedCourseInfo, recommendedCourses, isRecommendationLoading,
        historyRecords, userPath, isHistoryLoading, userProfile, caloriesBurned,isProfileLoading, isProfileLoaded,

        startRunning, stopRunning, selectSlope,
        fetchCourseRecommendation, selectRecommendedCourse, resetRunData, updateUserLocation, addRunRecord,
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