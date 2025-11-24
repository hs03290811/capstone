import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import RecommendationScreen from '../screens/RecommendationScreen';
import MainRunningScreen from '../screens/MainRunningScreen';
import ResultScreen from '../screens/ResultScreen';
import CourseDetailScreen from '../screens/CourseDetailScreen';
import CourseListScreen from '../screens/CourseListScreen';
import RecordsScreen from '../screens/RecordsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import RecordDetailScreen from '../screens/RecordDetailScreen';

export type RootStackParamList = {
    MainTabs: undefined;
    CourseList: undefined;
    CourseDetail: { courseId?: string } | undefined;
    MainRunning: undefined;
    Result: undefined;
    RecordDetail: { recordId: string };
};

type MainTabsParamList = {
    Recommendation: undefined;
    Records: undefined;
    Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabsParamList>();

export const MainTabsNavigator = () => ( // Named Export로 변경
    <Tab.Navigator
        screenOptions={{
            headerShown: false,
            // 아이콘이 깨져 보이는 문제를 피하기 위해 아이콘을 숨기고 라벨만 노출
            tabBarIcon: () => null,
            tabBarLabel: ({ focused, children }) => (
                <Text style={{ color: focused ? '#5856D6' : '#666', fontSize: 12 }}>{children}</Text>
            ),
        }}
    >
        <Tab.Screen name="Recommendation" component={RecommendationScreen} options={{ title: '홈' }} />
        <Tab.Screen name="Records" component={RecordsScreen} options={{ title: '기록' }} />
        <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: '설정' }} />
    </Tab.Navigator>
);

// 💡 RootNavigator를 Named Export로 정의하고, default로 다시 한 번 내보냅니다.
export const RootNavigator = () => {
    return (
        <Stack.Navigator
            initialRouteName="MainTabs"
            screenOptions={{ headerShown: false }}
        >
            <Stack.Screen name="MainTabs" component={MainTabsNavigator} />
            <Stack.Screen name="CourseList" component={CourseListScreen} />
            <Stack.Screen name="CourseDetail" component={CourseDetailScreen} />
            <Stack.Screen name="MainRunning" component={MainRunningScreen} />
            <Stack.Screen name="Result" component={ResultScreen} />
            <Stack.Screen name="RecordDetail" component={RecordDetailScreen} />
        </Stack.Navigator>
    );
};

export default RootNavigator; // Default Export는 유지