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
                const totalDistanceMeters = Number(feature?.properties?.total_distance ?? 0);
                const estimatedTimeMinutes = feature?.properties?.total_time_min;
                const averageSlope = Number(feature?.properties?.avg_slope);

                return {
                    id: feature?.properties?.label ?? index,
                    courseName: feature?.properties?.label || `추천 코스 ${index + 1}`,
                    coordinates,
                    slopeValues,
                    totalDistanceMeters,
                    estimatedTimeMinutes,
                    difficultyType: normalizeDifficultyType(feature?.properties?.type),
                    averageSlope,
                };
            });
        };

        // 유효성 에러 메시지 추출용 헬퍼 (새 API의 detail 배열 대응)
        const extractValidationMessage = (payload = {}) => {
            const details = payload?.detail;
            if (!Array.isArray(details) || details.length === 0) return null;

            const first = details[0];
            const locText = Array.isArray(first?.loc) ? first.loc.join(' > ') : '';
            const msgText = first?.msg || first?.message || '';

            return [locText, msgText].filter(Boolean).join(': ');
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
                const errorMessage = validationMessage || '추천 코스 API 호출에 실패했습니다.';
                throw new Error(errorMessage);
            }

            const normalizedCourses = normalizeCoursePayload(data);
            const normalized = normalizedCourses.map((item, index) => {
                const coursePath = coordinatesToGeoJson(item.coordinates);
                const latLngs = geoJsonToCoordinates(coursePath);

                // 1) 좌표-경사 배열 길이를 맞춰 잘라낸다.
                const trimmedSlopeValues = Array.isArray(item.slopeValues)
                    ? item.slopeValues.slice(0, Math.max(0, latLngs.length - 1))
                    : [];

                const rawSlopeSegments = buildSlopeSegments(latLngs, trimmedSlopeValues);
                const rawDistanceSum = rawSlopeSegments.reduce((sum, seg) => sum + seg.distanceMeters, 0);

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
                    difficultyType: item.difficultyType ?? normalizeDifficultyType(item?.type),
                    averageSlope,
                };
            });

            // 실제 백엔드에서 받은 데이터만 저장하고, 응답이 비었으면 빈 배열을 사용한다.
            setRecommendedCourses(normalized);
            return normalized;
        } catch (error) {
            console.log('추천 코스 호출 실패', error);
            showUserNotification(error.message || '코스 추천에 실패했습니다. 네트워크 상태를 확인해주세요.');
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
            averageSlope: target.averageSlope,
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