// src/screens/RecommendationScreen.js

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import SlopeButton from '../components/SlopeButton';
import { useRunning, SLOPE_TYPES } from '../providers/running_provider';

const RecommendationScreen = ({ navigation }) => {
  const {
    selectedSlope,
    selectSlope,
    fetchCourseRecommendation,
    isRecommendationLoading,
  } = useRunning();

  const [desiredDistance, setDesiredDistance] = useState(5.0);

  // 🔹 슬라이더 값 변경 핸들러 (빠져 있던 부분)
  const handleDistanceChange = (value) => {
    const roundedValue = Math.round(value * 10) / 10;
    setDesiredDistance(roundedValue);
  };

  // 🔹 추천 버튼 눌렀을 때
  const handleRecommendCourse = async () => {
    if (isRecommendationLoading) return;

    console.log('[RecommendScreen] 버튼 눌림');
    const success = await fetchCourseRecommendation(desiredDistance, selectedSlope);
    console.log('[RecommendScreen] fetch success:', success);

    if (success) {
      console.log('[RecommendScreen] navigating to CourseList...');
      navigation.navigate('CourseList'); // RootNavigator에 name="CourseList" 인지 확인
    } else {
      console.log('[RecommendScreen] 서버/네트워크 에러로 화면 이동 안 함');
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.contentContainer}
      >
        {/* 1. 총 거리 슬라이더 영역 */}
        <View style={styles.settingBlock}>
          <Text style={styles.title}>🏃‍♂️ 희망 총 거리 설정</Text>

          <View style={styles.distanceBox}>
            <Text style={styles.distanceValue}>{desiredDistance.toFixed(1)} km</Text>
          </View>

          <Slider
            style={{ width: '100%', height: 40 }}
            minimumValue={1}
            maximumValue={20}
            step={0.1}
            value={desiredDistance}
            onValueChange={handleDistanceChange}
            minimumTrackTintColor="#5856D6"
            maximumTrackTintColor="#C0C0C0"
            thumbTintColor="#5856D6"
            disabled={isRecommendationLoading}
          />
          <Text style={styles.description}>
            슬라이더를 움직여 희망하는 러닝 거리를 설정해주세요.
          </Text>
        </View>

        {/* 2. 경사도 선택 영역 */}
        <View style={styles.settingBlock}>
          <Text style={styles.title}>⛰️ 코스 경사도 선택</Text>
          <View style={styles.buttonGroup}>
            <SlopeButton
              title="완만함 (FLAT)"
              slopeType={SLOPE_TYPES.FLAT}
              selectedSlope={selectedSlope}
              onSelect={selectSlope}
            />
            <SlopeButton
              title="보통 (MODERATE)"
              slopeType={SLOPE_TYPES.MODERATE}
              selectedSlope={selectedSlope}
              onSelect={selectSlope}
            />
            <SlopeButton
              title="가파름 (STEEP)"
              slopeType={SLOPE_TYPES.STEEP}
              selectedSlope={selectedSlope}
              onSelect={selectSlope}
            />
          </View>
          <Text style={styles.description}>
            선택하신 경사도에 맞춰 최적의 코스를 추천합니다.
          </Text>
        </View>
      </ScrollView>

      {/* 하단 버튼 및 로딩 스피너 */}
      <TouchableOpacity
        style={[
          styles.recommendButton,
          isRecommendationLoading && styles.loadingButton,
        ]}
        onPress={handleRecommendCourse}
        disabled={isRecommendationLoading}
      >
        {isRecommendationLoading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.recommendButtonText}>코스 추천받기</Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9' },
  scrollContainer: { flex: 1, paddingHorizontal: 20 },
  contentContainer: { paddingTop: 30, paddingBottom: 100 },
  settingBlock: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, color: '#333' },
  description: {
    fontSize: 14,
    color: '#888',
    marginTop: 15,
    textAlign: 'center',
  },
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 10,
  },
  distanceBox: {
    paddingVertical: 15,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  distanceValue: {
    fontSize: 32,
    fontWeight: '900',
    color: '#5856D6',
  },
  recommendButton: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#5856D6',
    padding: 20,
    alignItems: 'center',
  },
  loadingButton: {
    backgroundColor: '#999',
  },
  recommendButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});

export default RecommendationScreen;
