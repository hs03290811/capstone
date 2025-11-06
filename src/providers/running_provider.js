// src/providers/running_provider.js

import React, { createContext, useContext, useState, useRef } from 'react';
// Mock 데이터 import (경로 확인 필수)
import recommendedCourseMock from '../assets/mock/recommended_course.json'; 

// 경사도 타입 상수 정의
export const SLOPE_TYPES = {
    FLAT: 'FLAT',
    MODERATE: 'MODERATE',
    STEEP: 'STEEP',
};

// Mock Data 및 상수
const METER_PER_SECOND = 3; 

// 1. Context 생성
const RunningContext = createContext();

// 2. Provider 컴포넌트
export const RunningProvider = ({ children }) => {
    // ----------------------------------------------------
    // --- 핵심 상태 (State) ---
    // ----------------------------------------------------
    const [isRunning, setIsRunning] = useState(false);
    const [totalDistanceMeters, setTotalDistanceMeters] = useState(0);
    const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
    
    // [추가] 경사도 및 Mock API 관련 상태
    const [selectedSlope, setSelectedSlope] = useState(SLOPE_TYPES.FLAT); // 기본값 설정
    const [recommendedCourse, setRecommendedCourse] = useState(null);
    const [isRecommendationLoading, setIsRecommendationLoading] = useState(false);
    
    // 타이머 관리를 위한 Ref
    const intervalRef = useRef(null);

    // 유틸리티 상태 (화면에 표시하기 위해 미터 -> 킬로미터 변환)
    const totalDistanceKm = totalDistanceMeters / 1000;

    // 경과 시간을 HH:MM:SS 형태로 변환하는 함수
    const formatTime = (totalSeconds) => {
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    };

    // ----------------------------------------------------
    // --- 핵심 함수 (Actions) ---
    // ----------------------------------------------------
    
    // 3. 핵심 함수: 타이머 시작
    const startRunning = () => {
        if (isRunning) return;

        setIsRunning(true);
        // console.log("러닝 시작: 타이머 가동");

        intervalRef.current = setInterval(() => {
            // 시간 업데이트
            setCurrentTimeSeconds(prevTime => prevTime + 1);
            
            // 거리 업데이트 (Mock Data)
            setTotalDistanceMeters(prevDistance => prevDistance + METER_PER_SECOND);
            
        }, 1000); 
    };

    // 4. 핵심 함수: 타이머 정지
    const stopRunning = () => {
        if (!isRunning) return;

        setIsRunning(false);
        // console.log("러닝 정지: 타이머 중지");
        
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    };
    
    // 5. [추가] 핵심 함수: 경사도 선택 함수
    const selectSlope = (slopeType) => {
        setSelectedSlope(slopeType);
    };
    
    // 6. [추가] Mock API 연동 함수
    const fetchCourseRecommendation = async (distance, slope) => {
        
        setIsRecommendationLoading(true);

        // 1초 대기 (API 호출 시간 흉내)
        await new Promise(resolve => setTimeout(resolve, 1000)); 
        
        const mockData = recommendedCourseMock.data;
        
        setRecommendedCourse(mockData.coursePath); 
        
        setIsRecommendationLoading(false);
        
        return mockData;
    };

    // 7. 핵심 함수: 모든 러닝 상태 초기화
    const resetRunData = () => {
        setTotalDistanceMeters(0);
        setCurrentTimeSeconds(0);
        setRecommendedCourse(null); // 추천 경로도 초기화
        // isRunning은 stopRunning에서 이미 false로 설정됨
        // isRecommendationLoading은 Mock API 호출 시 false로 설정됨
    };
    
    // ----------------------------------------------------
    // --- 노출할 값들 (Value) ---
    // ----------------------------------------------------
    const value = {
        // 실시간 러닝 상태
        isRunning,
        totalDistanceMeters,
        totalDistanceKm,
        formattedTime: formatTime(currentTimeSeconds),
        
        // 코스 추천 설정 상태
        selectedSlope,            // 경사도 상태
        recommendedCourse,        // 추천 경로 결과
        isRecommendationLoading,  // 로딩 상태

        // 액션 함수
        startRunning,
        stopRunning,
        selectSlope,              // 경사도 선택 함수
        fetchCourseRecommendation, // Mock API 함수
        resetRunData,
    };

    return (
        <RunningContext.Provider value={value}>
            {children}
        </RunningContext.Provider>
    );
};

// 5. Custom Hook
export const useRunning = () => {
    const context = useContext(RunningContext);
    if (context === undefined) {
        throw new Error('useRunning must be used within a RunningProvider');
    }
    return context;
};