jest.mock('react-native-config', () => ({
  TTS_VOICE: 'ko-KR',
}));

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMapView = (props) => React.createElement(View, props, props.children);
  const MockPolyline = (props) => React.createElement(View, props, props.children);

  return {
    __esModule: true,
    default: MockMapView,
    Polyline: MockPolyline,
  };
});

const mockGeolocation = {
  requestAuthorization: jest.fn(() => Promise.resolve('granted')),
  getCurrentPosition: jest.fn(),
  watchPosition: jest.fn(() => 1),
  clearWatch: jest.fn(),
  stopObserving: jest.fn(),
};

jest.mock('react-native-geolocation-service', () => mockGeolocation);

jest.mock('react-native-tts', () => ({
  voices: jest.fn(() => Promise.resolve([])),
  setDefaultLanguage: jest.fn(() => Promise.resolve()),
  setDefaultRate: jest.fn(() => Promise.resolve()),
  setDefaultPitch: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  speak: jest.fn(() => Promise.resolve()),
}));

// AsyncStorage를 가상의 메모리 저장소로 모킹하여 테스트 시 의존성 문제를 방지
jest.mock(
  '@react-native-async-storage/async-storage',
  () => {
    const store = new Map();
    return {
      setItem: jest.fn((key, value) => Promise.resolve(store.set(key, value))),
      getItem: jest.fn((key) => Promise.resolve(store.get(key) ?? null)),
      removeItem: jest.fn((key) => Promise.resolve(store.delete(key))),
      clear: jest.fn(() => Promise.resolve(store.clear())),
    };
  },
  { virtual: true },
);

// 날짜 선택 모듈이 테스트 환경에 없더라도 기본 함수가 호출되도록 모킹
jest.mock(
  '@react-native-community/datetimepicker',
  () => ({
    DateTimePickerAndroid: { open: jest.fn() },
  }),
  { virtual: true },
);
