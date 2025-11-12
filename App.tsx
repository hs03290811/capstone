import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { RunningProvider } from './src/providers/running_provider';
import RootNavigator from './src/navigation/RootNavigator';

const App = () => {
  return (
    <NavigationContainer>
      <RunningProvider>
        <RootNavigator />
      </RunningProvider>
    </NavigationContainer>
  );
};

export default App;
