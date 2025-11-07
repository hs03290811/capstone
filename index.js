import { AppRegistry } from 'react-native';
import App from './App'; // <-- App.tsx에서 만든 App 컴포넌트를 다시 불러옵니다.
import { RunningProvider } from './src/providers/running_provider'; 
// RecommendationScreen은 여기서 불러오지 않습니다!

import { name as appName } from './app.json';

// 최상위 Root 컴포넌트입니다.
const Root = () => (
    <RunningProvider>  
        {/* 모든 Provider 설정은 여기서 끝내고, App 컴포넌트를 표시합니다. */}
        <App /> 
    </RunningProvider>
);

AppRegistry.registerComponent(appName, () => Root);