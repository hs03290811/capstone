// src/screens/MainRunningScreen.js

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { useRunning } from '../providers/running_provider';

const MainRunningScreen = ({ navigation }) => {
    const { 
        isRunning, 
        totalDistanceKm, 
        formattedTime, 
        startRunning, 
        stopRunning, 
        recommendedCourse, // 추천 경로 데이터 (경로 표시 로직에 사용됨)
    } = useRunning();

    // 1. 러닝 버튼 핸들러
    const handleRunButton = () => {
        if (isRunning) {
            // 러닝 중이면 정지 (PAUSE)
            stopRunning();
        } else {
            // 정지 상태면 시작
            startRunning();
        }
    };
    
    // 2. [추가된 핵심 로직] 러닝 종료 핸들러
    // 이 함수는 러닝을 완전히 끝내고 결과를 저장하며 ResultScreen으로 이동시킵니다.
    const handleEndRun = () => {
        // 타이머가 작동 중이라면 정지합니다.
        if (isRunning) {
            stopRunning();
        }
        
        // [TODO] 여기에 최종 기록을 로컬 스토리지 등에 저장하는 로직이 들어갑니다.
        
        // ResultScreen으로 이동
        navigation.replace('Result'); 
        // NOTE: 'replace'를 사용하여 MainRunningScreen을 스택에서 제거합니다. 
        // 이렇게 해야 ResultScreen에서 뒤로 가기 버튼이 보이지 않습니다.
    };

    // 로딩 상태 (추천 코스를 받아오는 중일 때)
    if (!recommendedCourse) {
        // RecommendationScreen에서 Mock API가 1초 후에 데이터를 가져오지만, 
        // 만약을 대비해 로딩 UI를 표시합니다.
        return (
            <View style={[styles.container, styles.loadingContainer]}>
                <ActivityIndicator size="large" color="#5856D6" />
                <Text style={styles.loadingText}>코스 정보 불러오는 중...</Text>
            </View>
        );
    }


    return (
        <SafeAreaView style={styles.container}>
            {/* 1. 지도 영역 (FE 1 담당) */}
            <View style={styles.mapArea}>
                {/* [FE 1: 지도 컴포넌트 위치] */}
                <Text style={styles.mapPlaceholder}>[FE 1: 지도 및 경로 표시 영역]</Text>
                <Text style={styles.courseInfo}>추천 코스: {recommendedCourse.length}개 경로 데이터 로드 완료</Text>
            </View>
            
            {/* 2. 오버레이 데이터 영역 */}
            <View style={styles.dataOverlay}>
                <View style={styles.dataCard}>
                    <Text style={styles.label}>총 거리 (km)</Text>
                    <Text style={styles.value}>{totalDistanceKm.toFixed(2)}</Text>
                </View>
                <View style={styles.dataCard}>
                    <Text style={styles.label}>경과 시간</Text>
                    <Text style={styles.value}>{formattedTime}</Text>
                </View>
            </View>

            {/* 3. 제어 버튼 영역 */}
            <View style={styles.controls}>
                
                {/* A. 시작/정지 버튼 */}
                <TouchableOpacity 
                    style={[styles.actionButton, isRunning ? styles.pauseButton : styles.startButton]}
                    onPress={handleRunButton}
                >
                    <Text style={styles.buttonText}>{isRunning ? '정지 (PAUSE)' : '러닝 시작'}</Text>
                </TouchableOpacity>

                {/* B. 종료 버튼 (정지 상태일 때만 활성화) */}
                <TouchableOpacity
                    style={[styles.endButton, isRunning && styles.disabledButton]}
                    onPress={handleEndRun}
                    disabled={isRunning}
                >
                    <Text style={styles.endButtonText}>러닝 종료</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    loadingContainer: { justifyContent: 'center', alignItems: 'center' },
    loadingText: { marginTop: 10, fontSize: 16, color: '#5856D6' },
    
    mapArea: { 
        flex: 1, 
        justifyContent: 'center', 
        alignItems: 'center', 
        backgroundColor: '#eee' 
    },
    mapPlaceholder: { fontSize: 16, color: '#999' },
    courseInfo: { fontSize: 12, color: '#5856D6', marginTop: 10 },

    dataOverlay: {
        position: 'absolute', 
        top: 50, 
        left: 20, 
        right: 20, 
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    dataCard: {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        padding: 15,
        borderRadius: 10,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 5,
        width: '48%',
    },
    label: { fontSize: 14, color: '#666', marginBottom: 5 },
    value: { fontSize: 24, fontWeight: 'bold', color: '#333' },

    controls: { 
        padding: 20, 
        borderTopWidth: 1, 
        borderTopColor: '#f0f0f0',
        alignItems: 'center',
    },
    actionButton: {
        width: '100%',
        padding: 18,
        borderRadius: 30,
        alignItems: 'center',
        marginBottom: 10,
    },
    startButton: { backgroundColor: '#5856D6' },
    pauseButton: { backgroundColor: '#FF9500' },
    buttonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
    
    endButton: {
        width: '100%',
        padding: 15,
        backgroundColor: '#FF3B30',
        borderRadius: 30,
        alignItems: 'center',
    },
    endButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    disabledButton: { backgroundColor: '#ccc' },
});

export default MainRunningScreen;