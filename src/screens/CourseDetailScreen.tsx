import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline, type LatLng } from 'react-native-maps';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useRunning } from '../providers/running_provider';
import type { RootStackParamList } from '../navigation/RootNavigator';
import {
  SLOPE_COLORS,
  buildDifficultyLabel,
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
    recommendedCourseSegments,
    recommendedCourseSummary,
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
  const segments = useMemo(
    () =>
      (recommendedCourseSegments?.length ? recommendedCourseSegments : buildSlopeSegments(coordinates)) as ReturnType<
        typeof buildSlopeSegments
      >,
    [coordinates, recommendedCourseSegments],
  );
  const stats = useMemo(
    () => recommendedCourseSummary ?? summarizeSegments(segments),
    [recommendedCourseSummary, segments],
  );

  const averageSlopeValue = useMemo(() => {
    if (Number.isFinite(recommendedCourseInfo?.averageSlope)) {
      return Number(recommendedCourseInfo?.averageSlope);
    }

    // API 값이 없으면 세그먼트 경사도를 거리 가중 평균으로 계산해 표시한다.
    const weighted = segments.reduce(
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
  }, [recommendedCourseInfo?.averageSlope, segments]);

  const initialRegion = useMemo(() => getBoundingRegion(coordinates), [coordinates]);

  /** 좌표 배열의 시작 지점을 출발/도착 지점으로 사용한다. */
  const startPoint = useMemo(() => {
    if (coordinates.length === 0) return null;

    return coordinates[0];
  }, [coordinates]);

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
            {startPoint && (
              <Marker coordinate={startPoint} title="출발/도착 지점" pinColor="#4CAF50" />
            )}
          </MapView>
        </View>

        <View style={styles.statRow}>
          <InfoBlock label="총 거리" value={`${(recommendedCourseInfo?.totalDistanceKm ?? stats.totalDistanceKm).toFixed(1)} km`} />
          <InfoBlock label="예상 시간" value={`${recommendedCourseInfo?.estimatedTimeMinutes ?? 30} 분`} />
          <InfoBlock
            label="난이도"
            value={buildDifficultyLabel({ difficultyType: recommendedCourseInfo?.difficultyType, slopeSummary: stats })}
          />
          <InfoBlock
            label="평균 경사도"
            value={
              Number.isFinite(averageSlopeValue) ? `${Number(averageSlopeValue).toFixed(1)}%` : '정보 없음'
            }
          />
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
  statRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 16 },
  infoBlock: {
    width: '48%',
    backgroundColor: '#fff',
    padding: 14,
    marginBottom: 8,
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
