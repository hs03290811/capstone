import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useRunning } from '../providers/running_provider';
import type { RootStackParamList } from '../navigation/RootNavigator';
import {
  SLOPE_COLORS,
  buildSlopeSegments,
  geoJsonToCoordinates,
  getBoundingRegion,
  summarizeSegments,
} from '../utils/courseHelpers';

type Props = NativeStackScreenProps<RootStackParamList, 'CourseDetail'>;

const CourseDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const courseId = route.params?.courseId;
  const {
    recommendedCourse,
    recommendedCourseInfo,
    recommendedCourses,
    selectRecommendedCourse,
  } = useRunning();

  React.useEffect(() => {
    if ((!recommendedCourse || !recommendedCourseInfo) && courseId) {
      const matched = selectRecommendedCourse(courseId);
      if (!matched && recommendedCourses.length === 0) {
        navigation.replace('CourseList');
      }
    }
  }, [courseId, navigation, recommendedCourse, recommendedCourseInfo, recommendedCourses.length, selectRecommendedCourse]);

  const coordinates = useMemo(() => geoJsonToCoordinates(recommendedCourse ?? undefined), [recommendedCourse]);
  const segments = useMemo(() => buildSlopeSegments(coordinates), [coordinates]);
  const stats = useMemo(() => summarizeSegments(segments), [segments]);

  const initialRegion = useMemo(() => getBoundingRegion(coordinates), [coordinates]);

  const handleStart = () => {
    navigation.navigate('MainRunning');
  };

  if (!recommendedCourse) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.title}>추천 코스를 불러오지 못했습니다.</Text>
        <Text style={styles.subtitle}>다시 코스를 선택해 주세요.</Text>
        <TouchableOpacity style={styles.startButton} onPress={() => navigation.replace('CourseList')}>
          <Text style={styles.startButtonText}>추천 목록으로 돌아가기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>{recommendedCourseInfo?.courseName ?? '추천 코스 상세'}</Text>
        <Text style={styles.subtitle}>경사도를 색으로 시각화한 추천 경로를 확인하세요.</Text>

        <View style={styles.mapWrapper}>
          <MapView
            style={StyleSheet.absoluteFill}
            initialRegion={initialRegion}
            scrollEnabled={false}
            pitchEnabled={false}
            rotateEnabled={false}
            zoomEnabled={false}
            zoomControlEnabled={false}
          >
            {segments.map((segment, index) => (
              <Polyline key={`${segment.slope}-${index}`} coordinates={segment.coordinates} strokeColor={segment.color} strokeWidth={6} />
            ))}
          </MapView>
        </View>

        <View style={styles.statRow}>
          <InfoBlock label="총 거리" value={`${(recommendedCourseInfo?.totalDistanceKm ?? stats.totalDistanceKm).toFixed(1)} km`} />
          <InfoBlock label="예상 시간" value={`${recommendedCourseInfo?.estimatedTimeMinutes ?? 30} 분`} />
          <InfoBlock label="난이도" value={buildDifficultyLabel(stats)} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>경사도 구간 길이</Text>
          <View style={styles.legendRow}>
            <Legend color={SLOPE_COLORS.flat} label="평지" value={`${(stats.flat / 1000).toFixed(1)} km`} />
            <Legend color={SLOPE_COLORS.moderate} label="중간" value={`${(stats.moderate / 1000).toFixed(1)} km`} />
            <Legend color={SLOPE_COLORS.steep} label="가파름" value={`${(stats.steep / 1000).toFixed(1)} km`} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>코스 정보</Text>
          <Text style={styles.paragraph}>원형 코스 여부와 구간별 경사도를 색으로 표현해 실전 느낌을 제공합니다.</Text>
          <Text style={styles.paragraph}>출발 전 예상 난이도와 시간을 확인하고 맞춤형 러닝을 시작해보세요.</Text>
        </View>
      </ScrollView>

      <TouchableOpacity style={styles.startButton} onPress={handleStart}>
        <Text style={styles.startButtonText}>코스 시작하기</Text>
      </TouchableOpacity>
    </View>
  );
};

const InfoBlock = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.infoBlock}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

const Legend = ({ color, label, value }: { color: string; label: string; value: string }) => (
  <View style={styles.legendItem}>
    <View style={[styles.legendDot, { backgroundColor: color }]} />
    <View>
      <Text style={styles.legendLabel}>{label}</Text>
      <Text style={styles.legendValue}>{value}</Text>
    </View>
  </View>
);

function buildDifficultyLabel(stats: ReturnType<typeof summarizeSegments>) {
  const { flat, moderate, steep } = stats;
  const total = flat + moderate + steep;
  if (total === 0) return '정보 없음';

  const steepRatio = steep / total;
  if (steepRatio > 0.25) return '고난도';
  if (steepRatio > 0.15) return '중간';
  return '쉬움';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7' },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 20 },
  scrollContent: { padding: 20, paddingBottom: 120 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#333', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 16 },
  mapWrapper: {
    height: 240,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#e6e6e6',
    marginBottom: 16,
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  infoBlock: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 14,
    marginHorizontal: 4,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  infoLabel: { fontSize: 12, color: '#888', marginBottom: 6 },
  infoValue: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  paragraph: { fontSize: 14, color: '#555', lineHeight: 20 },
  legendRow: { flexDirection: 'row', justifyContent: 'space-between' },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 16, height: 16, borderRadius: 8, marginRight: 8 },
  legendLabel: { fontSize: 13, color: '#333' },
  legendValue: { fontSize: 12, color: '#666' },
  startButton: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 18,
    backgroundColor: '#5856D6',
    alignItems: 'center',
  },
  startButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});

export default CourseDetailScreen;
