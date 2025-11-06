// src/components/SlopeButton.js

import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

const SlopeButton = ({ title, slopeType, selectedSlope, onSelect }) => {
    // 현재 버튼의 slopeType이 Provider의 selectedSlope과 일치하면 선택된 상태입니다.
    const isSelected = selectedSlope === slopeType;

    return (
        <TouchableOpacity
            // 선택 여부에 따라 다른 스타일을 적용합니다.
            style={[styles.button, isSelected ? styles.selectedButton : styles.unselectedButton]}
            // 버튼 클릭 시, 해당 slopeType을 Provider로 전달합니다.
            onPress={() => onSelect(slopeType)}
        >
            <Text style={[styles.buttonText, isSelected ? styles.selectedText : styles.unselectedText]}>
                {title}
            </Text>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    button: {
        paddingVertical: 10,
        paddingHorizontal: 15,
        borderRadius: 20,
        marginHorizontal: 5,
        minWidth: 80,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
    },
    unselectedButton: {
        backgroundColor: '#fff',
        borderColor: '#ddd',
    },
    selectedButton: {
        backgroundColor: '#5856D6', // 선택 시 진한 보라색 (iOS 기본 색상 톤)
        borderColor: '#5856D6',
    },
    buttonText: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    unselectedText: {
        color: '#333',
    },
    selectedText: {
        color: '#fff',
    },
});

export default SlopeButton;