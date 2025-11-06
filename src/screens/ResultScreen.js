// src/screens/ResultScreen.js

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRunning } from '../providers/running_provider';

const ResultScreen = ({ navigation }) => {
    // Provider에서 최종 결과 데이터와 상태, 그리고 액션(함수)을 가져옵니다.
    const { 
        totalDistanceKm, 
        formattedTime, 
        recommendedCourse, 
        // [수정] Provider에서 resetRunData 함수를 가져옵니다.
        resetRunData, 
    } = useRunning();

    // 1. 총 시간을 초 단위로 변환 (00:00:00 -> 0)
    // [NaN 오류 방지] 시간이 HH:MM:SS 형식이라고 가정하고 초로 변환합니다.
    const timeParts = formattedTime.split(':').map(Number);
    const totalSeconds = (timeParts[0] * 3600) + (timeParts[1] * 60) + timeParts[2];
    
    // 2. 평균 속도 계산 (NaN 방지 로직 포함)
    const averageSpeed = 
        totalDistanceKm > 0 && totalSeconds > 0
        ? (totalDistanceKm / (totalSeconds / 3600)).toFixed(1)
        : '0.0'; // 총 거리가 0이거나 시간이 0이면 NaN 대신 '0.0' 표시

    // 3. '새로운 러닝 시작하기' 버튼 핸들러
    const handleNewRun = () => {
        resetRunData(); // Provider 상태 초기화
        // 코스 추천 설정 화면으로 이동
        navigation.navigate('Recommendation'); 
    };

    // 현재는 마지막에 업데이트된 Provider 값을 표시합니다.
    const finalDistance = totalDistanceKm;
    const finalTime = formattedTime;

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>👏 러닝 기록 요약</Text>
                <Text style={styles.headerSubtitle}>오늘의 러닝, 수고하셨습니다!</Text>
            </View>

            <ScrollView style={styles.summaryContainer}>
                
                {/* 1. 핵심 지표 */}
                <View style={styles.metricCard}>
                    <Text style={styles.metricLabel}>총 거리</Text>
                    <Text style={styles.metricValue}>{finalDistance.toFixed(2)}</Text>
                    <Text style={styles.unit}>km</Text>
                </View>

                <View style={styles.metricCard}>
                    <Text style={styles.metricLabel}>경과 시간</Text>
                    <Text style={styles.metricValue}>{finalTime}</Text>
                    <Text style={styles.unit}>시:분:초</Text>
                </View>

                {/* 2. 경로 시각화 영역 (FE 1 담당) */}
                <View style={styles.mapArea}>
                    <Text style={styles.mapPlaceholder}>[FE 1: 최종 러닝 경로 시각화 영역]</Text>
                    <Text style={styles.mapInfo}>
                        총 {recommendedCourse ? '12.5' : '0'}km 코스를 {finalDistance.toFixed(2)}km 완료
                    </Text>
                </View>
                
                {/* 3. 기타 지표 */}
                <View style={styles.detailCard}>
                    <Text style={styles.detailText}>소모 칼로리: 350 kcal (가정)</Text>
                    {/* [수정] 평균 속도에 NaN 방지 로직 적용 */}
                    <Text style={styles.detailText}>평균 속도: {averageSpeed} km/h</Text>
                </View>

            </ScrollView>

            {/* 하단 버튼 */}
            <TouchableOpacity style={styles.actionButton} onPress={handleNewRun}>
                <Text style={styles.actionButtonText}>새로운 러닝 시작하기</Text>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f9f9f9', },
    header: { padding: 30, backgroundColor: '#5856D6', alignItems: 'center', },
    headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 5, },
    headerSubtitle: { fontSize: 16, color: '#e0e0e0', },
    summaryContainer: { paddingHorizontal: 20, paddingTop: 20, },
    
    metricCard: { 
        backgroundColor: '#fff', borderRadius: 12, padding: 20, marginBottom: 15, 
        alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 3,
    },
    metricLabel: { fontSize: 16, color: '#888', marginBottom: 5, },
    metricValue: { fontSize: 48, fontWeight: '900', color: '#333', },
    unit: { fontSize: 18, color: '#555', marginTop: 5, },

    mapArea: { 
        height: 200, backgroundColor: '#ddd', borderRadius: 12, marginBottom: 15,
        justifyContent: 'center', alignItems: 'center', 
    },
    mapPlaceholder: { color: '#666', fontSize: 16, marginBottom: 5, },
    mapInfo: { color: '#555', fontSize: 14, },

    detailCard: { 
        backgroundColor: '#fff', borderRadius: 12, padding: 20, marginBottom: 20,
    },
    detailText: { fontSize: 16, color: '#555', lineHeight: 24, },

    actionButton: { 
        backgroundColor: '#4CD964', padding: 20, alignItems: 'center', 
    },
    actionButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold', },
});

export default ResultScreen;