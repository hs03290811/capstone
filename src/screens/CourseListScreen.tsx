import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import SlopeSummaryBar from '../components/SlopeSummaryBar';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useRunning } from '../providers/running_provider';
import { buildDifficultyLabel } from '../utils/courseHelpers';
import type { ColoredSegment } from '../utils/courseHelpers';

type Props = NativeStackScreenProps<RootStackParamList, 'CourseList'>;

type RecommendedCourse = {
  id: string;
  courseName: string;
  totalDistanceKm: number;
  estimatedTimeMinutes: number;
  slopeSegments?: ColoredSegment[];
  slopeSummary?: { flat: number; moderate: number; steep: number; totalDistanceKm: number };
  difficultyType?: string;
};

const CourseListScreen: React.FC<Props> = ({ navigation }) => {
  const { recommendedCourses, selectRecommendedCourse, isRecommendationLoading } = useRunning();

  const handleSelect = (id: string) => {
    const chosen = selectRecommendedCourse(id);
    if (chosen) {
      navigation.navigate('CourseDetail', { courseId: id });
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>추천된 코스</Text>
      <Text style={styles.subHeader}>아래 후보 중 하나를 선택해 상세 경로를 확인하세요.</Text>

      <FlatList
        data={recommendedCourses}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const typedItem = item as RecommendedCourse;
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => handleSelect(item.id)}
              disabled={isRecommendationLoading}
            >
              <Text style={styles.title}>{item.courseName}</Text>
              <Text style={styles.meta}>
                총 거리 {item.totalDistanceKm.toFixed(1)} km · 예상 {item.estimatedTimeMinutes} 분
              </Text>
              <Text style={styles.meta}>
                난이도: {buildDifficultyLabel({ difficultyType: typedItem.difficultyType, slopeSummary: typedItem.slopeSummary })}
              </Text>
              <SlopeSummaryBar segments={typedItem.slopeSegments || []} />
              <Text style={styles.hint}>탭하여 지도와 세부 정보를 확인하세요.</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>추천된 코스가 없습니다. 다시 시도해 주세요.</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7', padding: 20 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  subHeader: { fontSize: 14, color: '#666', marginBottom: 16 },
  listContent: { paddingBottom: 20 },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  title: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  meta: { fontSize: 13, color: '#555', marginTop: 6 },
  hint: { fontSize: 12, color: '#888', marginTop: 6 },
  emptyBox: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#777' },
});

export default CourseListScreen;
