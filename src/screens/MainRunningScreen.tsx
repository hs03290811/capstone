import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Polyline, type Region } from 'react-native-maps';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Geolocation from 'react-native-geolocation-service';
import type { GeoPosition } from 'react-native-geolocation-service';
import Tts from 'react-native-tts';
import Config from 'react-native-config';

import { useRunning } from '../providers/running_provider';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { buildSlopeSegments, geoJsonToCoordinates, type ColoredSegment } from '../utils/courseHelpers';
import { formatRelativeAltitude, summarizeAltitude } from '../utils/altitudeHelpers';

type Props = NativeStackScreenProps<RootStackParamList, 'MainRunning'>;

type LatLng = { latitude: number; longitude: number };

// ▼ 서버에서 받은 GeoJSON(LineString) 일부만 쓰기 위한 간단 타입
type LineStringFeature = {
  geometry?: { type?: string; coordinates?: [number, number][] };
};
type Course = { features?: LineStringFeature[] };

const VOICE_LANG = Config.TTS_VOICE || 'ko-KR';

/** 위치 권한 요청 (iOS/Android 분기) */
async function ensureFineLocation(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    const auth = await Geolocation.requestAuthorization('always');
    return auth === 'granted' || auth === 'restricted';
  }

  const res = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: '위치 권한 요청',
      message: '현재 위치를 지도의 중심으로 표시하려면 위치 권한이 필요합니다.',
      buttonPositive: '확인',
    }
  );
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

/** Android 10+ 백그라운드 위치 권한 */
async function ensureBackgroundLocation(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const androidVersion = Number(Platform.Version) || 0;
  if (androidVersion < 29) return true;

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
    {
      title: '백그라운드 위치 권한 요청',
      message: '화면이 꺼져도 이동 경로를 기록하기 위해 위치 권한이 필요합니다.',
      buttonPositive: '허용',
    }
  );

  return result === PermissionsAndroid.RESULTS.GRANTED;
}

