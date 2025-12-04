.venv\scripts\activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000 

서버 접속하는 명령어

{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {
            "type": "LineString",
            "coordinates": [
                [
                    0
                ]
            ]
        },
            "properties": {
                "label": "string",
                "total_distance": 0,
                "avg_slope": 0,
                "slopes": [
                    0
                ],
                "elevations": [
                    0
                ],
                "voice_guides": [
                    {
                        "index": 0,
                        "message": "string"
                    }
                ]
            }
        }
    ]
}
