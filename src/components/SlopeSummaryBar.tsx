// src/components/SlopeSummaryBar.tsx
// 추천 코스의 경사도 비율을 한눈에 보여주는 요약 막대 컴포넌트입니다.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ColoredSegment } from '../utils/courseHelpers';

interface Props {
  segments: ColoredSegment[];
}

const SlopeSummaryBar: React.FC<Props> = ({ segments }) => {
  if (!segments || segments.length === 0) {
    return <Text style={styles.emptyText}>경사 정보가 없습니다.</Text>;
  }

  const total = segments.reduce((sum, seg) => sum + (seg.distanceMeters || 0), 0);

  return (
    <View>
      <View style={styles.barContainer}>
        {segments.map((segment, index) => {
          const ratio = total > 0 ? (segment.distanceMeters / total) * 100 : 0;
          return (
            <View
              key={`${segment.slope}-${index}`}
              style={[styles.segment, { width: `${ratio}%`, backgroundColor: segment.color }]}
            />
          );
        })}
      </View>
      <Text style={styles.caption}>구간별 경사를 색으로 요약해 표시합니다.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  barContainer: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#E9E9E9',
    marginTop: 8,
  },
  segment: {
    height: '100%',
  },
  caption: {
    marginTop: 6,
    fontSize: 11,
    color: '#666',
  },
  emptyText: {
    fontSize: 12,
    color: '#888',
  },
});

export default SlopeSummaryBar;