const MainRunningScreen: React.FC<Props> = ({ navigation }) => {
  // ▼ 러닝 상태와 데이터, 액션은 Provider에서 가져옴
  const {
    isRunning,
    totalDistanceKm,
    formattedTime,
    startRunning,
    stopRunning,
    recommendedCourse,
    recommendedCourseSegments,
    userPath,
    updateUserLocation, // ← FE1에서 합의한 인터페이스: 위치 업데이트 전달
  } = useRunning();

  const [relativeAltitude, setRelativeAltitude] = useState<number | null>(null);

  const baselineAltitudeRef = useRef<number | null>(null);

  // ▼ MapView/Geo watch 핸들 보관
  const mapRef = useRef<MapView | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const hasAnnouncedRef = useRef<boolean>(false); // 첫 렌더/마운트시 TTS 중복 방지용

  /** GeoJSON(LineString) → RN Maps 좌표 배열로 변환 (메모이즈) */
  const courseCoordinates = useMemo<LatLng[]>(() => geoJsonToCoordinates(recommendedCourse as Course | null), [recommendedCourse]);
  const slopeSegments = useMemo<ColoredSegment[]>(() => {
    // Provider에서 내려준 세그먼트가 있으면 우선 사용하고, 없을 때만 좌표 기반으로 재계산한다.
    if (Array.isArray(recommendedCourseSegments) && recommendedCourseSegments.length > 0) {
      return recommendedCourseSegments as ColoredSegment[];
    }
    return buildSlopeSegments(courseCoordinates);
  }, [courseCoordinates, recommendedCourseSegments]);

  const altitudeSummary = useMemo(() => summarizeAltitude(userPath), [userPath]);

  const handleAltitudeSample = useCallback(
    (altitude?: number | null) => {
      if (!Number.isFinite(altitude)) return;
      const numericAltitude = Number(altitude);

      if (baselineAltitudeRef.current == null) {
        baselineAltitudeRef.current = numericAltitude;
      }

      if (baselineAltitudeRef.current != null) {
        setRelativeAltitude(numericAltitude - baselineAltitudeRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isRunning) {
      baselineAltitudeRef.current = null;
      setRelativeAltitude(null);
    }
  }, [isRunning]);

  /** 지도 초기 영역: 경로가 있으면 첫 포인트 기준, 아니면 서울시청 근처 */
  const initialRegion = useMemo<Region>(() => {
    if (courseCoordinates.length > 0) {
      const first = courseCoordinates[0];
      return {
        latitude: first.latitude,
        longitude: first.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
    }
    return {
      latitude: 37.5665,
      longitude: 126.9780,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
  }, [courseCoordinates]);

  /** TTS 초기화: 기기 내 언어 설치 유무 확인 후 기본 언어/속도/피치 설정 */
  useEffect(() => {
    (async () => {
      try {
        const voices = await Tts.voices();
        const desiredLocale = VOICE_LANG.split('-')[0];
        const hasDesired = voices?.some(
          (voice) =>
            !voice.notInstalled &&
            (voice.language === VOICE_LANG || voice.language?.startsWith(desiredLocale))
        );

        await Tts.setDefaultLanguage(hasDesired ? VOICE_LANG : 'ko-KR');
        await Tts.setDefaultRate(0.7, true);
        await Tts.setDefaultPitch(0.9);
      } catch (error) {
        console.log('TTS init error', error);
      }
    })();
  }, []);

  /** 러닝 시작/정지 상태 변경 시 음성으로 공지 (마운트 직후 1회는 스킵) */
  useEffect(() => {
    if (!hasAnnouncedRef.current) {
      hasAnnouncedRef.current = true;
      return;
    }
    const announce = async () => {
      try {
        await Tts.stop();
        await Tts.speak(isRunning ? '러닝을 시작합니다.' : '러닝을 정지했습니다.');
      } catch (error) {
        console.log('TTS announce error', error);
      }
    };
    announce();
  }, [isRunning]);

  /** 위치 관측 시작/정리 + 지도 카메라 추적 + Provider로 위치 전달 */
  useEffect(() => {
    let mounted = true;

    if (Platform.OS === 'ios') {
      Geolocation.setRNConfiguration({
        skipPermissionRequests: false,
        authorizationLevel: 'always',
      });
    }

    // 지도 카메라를 현재 좌표로 이동
    const centerTo = (coords: GeoPosition['coords']) => {
      if (!mounted || !mapRef.current) return;
      const { latitude, longitude, heading } = coords;
      mapRef.current.animateCamera(
        {
          center: { latitude, longitude },
          zoom: 17,
          heading: heading ?? 0,
          pitch: 0,
        },
        { duration: 500 }
      );
    };

    const startWatch = async (): Promise<void> => {
      const granted = await ensureFineLocation();
      if (!granted) {
        ToastAndroid?.show?.('위치 권한이 필요합니다.', ToastAndroid.SHORT);
        return;
      }

      const backgroundGranted = await ensureBackgroundLocation();
      if (!backgroundGranted) {
        ToastAndroid?.show?.('백그라운드 위치 권한이 필요합니다.', ToastAndroid.SHORT);
      }

      // 현재 위치 1회 조회 → 지도 센터 + 상태 반영
      Geolocation.getCurrentPosition(
        (position: GeoPosition) => {
          const { latitude, longitude, altitude } = position.coords;
          handleAltitudeSample(altitude);
          centerTo(position.coords);
          updateUserLocation(latitude, longitude, altitude); // ← 팀 합의 API 호출
        },
        (error) => console.log('getCurrentPosition error', error),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );

      // 지속 관측 시작
      watchIdRef.current = Geolocation.watchPosition(
        (position: GeoPosition) => {
          const { latitude, longitude, altitude } = position.coords;
          handleAltitudeSample(altitude);
          centerTo(position.coords);
          updateUserLocation(latitude, longitude, altitude);
        },
        (error) => console.log('watchPosition error', error),
        {
          enableHighAccuracy: true,
          interval: 1000,
          fastestInterval: 500,
          distanceFilter: 4,
          forceRequestLocation: true,
          showLocationDialog: true,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: '러닝 중 위치 추적',
            notificationText: '기록을 위해 백그라운드에서 위치를 수집합니다.',
          },
        }
      );
    };

    startWatch();

    // 언마운트 시 정리
    return () => {
      mounted = false;
      if (watchIdRef.current != null) {
        Geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      Geolocation.stopObserving();
    };
  }, [handleAltitudeSample, updateUserLocation]);

  /** 추천 경로가 바뀌면 화면에 꽉 차게 맞춤 */
  useEffect(() => {
    if (!mapRef.current || courseCoordinates.length === 0) return;
    mapRef.current.fitToCoordinates(courseCoordinates, {
      edgePadding: { top: 80, bottom: 80, left: 40, right: 40 },
      animated: true,
    });
  }, [courseCoordinates]);

  /** 러닝 시작/정지 버튼 핸들러 (메모이즈) */
  const handleRunButton = useCallback(() => {
    if (isRunning) stopRunning();
    else startRunning();
  }, [isRunning, startRunning, stopRunning]);

  /** 러닝 종료 → 결과 화면으로 교체 (진행 중이면 먼저 정지) */
  const handleEndRun = useCallback(() => {
    if (isRunning) stopRunning();
    navigation.replace('Result');
  }, [isRunning, navigation, stopRunning]);

  // 추천 코스 아직 없음 → 로딩 뷰
  if (!recommendedCourse) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#5856D6" />
        <Text style={styles.loadingText}>코스 정보 불러오는 중...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* 지도 + 오버레이 */}
      <View style={styles.mapWrapper}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={initialRegion}
          showsUserLocation
          showsMyLocationButton
        >
          {/* 추천 경로 라인 렌더 (경사도에 따라 색상 구분) */}
          {slopeSegments.map((segment, index) => (
            <Polyline key={`${segment.slope}-${index}`} coordinates={segment.coordinates} strokeColor={segment.color} strokeWidth={6} />
          ))}
          {userPath.length >= 2 && (
            <Polyline coordinates={userPath} strokeColor="#5856D6" strokeWidth={5} />
          )}
        </MapView>

        {/* 상단 데이터 카드(거리/시간) – 터치 통과 */}
        <View style={styles.dataOverlay} pointerEvents="none">
          <View style={styles.dataCard}>
            <Text style={styles.label}>총 거리 (km)</Text>
            <Text style={styles.value}>{totalDistanceKm.toFixed(2)}</Text>
          </View>
          <View style={styles.dataCard}>
            <Text style={styles.label}>경과 시간</Text>
            <Text style={styles.value}>{formattedTime}</Text>
          </View>
        </View>

        <View style={styles.altitudeOverlay}>
          <Text style={styles.altitudeLabel}>고도 변화</Text>
          <Text style={styles.altitudeValue}>{formatRelativeAltitude(relativeAltitude)}</Text>
          <Text style={styles.altitudeDelta}>
            ↑ {altitudeSummary.gain.toFixed(1)} m / ↓ {altitudeSummary.loss.toFixed(1)} m
          </Text>
        </View>

        {/* 경로 정보 안내 */}
        <View style={styles.courseInfoBox}>
          <Text style={styles.courseInfoText}>
            색상으로 구분된 {slopeSegments.length}개 구간을 따라 러닝을 진행하세요.
          </Text>
        </View>
      </View>

      {/* 하단 컨트롤 버튼 영역 */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.actionButton, isRunning ? styles.pauseButton : styles.startButton]}
          onPress={handleRunButton}
        >
          <Text style={styles.buttonText}>{isRunning ? '정지 (PAUSE)' : '러닝 시작'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.endButton, isRunning && styles.disabledButton]}
          onPress={handleEndRun}
          disabled={isRunning}
        >
          <Text style={styles.endButtonText}>러닝 종료</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loadingContainer: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 16, color: '#5856D6' },
  mapWrapper: { flex: 1 },
  dataOverlay: {
    position: 'absolute',
    top: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dataCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
    width: '48%',
  },
  label: { fontSize: 14, color: '#666', marginBottom: 5 },
  value: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  altitudeOverlay: {
    position: 'absolute',
    top: 140,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(13, 71, 161, 0.9)',
    borderRadius: 12,
    padding: 12,
  },
  altitudeLabel: { color: '#BBDEFB', fontSize: 12, marginBottom: 4 },
  altitudeValue: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  altitudeDelta: { color: '#E3F2FD', fontSize: 13, marginTop: 2 },
  courseInfoBox: {
    position: 'absolute',
    bottom: 140,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(88, 86, 214, 0.9)',
    borderRadius: 10,
    padding: 12,
  },
  courseInfoText: { color: '#fff', fontSize: 14, textAlign: 'center' },
  controls: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  actionButton: {
    width: '100%',
    padding: 18,
    borderRadius: 30,
    alignItems: 'center',
    marginBottom: 10,
  },
  startButton: { backgroundColor: '#5856D6' },
  pauseButton: { backgroundColor: '#FF9500' },
  buttonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  endButton: {
    width: '100%',
    padding: 15,
    backgroundColor: '#FF3B30',
    borderRadius: 30,
    alignItems: 'center',
  },
  endButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  disabledButton: { backgroundColor: '#ccc' },
});

export default MainRunningScreen;