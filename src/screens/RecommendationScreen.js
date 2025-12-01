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
import { useRunning } from '../providers/running_provider';

const RecommendationScreen = ({ navigation }) => {
  const { fetchCourseRecommendation, isRecommendationLoading } = useRunning();

  // 사용자가 설정하는 희망 거리 (km)
  const [desiredDistance, setDesiredDistance] = useState(5.0);

  // 🔹 슬라이더 값 변경
  const handleDistanceChange = (value) => {
    const roundedValue = Math.round(value * 10) / 10;
    setDesiredDistance(roundedValue);
  };

  // 🔹 추천 버튼 클릭
  const handleRecommendCourse = async () => {
    if (isRecommendationLoading) return;

    console.log('[RecommendScreen] 버튼 눌림');
    const success = await fetchCourseRecommendation(desiredDistance);
    console.log('[RecommendScreen] fetch success:', success);

    if (success) {
      console.log('[RecommendScreen] navigating to CourseList...');
      navigation.navigate('CourseList'); 
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
        {/* 총 거리 설정 영역 */}
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
          <Text style={[styles.description, { marginTop: 4 }]}>
            현재 GPS 위치를 기반으로 다양한 경사도의 코스를 자동으로 추천합니다.
          </Text>
        </View>
      </ScrollView>

      {/* 하단 버튼 */}
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
