// src/screens/CourseListScreen.tsx

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRunning } from '../providers/running_provider';

const CourseListScreen: React.FC = () => {
  // 타입 귀찮으니 any로 받아서 navigate 에러 없애기
  const navigation = useNavigation<any>();

  const { recommendedCourses, selectRecommendedCourse } = useRunning();

  console.log(
    '[CourseListScreen] recommendedCourses length:',
    recommendedCourses?.length,
  );
  console.log('[CourseListScreen] recommendedCourses:', recommendedCourses);

  if (!recommendedCourses || recommendedCourses.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.headerTitle}>추천된 코스</Text>
        <Text style={styles.emptyText}>
          추천된 코스가 없습니다. 다시 시도해 주세요.
        </Text>
      </View>
    );
  }

  const renderItem = ({ item }: { item: any }) => {
    const distanceText = (item.totalDistanceKm ?? 0).toFixed(2);
    const timeText = (item.estimatedTimeMinutes ?? 0).toFixed(0);

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => {
          selectRecommendedCourse(item.id);
          navigation.navigate('CourseDetail', { courseId: item.id });
        }}
      >
        <Text style={styles.courseName}>{item.courseName}</Text>
        <Text style={styles.courseInfo}>
          거리: {distanceText} km | 예상 시간: {timeText} 분
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>추천된 코스</Text>
      <Text style={styles.subTitle}>
        아래 후보 중 하나를 선택해 상세 경로를 확인하세요.
      </Text>

      <FlatList
        data={recommendedCourses}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.listContainer}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    backgroundColor: '#F9F9F9',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#333',
  },
  subTitle: {
    fontSize: 14,
    color: '#777',
    marginBottom: 16,
  },
  listContainer: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    elevation: 2,
  },
  courseName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6,
    color: '#333',
  },
  courseInfo: {
    fontSize: 14,
    color: '#555',
  },
  emptyContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    alignItems: 'center',
    backgroundColor: '#F9F9F9',
  },
  emptyText: {
    marginTop: 40,
    fontSize: 15,
    color: '#777',
  },
});

export default CourseListScreen;
