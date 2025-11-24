// src/screens/ResultScreen.js

import React, { useMemo, useState } from 'react';
import {
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { useNavigation } from '@react-navigation/native';

import { useRunning } from '../providers/running_provider';
import { getBoundingRegion } from '../utils/courseHelpers';

const ResultScreen = () => {
    const navigation = useNavigation();
    const [title, setTitle] = useState('오늘의 러닝');
    const [notes, setNotes] = useState('');

    const {
        totalDistanceKm,
        formattedTime,
        userPath,
        resetRunData,
        addRunRecord,
        caloriesBurned,
    } = useRunning();

    const timeParts = formattedTime.split(':').map(Number);
    const totalSeconds = (timeParts[0] * 3600) + (timeParts[1] * 60) + timeParts[2];

    const averageSpeed =
        totalDistanceKm > 0 && totalSeconds > 0
            ? (totalDistanceKm / (totalSeconds / 3600)).toFixed(1)
            : '0.0';

    const averagePace =
        totalDistanceKm > 0 && totalSeconds > 0
            ? `${Math.floor(totalSeconds / 60 / totalDistanceKm)
                .toString()
                .padStart(2, '0')}:${Math.floor((totalSeconds / totalDistanceKm) % 60)
                .toString()
                .padStart(2, '0')}`
            : '--:--';

    const courseCoordinates = useMemo(() => (userPath && userPath.length ? userPath : []), [userPath]);
    const initialRegion = useMemo(() => getBoundingRegion(courseCoordinates), [courseCoordinates]);

    // 칼로리 표기를 안전하게 처리 (비정상 값은 0으로 대체)
    const calories = useMemo(() => {
        if (!Number.isFinite(caloriesBurned)) {
            return 0;
        }
        return Number(caloriesBurned.toFixed(0));
    }, [caloriesBurned]);

    const handleSave = async () => {
        const recordTitle = title.trim() || '러닝 기록';
        const today = new Date();
        const date = today.toISOString().slice(0, 10);
        const isSaved = await addRunRecord({
            title: recordTitle,
            date,
            distanceKm: Number(totalDistanceKm.toFixed(2)),
            duration: formattedTime,
            averageSpeed,
            averagePace,
            slopeBreakdown: { flat: 100, moderate: 0, steep: 0 },
            calories,
            path: courseCoordinates,
            notes,
        });
        if (!isSaved) {
            Alert.alert('저장 실패', '기록 저장 중 문제가 발생했습니다. 다시 시도해 주세요.');
            return;
        }
        Alert.alert('저장 완료', '기록이 저장되었습니다.', [
            {
                text: '확인',
                onPress: () => {
                    resetRunData();
                    navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
                },
            },
        ]);
    };

    const handleDiscard = () => {
        resetRunData();
        navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>👏 러닝 기록 요약</Text>
                <Text style={styles.headerSubtitle}>오늘의 러닝, 수고하셨습니다!</Text>
            </View>

            <ScrollView style={styles.summaryContainer}>
                <View style={styles.inputCard}>
                    <Text style={styles.label}>제목</Text>
                    <TextInput
                        value={title}
                        onChangeText={setTitle}
                        placeholder="기록 제목을 입력하세요"
                        style={styles.textInput}
                    />
                    <Text style={styles.dateText}>{new Date().toLocaleDateString()}</Text>
                    <Text style={[styles.label, styles.memoLabel]}>메모</Text>
                    <TextInput
                        value={notes}
                        onChangeText={setNotes}
                        placeholder="러닝 중 느낀 점을 기록하세요"
                        style={[styles.textInput, styles.memoInput]}
                        multiline
                        numberOfLines={3}
                    />
                </View>

                <View style={styles.metricsRow}>
                    <MetricBox label="총 거리" value={totalDistanceKm.toFixed(2)} unit="km" />
                    <MetricBox label="경과 시간" value={formattedTime} unit="시:분:초" />
                </View>

                <View style={styles.metricsRow}>
                    <MetricBox label="평균 속도" value={averageSpeed} unit="km/h" />
                    <MetricBox label="평균 페이스" value={averagePace} unit="분/㎞" />
                </View>

                <View style={styles.metricsRow}>
                    <MetricBox label="평균 경사" value={'--'} unit="%" />
                    <MetricBox label="칼로리" value={calories.toString()} unit="kcal" />
                </View>

                <View style={styles.mapCard}>
                    {courseCoordinates.length >= 2 ? (
                        <MapView
                            style={styles.map}
                            initialRegion={initialRegion}
                            scrollEnabled={false}
                            pitchEnabled={false}
                            rotateEnabled={false}
                            zoomEnabled={false}
                            zoomControlEnabled={false}
                        >
                            <Polyline
                                coordinates={courseCoordinates}
                                strokeColor="#5856D6"
                                strokeWidth={6}
                            />
                        </MapView>
                    ) : (
                        <View style={styles.mapPlaceholder}>
                            <Text style={styles.placeholderText}>시각화할 경로가 없습니다.</Text>
                        </View>
                    )}
                    <Text style={styles.mapCaption}>내가 뛴 경로를 색상으로 시각화합니다.</Text>
                </View>
            </ScrollView>

            <View style={styles.actions}>
                <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={handleDiscard}>
                    <Text style={[styles.buttonText, styles.secondaryText]}>저장하지 않고 홈으로</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={handleSave}>
                    <Text style={styles.buttonText}>저장하기</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const MetricBox = ({ label, value, unit }) => (
    <View style={styles.metricBox}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>{value}</Text>
        <Text style={styles.metricUnit}>{unit}</Text>
    </View>
);

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f9f9f9' },
    header: { padding: 30, backgroundColor: '#5856D6', alignItems: 'center' },
    headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 5 },
    headerSubtitle: { fontSize: 16, color: '#e0e0e0' },
    summaryContainer: { paddingHorizontal: 20, paddingTop: 20 },
    inputCard: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 5,
        elevation: 2,
    },
    label: { fontSize: 14, color: '#666', marginBottom: 8 },
    textInput: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 10,
        padding: 12,
        fontSize: 16,
        backgroundColor: '#fafafa',
    },
    memoLabel: { marginTop: 12 },
    memoInput: { minHeight: 80, textAlignVertical: 'top' },
    dateText: { marginTop: 8, color: '#888', fontSize: 12 },
    metricsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
    metricBox: {
        flex: 1,
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginHorizontal: 4,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
    },
    metricLabel: { fontSize: 14, color: '#666' },
    metricValue: { fontSize: 32, fontWeight: '800', color: '#333' },
    metricUnit: { fontSize: 13, color: '#888', marginTop: 4 },
    mapCard: {
        backgroundColor: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
        marginBottom: 20,
    },
    map: { height: 220 },
    mapPlaceholder: {
        height: 220,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f2f2f2',
    },
    placeholderText: { color: '#666' },
    mapCaption: { padding: 12, color: '#555', fontSize: 13, textAlign: 'center' },
    actions: { flexDirection: 'row', padding: 16, gap: 10 },
    button: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center' },
    primaryButton: { backgroundColor: '#4CD964' },
    secondaryButton: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    secondaryText: { color: '#333' },
});

export default ResultScreen;