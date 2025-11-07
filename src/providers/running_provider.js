// src/providers/running_provider.js

import React, { createContext, useContext, useState, useRef } from 'react';
import * as geolib from 'geolib'; // 거리 계산 라이브러리
import recommendedCourseMock from '../assets/mock/recommended_course.json'; 

// 경사도 타입 상수 정의
export const SLOPE_TYPES = {
    FLAT: 'FLAT',
    MODERATE: 'MODERATE',
    STEEP: 'STEEP',
};

// Mock Data 및 상수
const METER_PER_SECOND = 3; 

const RunningContext = createContext();

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
    const [isRecommendationLoading, setIsRecommendationLoading] = useState(false);
    
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
    };

    // Mock API 연동 함수
    const fetchCourseRecommendation = async (distance, slope) => {
        setIsRecommendationLoading(true);
        await new Promise(resolve => setTimeout(resolve, 1000)); 
        const mockData = recommendedCourseMock.data;
        setRecommendedCourse(mockData.coursePath); 
        setIsRecommendationLoading(false);
        return mockData;
    };

    // 모든 러닝 상태 초기화
    const resetRunData = () => {
        setTotalDistanceMeters(0);
        setCurrentTimeSeconds(0);
        setRecommendedCourse(null);
        setLastKnownPosition(null);
        // [선택] 경사도도 초기화하려면: setSelectedSlope(SLOPE_TYPES.FLAT);
    };
    
    // ----------------------------------------------------
    // --- 노출할 값들 (Value) ---
    // ----------------------------------------------------
    const value = {
        isRunning, totalDistanceMeters, totalDistanceKm, formattedTime: formatTime(currentTimeSeconds),
        lastKnownPosition, 
        selectedSlope, recommendedCourse, isRecommendationLoading,
        
        startRunning, stopRunning, selectSlope, 
        fetchCourseRecommendation, resetRunData, updateUserLocation, 
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