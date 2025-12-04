import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';

import type { RootStackParamList } from '../navigation/RootNavigator';
import { useRunning } from '../providers/running_provider';
import { summarizeAltitude } from '../utils/altitudeHelpers';

type HistoryItem = {
  id: string;
  date: string;
  distanceKm: number;
  duration: string;
  slopeBreakdown: { flat: number; moderate: number; steep: number };
  title: string;
  notes: string;
  averagePace?: string;
  calories?: number;
  path?: any[];
};

const RecordsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { historyRecords } = useRunning();
  const renderItem = ({ item }: { item: HistoryItem }) => {
    const altitudeSummary = summarizeAltitude(Array.isArray(item.path) ? (item.path as any) : []);

    return (
      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('RecordDetail', { recordId: item.id })}>
        <View style={styles.cardHeader}>
          <Text style={styles.date}>{item.date}</Text>
          <Text style={styles.title}>{item.title}</Text>
        </View>

        <View style={styles.row}>
          <Badge label="거리" value={`${item.distanceKm.toFixed(1)} km`} />
          <Badge label="시간" value={item.duration} />
          <Badge label="고도 변화" value={`↑ ${altitudeSummary.gain.toFixed(0)}m / ↓ ${altitudeSummary.loss.toFixed(0)}m`} />
        </View>

        <View style={styles.row}>
          <Badge label="평균 페이스" value={item.averagePace || "--'--\""} />
          <Badge label="칼로리" value={`${item.calories ?? 0} kcal`} />
          <View style={{ flex: 1 }} />
        </View>

        <Text numberOfLines={2} style={styles.notes}>
          {item.notes}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>지난 기록</Text>
      <Text style={styles.subHeader}>날짜별 러닝 데이터를 확인하고 상세 페이지에서 지도와 지표를 확인하세요.</Text>

      <FlatList
        data={historyRecords as HistoryItem[]}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const Badge = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.badge}>
    <Text style={styles.badgeLabel}>{label}</Text>
    <Text style={styles.badgeValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7', padding: 20 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#333', marginBottom: 6 },
  subHeader: { fontSize: 14, color: '#666', marginBottom: 12 },
  listContent: { paddingBottom: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeader: { marginBottom: 8 },
  date: { fontSize: 12, color: '#888' },
  title: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 8 },
  badge: {
    flex: 1,
    backgroundColor: '#f2f2ff',
    paddingVertical: 10,
    marginHorizontal: 4,
    borderRadius: 10,
    alignItems: 'center',
  },
  badgeLabel: { fontSize: 12, color: '#666' },
  badgeValue: { fontSize: 14, fontWeight: 'bold', color: '#333' },
  notes: { fontSize: 13, color: '#444', lineHeight: 18 },
});

export default RecordsScreen;
