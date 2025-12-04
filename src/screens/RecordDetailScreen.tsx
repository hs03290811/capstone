import React, { useMemo, useState, useEffect } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, ToastAndroid, TouchableOpacity, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/RootNavigator';
import { getBoundingRegion } from '../utils/courseHelpers';
import { buildAltitudeSegments, summarizeAltitude } from '../utils/altitudeHelpers';
import { useRunning } from '../providers/running_provider';

type Props = NativeStackScreenProps<RootStackParamList, 'RecordDetail'>;

const RecordDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { recordId } = route.params;
  const { historyRecords, updateRunRecord, deleteRunRecord } = useRunning();
  const record = useMemo(() => (historyRecords as any[]).find((item) => item.id === recordId), [historyRecords, recordId]);
  const [titleInput, setTitleInput] = useState(record?.title ?? '');
  const [memoInput, setMemoInput] = useState(record?.notes ?? '');

  useEffect(() => {
    setTitleInput(record?.title ?? '');
    setMemoInput(record?.notes ?? '');
  }, [record]);

  const handleSave = async () => {
    if (!record) return;
    const isSaved = await updateRunRecord(record.id, { title: titleInput, notes: memoInput });
    if (isSaved) {
      ToastAndroid?.show?.('기록이 업데이트되었습니다.', ToastAndroid.SHORT);
    }
  };

  const handleDelete = () => {
    if (!record) return;
    Alert.alert('기록 삭제', '이 기록을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          const isDeleted = await deleteRunRecord(record.id);
          if (isDeleted) {
            navigation.goBack();
          }
        },
      },
    ]);
  };
  const coordinates = record?.path ?? [
    { latitude: 37.5665, longitude: 126.978 },
    { latitude: 37.57, longitude: 126.98 },
    { latitude: 37.565, longitude: 126.985 },
  ];
  const region = getBoundingRegion(coordinates);
  const altitudeSegments = useMemo(() => buildAltitudeSegments(coordinates as any), [coordinates]);
  const altitudeSummary = useMemo(() => summarizeAltitude(coordinates as any), [coordinates]);

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
      <TextInput
        style={styles.headerInput}
        value={titleInput}
        onChangeText={setTitleInput}
        placeholder="러닝 제목을 입력하세요"
      />
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
          {altitudeSegments.length > 0 ? (
            altitudeSegments.map((segment, index) => (
              <Polyline
                key={`record-alt-${index}`}
                coordinates={segment.coordinates}
                strokeColor={segment.color}
                strokeWidth={6}
              />
            ))
          ) : (
            <Polyline coordinates={coordinates} strokeColor="#5856D6" strokeWidth={5} />
          )}
        </MapView>
      </View>

      <View style={styles.row}>
        <Metric label="총 거리" value={`${record.distanceKm.toFixed(1)} km`} />
        <Metric label="시간" value={record.duration} />
        <Metric label="칼로리" value={`${record.calories ?? 0} kcal`} />
      </View>

      <View style={styles.row}>
        <Metric label="평균 속도" value={`${record.averageSpeed || '0.0'} km/h`} />
        <Metric label="평균 페이스" value={record.averagePace || '--:--'} />
        <Metric label="고도 상승" value={`${altitudeSummary.gain.toFixed(1)} m`} />
      </View>

      <View style={styles.row}>
        <Metric label="고도 하강" value={`${altitudeSummary.loss.toFixed(1)} m`} />
        <View style={{ flex: 1 }} />
        <View style={{ flex: 1 }} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>메모</Text>
        <TextInput
          style={styles.input}
          multiline
          placeholder="러닝 소감을 입력하세요"
          value={memoInput}
          onChangeText={setMemoInput}
          textAlignVertical="top"
        />
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.actionButton, styles.deleteButton]} onPress={handleDelete}>
          <Text style={[styles.actionText, styles.deleteText]}>삭제</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.saveButton]} onPress={handleSave}>
          <Text style={styles.actionText}>저장</Text>
        </TouchableOpacity>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7' },
  content: { padding: 20, paddingBottom: 40 },
  header: { fontSize: 22, fontWeight: 'bold', color: '#333' },
  headerInput: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    paddingVertical: 4,
  },
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
  input: {
    backgroundColor: '#f8f8f8',
    padding: 12,
    borderRadius: 10,
    minHeight: 100,
    fontSize: 14,
    color: '#333',
  },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  actionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  deleteButton: { backgroundColor: '#e5e7eb' },
  saveButton: { backgroundColor: '#5856D6' },
  actionText: { color: '#fff', fontWeight: 'bold' },
  deleteText: { color: '#333' },
});

export default RecordDetailScreen;
