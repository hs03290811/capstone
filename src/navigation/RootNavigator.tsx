import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import RecommendationScreen from '../screens/RecommendationScreen';
import MainRunningScreen from '../screens/MainRunningScreen';
import ResultScreen from '../screens/ResultScreen';

export type RootStackParamList = {
  Recommendation: undefined;
  MainRunning: undefined;
  Result: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const RootNavigator = () => {
  return (
    <Stack.Navigator
      initialRouteName="Recommendation"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="Recommendation" component={RecommendationScreen} />
      <Stack.Screen name="MainRunning" component={MainRunningScreen} />
      <Stack.Screen name="Result" component={ResultScreen} />
    </Stack.Navigator>
  );
};

export default RootNavigator;