export const MOCK_RECOMMENDATION_PAYLOAD = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            properties: {
                label: '한강 강변 러닝',
                total_distance: 5200,
                total_time_min: 42,
                slopes: [1.2, 3.5, 6.8, 2.1],
                elevations: [6, 8, 10, 11, 9],
                voice_guides: [
                    { index: 0, message: '출발! 호흡을 길게 가져가세요.' },
                    { index: 2, message: '앞으로 완만한 오르막입니다.' },
                    { index: 4, message: '수고하셨습니다. 쿨다운을 시작해요.' },
                ],
                type: 'normal',
                avg_slope: 3.4,
            },
            geometry: {
                type: 'LineString',
                coordinates: [
                    [126.978, 37.5665],
                    [126.9795, 37.5675],
                    [126.981, 37.568],
                    [126.982, 37.567],
                    [126.983, 37.566],
                ],
            },
        },
        {
            type: 'Feature',
            properties: {
                label: '남산 순환 러닝',
                total_distance: 3600,
                total_time_min: 32,
                slopes: [4.2, 8.4, 5.5, 2.8],
                elevations: [32, 40, 58, 64, 52],
                voice_guides: [
                    { index: 1, message: '오르막 구간입니다. 보폭을 줄여요.' },
                    { index: 3, message: '곧 내리막입니다. 속도를 조절하세요.' },
                ],
                type: 'hard',
                avg_slope: 5.2,
            },
            geometry: {
                type: 'LineString',
                coordinates: [
                    [126.9882, 37.5512],
                    [126.9895, 37.553],
                    [126.991, 37.5545],
                    [126.9925, 37.5558],
                    [126.994, 37.5565],
                ],
            },
        },
    ],
};

export default MOCK_RECOMMENDATION_PAYLOAD;
