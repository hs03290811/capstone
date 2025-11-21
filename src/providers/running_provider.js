// src/providers/running_provider.js

import React, { createContext, useContext, useState, useRef } from 'react';
import * as geolib from 'geolib';
import axios from 'axios'; // Axios import 확인

// [중요] 실제 백엔드 API 주소 (팀원과 상의한 최종 주소)
const API_URL = 'http://54.209.205.37:8000/api/recommend';
// [주의] 이 엔드포인트는 POST + JSON Body 방식으로 호출합니다.

// 경사도 타입 상수 정의
export const SLOPE_TYPES = {
  FLAT: 'FLAT',
  MODERATE: 'MODERATE',
  STEEP: 'STEEP',
};

// Mock Data 및 상수 (이 값은 현재 사용되지 않습니다.)
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

  // UI에서 선택한 경사도
  const [selectedSlope, setSelectedSlope] = useState(SLOPE_TYPES.FLAT);

  // 추천받은 코스 좌표 (백엔드의 coordinates)
  const [recommendedCourse, setRecommendedCourse] = useState(null);

  // 추천 API 로딩 상태
  const [isRecommendationLoading, setIsRecommendationLoading] = useState(false);

  // [파스 2] 백엔드에서 내려주는 음성 안내 트리거 (voice_triggers)
  const [voiceTriggers, setVoiceTriggers] = useState([]);

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

  // 러닝 시작
  const startRunning = () => {
    if (isRunning) return;

    setIsRunning(true);
    console.log('러닝 시작: 타이머 가동');

    intervalRef.current = setInterval(() => {
      // 시간 업데이트
      setCurrentTimeSeconds((prevTime) => prevTime + 1);

      // [참고] Mock 거리 로직 제거됨:
      // setTotalDistanceMeters(prevDistance => prevDistance + METER_PER_SECOND);
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
      const distanceInMeters = geolib.getDistance(lastKnownPosition, newPosition);
      setTotalDistanceMeters((prevDistance) => prevDistance + distanceInMeters);
    }

    setLastKnownPosition(newPosition);
  };

  // ----------------------------------------------------
  // --- [파스 2] 실제 코스 추천 API 연동 로직 ---
  // ----------------------------------------------------
  /**
   * 추천받기 버튼에서 호출할 함수
   * @param {number} distance       - 목표 거리 (km 단위 등, 백엔드 스펙에 맞게)
   * @param {string} inclineLevel   - 'FLAT' / 'MODERATE' / 'STEEP'
   */
  const fetchCourseRecommendation = async (distance, inclineLevel) => {
    setIsRecommendationLoading(true);

    // [TODO] 실제 구현 시 현재 GPS 위치로 대체
    const currentLat = 37.5665;  // 임시: 서울 시청 위도
    const currentLon = 126.9780; // 임시: 서울 시청 경도

    try {
      // FLAT / MODERATE / STEEP → max_slope 숫자로 매핑
      const SLOPE_TO_MAX = {
        FLAT: 3,      // 평지 위주
        MODERATE: 7,  // 보통
        STEEP: 12,    // 가파른 편
      };
      const maxSlope = SLOPE_TO_MAX[inclineLevel] ?? 7;

      // 🔹 서버에 보낼 Body(JSON)
      const requestData = {
        current_lat: currentLat,
        current_lon: currentLon,
        target_km: distance,
        max_slope: maxSlope,
      };

      console.log('[fetchCourseRecommendation] POST body:', requestData);

      // 🔹 POST + JSON Body로 호출
      const response = await axios.post(API_URL, requestData, {
        timeout: 10000, // 10초 동안 응답 없으면 에러로 간주
      });

      const data = response.data;
      console.log('[fetchCourseRecommendation] response data:', data);

      const {
        coordinates = null,
        voice_triggers = [],
      } = data || {};

      setRecommendedCourse(coordinates);
      setVoiceTriggers(voice_triggers);

      console.log('코스 추천 API 호출 성공, 상태에 데이터 저장 완료');
      return true;
    } catch (error) {
      console.error('코스 추천 API 호출 실패:', error);

      if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Data:', error.response.data);
      } else if (error.request) {
        console.error('요청 전송은 되었으나 응답 없음 (Network Timeout/Server Blocked)');
        console.error('Error Message:', error.message);
      } else {
        console.error('Config Error:', error.message);
      }

      setRecommendedCourse(null);
      setVoiceTriggers([]);
      return false;
    } finally {
      setIsRecommendationLoading(false);
    }
  };

  // 러닝/추천 데이터 초기화
  const resetRunData = () => {
    setTotalDistanceMeters(0);
    setCurrentTimeSeconds(0);
    setRecommendedCourse(null);
    setLastKnownPosition(null);
    setVoiceTriggers([]);
  };

  // ----------------------------------------------------
  // --- 노출할 값들 (Context Value) ---
  // ----------------------------------------------------
  const value = {
    // 상태
    isRunning,
    totalDistanceMeters,
    totalDistanceKm,
    formattedTime: formatTime(currentTimeSeconds),
    lastKnownPosition,
    selectedSlope,
    recommendedCourse,
    isRecommendationLoading,
    voiceTriggers,

    // 액션 함수
    startRunning,
    stopRunning,
    selectSlope,
    fetchCourseRecommendation,
    resetRunData,
    updateUserLocation,
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










