// App.tsx 파일 전체 내용

import React from 'react';
// 내비게이션 관련 라이브러리를 가져옵니다.
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// 당신이 만든 Provider를 가져옵니다.
import { RunningProvider } from './src/providers/running_provider'; 

// 당신이 만든 화면들을 가져옵니다.
import MainRunningScreen from './src/screens/MainRunningScreen';
import RecommendationScreen from './src/screens/RecommendationScreen';
import ResultScreen from './src/screens/ResultScreen';
// import MainRunningScreen from './src/screens/MainRunningScreen'; 
// (MainRunningScreen은 지금은 Route에 추가하지 않고, Recommendation에서 바로 Result로 이동 테스트)

// 스택 네비게이터 객체를 만듭니다.
const Stack = createNativeStackNavigator();

const App = () => {
    return (
        // 1. NavigationContainer가 전체 앱을 감싸야 합니다.
        <NavigationContainer>
            {/* 2. RunningProvider가 화면 이동 기능 위에 있어야 데이터 공유 가능 */}
            <RunningProvider>
                <Stack.Navigator 
                    // 앱이 시작될 때 처음 보여줄 화면을 지정합니다.
                    initialRouteName="Recommendation" 
                    // 화면 상단 헤더(Header)를 숨깁니다.
                    screenOptions={{ headerShown: false }}
                >
                    {/* 3. 화면들을 Stack에 등록합니다. */}
                    <Stack.Screen 
                        name="Recommendation" 
                        component={RecommendationScreen} 
                    />
                    <Stack.Screen 
                        name="MainRunning"
                        component={MainRunningScreen} 
                    />
                    <Stack.Screen 
                        name="Result" 
                        component={ResultScreen} 
                    />
                    {/* [TODO] MainRunningScreen도 여기에 등록해야 합니다. */}
                </Stack.Navigator>
            </RunningProvider>
        </NavigationContainer>
    );
};

export default App;