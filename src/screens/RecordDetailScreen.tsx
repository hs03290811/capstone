import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/RootNavigator';
import { SLOPE_COLORS, getBoundingRegion } from '../utils/courseHelpers';
import { useRunning } from '../providers/running_provider';

type Props = NativeStackScreenProps<RootStackParamList, 'RecordDetail'>;

const RecordDetailScreen: React.FC<Props> = ({ route }) => {
  const { recordId } = route.params;
  const { historyRecords } = useRunning();
  const record = useMemo(() => (historyRecords as any[]).find((item) => item.id === recordId), [historyRecords, recordId]);
  const coordinates = record?.path ?? [
    { latitude: 37.5665, longitude: 126.978 },
    { latitude: 37.57, longitude: 126.98 },
    { latitude: 37.565, longitude: 126.985 },
  ];
  const region = getBoundingRegion(coordinates);

  if (!record) {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>기록을 찾을 수 없습니다.</Text>
        <Text style={styles.subHeader}>목록으로 돌아가 다시 선택해주세요.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>{record.title}</Text>
      <Text style={styles.subHeader}>{record.date}</Text>

      <View style={styles.mapWrapper}>
        <MapView
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          scrollEnabled={false}
          pitchEnabled={false}
          rotateEnabled={false}
          zoomEnabled={false}
          zoomControlEnabled={false}
        >
          <Polyline coordinates={coordinates} strokeColor={SLOPE_COLORS.flat} strokeWidth={5} />
        </MapView>
      </View>

      <View style={styles.row}>
        <Metric label="총 거리" value={`${record.distanceKm.toFixed(1)} km`} />
        <Metric label="시간" value={record.duration} />
        <Metric label="평지 비율" value={`${record.slopeBreakdown.flat}%`} />
      </View>

      <View style={styles.row}>
        <Metric label="평균 속도" value={`${record.averageSpeed || '0.0'} km/h`} />
        <Metric label="평균 페이스" value={record.averagePace || '--:--'} />
        <Metric label="칼로리" value={`${record.calories ?? 0} kcal`} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>경사도 비율</Text>
        <View style={styles.legendRow}>
          <Legend color={SLOPE_COLORS.flat} label="평지" value={`${record.slopeBreakdown.flat}%`} />
          <Legend color={SLOPE_COLORS.moderate} label="중간" value={`${record.slopeBreakdown.moderate}%`} />
          <Legend color={SLOPE_COLORS.steep} label="가파름" value={`${record.slopeBreakdown.steep}%`} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>메모</Text>
        <Text style={styles.paragraph}>{record.notes}</Text>
      </View>
    </ScrollView>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.metric}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={styles.metricValue}>{value}</Text>
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
  content: { padding: 20, paddingBottom: 40 },
  header: { fontSize: 22, fontWeight: 'bold', color: '#333' },
  subHeader: { fontSize: 14, color: '#666', marginBottom: 12 },
  mapWrapper: {
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#e6e6e6',
    marginBottom: 16,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  metric: {
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
  metricLabel: { fontSize: 12, color: '#888' },
  metricValue: { fontSize: 18, fontWeight: 'bold', color: '#333' },
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
  legendDot: { width: 14, height: 14, borderRadius: 7, marginRight: 8 },
  legendLabel: { fontSize: 13, color: '#333' },
  legendValue: { fontSize: 12, color: '#666' },
});

export default RecordDetailScreen;
