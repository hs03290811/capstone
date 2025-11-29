// src/providers/running_provider.js

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { ToastAndroid } from 'react-native';
import Config from 'react-native-config';
import * as geolib from 'geolib'; // 거리 계산 라이브러리
import { computeCalorieSample as computeCalorieSampleFromUtil } from '../utils/calorieCalculator';
import {
    buildSlopeSegments,
    coordinatesToGeoJson,
    geoJsonToCoordinates,
    normalizeDifficultyType,
    summarizeSegments,
} from '../utils/courseHelpers';

// 러닝 컨텍스트에서 사용하는 기본 상수 (목업 미사용)

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
    const [recommendedCourse, setRecommendedCourse] = useState(null);
    const [recommendedCourseInfo, setRecommendedCourseInfo] = useState(null);
    const [recommendedCourseSegments, setRecommendedCourseSegments] = useState([]); // 지도/목록에서 재사용할 경사 세그먼트
    const [recommendedCourseSummary, setRecommendedCourseSummary] = useState(null); // 경사 합계를 빠르게 불러오기 위한 요약값
    const [recommendedCourses, setRecommendedCourses] = useState([]);
    const [isRecommendationLoading, setIsRecommendationLoading] = useState(false);
    const [historyRecords, setHistoryRecords] = useState([]); // 백엔드/스토리지 데이터만 사용
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

    /**
     * 추천 코스를 백엔드에서 받아오는 함수.
     * - 현재 위치/희망 거리 정보를 바탕으로 실제 API 호출.
     */
    const fetchCourseRecommendation = async (distanceKm, _slope, currentLocation) => {
        setIsRecommendationLoading(true);
        setRecommendedCourse(null);
        setRecommendedCourseInfo(null);
        setRecommendedCourseSegments([]);
        setRecommendedCourseSummary(null);

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

            if (!response.ok) {
                throw new Error('추천 코스 API 호출에 실패했습니다.');
            }

            const data = await response.json();
            const normalizedRoutes = Array.isArray(data?.routes) ? data.routes : [];
            const normalized = normalizedRoutes.map((item, index) => {
                const coordinates = Array.isArray(item?.path) ? item.path : [];
                const coursePath = coordinatesToGeoJson(coordinates);
                const latLngs = geoJsonToCoordinates(coursePath);
                const slopeValues = Array.isArray(item?.slopes) ? item.slopes : [];
                const slopeSegments = buildSlopeSegments(latLngs, slopeValues);
                const slopeSummary = summarizeSegments(slopeSegments);

                return {
                    id: String(item.id ?? index),
                    courseName: item.course_name || `추천 코스 ${index + 1}`,
                    totalDistanceKm: Number(item.total_distance || item.total_distance_m || 0) / 1000,
                    estimatedTimeMinutes: item.total_time_min ?? Math.round((Number(item.total_distance || 0) / 1000) / 8 * 60),
                    coursePath,
                    slopeSegments,
                    slopeSummary,
                    // 백엔드가 주는 난이도 문자열을 표준 형태로 맞춰 화면 전역에서 동일하게 표시
                    difficultyType: normalizeDifficultyType(item.type),
                };
            });

            // 실제 백엔드에서 받은 데이터만 저장하고, 응답이 비었으면 빈 배열을 사용한다.
            setRecommendedCourses(normalized);
            return normalized;
        } catch (error) {
            console.log('추천 코스 호출 실패', error);
            showUserNotification('코스 추천에 실패했습니다. 네트워크 상태를 확인해주세요.');
            // 목업 폴백 없이 빈 배열로 유지해 실제 데이터만 사용
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
        });
        setRecommendedCourseSegments(target.slopeSegments || []);
        setRecommendedCourseSummary(target.slopeSummary || null);
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
        setRecommendedCourses([]);
        setLastKnownPosition(null);
        setUserPath([]);
        setCaloriesBurned(0);
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

    // ----------------------------------------------------
    // --- 칼로리 샘플 계산 (새 API 필드) ---
    // ----------------------------------------------------

    /**
     * 샘플 칼로리 계산을 위한 간단한 헬퍼.
     * 새 API 요구사항에 맞춰 weightKg, speedKmh, inclinePercent, sampleSeconds만 사용한다.
     */
    const computeCalorieSample = ({ weightKg, speedKmh, inclinePercent, sampleSeconds }) => {
        // MET 테이블 기반으로 샘플 칼로리를 계산하는 공용 유틸을 사용해 중복 로직을 줄인다.
        return computeCalorieSampleFromUtil({ weightKg, speedKmh, inclinePercent, sampleSeconds });
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
        recommendedCourse, recommendedCourseInfo, recommendedCourseSegments, recommendedCourseSummary, recommendedCourses, isRecommendationLoading,
        historyRecords, userPath, isHistoryLoading, userProfile, caloriesBurned,isProfileLoading, isProfileLoaded,

        startRunning, stopRunning,
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