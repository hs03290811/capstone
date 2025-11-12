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