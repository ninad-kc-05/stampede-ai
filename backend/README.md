# Stampede AI Backend

Military-grade SCADA backend for crowd risk detection using YOLO and motion analysis.

## Features

- **YOLO People Detection**: Uses YOLOv8n for real-time person detection
- **Motion Detection**: Computes motion score using frame differencing
- **Risk Fusion**: Advanced risk calculation based on adjusted count and motion
- **Video Overlay**: Draws detection info on frames with military SCADA styling

## Requirements

```
fastapi>=0.104.0
uvicorn>=0.24.0
opencv-python>=4.8.0
ultralytics>=8.0.0
python-multipart>=0.0.6
numpy>=1.24.0
pillow>=10.0.0
```

## Installation

```bash
cd backend
pip install -r requirements.txt
```

## Running the Server

```bash
python main.py
```

The API will be available at `http://localhost:8000`

## API Endpoints

### GET /
System status and version info

### GET /health
Health check endpoint

### POST /analyze
Analyze video frame for crowd detection
- Input: Image file (UploadFile)
- Output: JSON with detection results + annotated frame

### POST /analyze/frame
Simplified single frame analysis
- Input: Image file (UploadFile)
- Output: JSON with detection results

### POST /reset
Reset detection state (clears previous frame buffer)

## Response Format

```json
{
  "people": 25,
  "adjusted": 125,
  "motion": 15.3,
  "risk": "MEDIUM",
  "frame": "<base64_encoded_image>",
  "frame_count": 42
}
```

## Risk Fusion Logic

```python
if adjusted_count > 200 or motion_score > 25:
    risk = "HIGH"
elif adjusted_count > 100:
    risk = "MEDIUM"
else:
    risk = "LOW"
```

Where:
- `adjusted_count = people_count * 5`
- `motion_score = mean(cv2.absdiff(current_frame, previous_frame))`

## Integration with Frontend

Update the frontend to call the backend API:

```javascript
const formData = new FormData();
formData.append('file', videoFrame);

const response = await fetch('http://localhost:8000/analyze/frame', {
  method: 'POST',
  body: formData
});

const data = await response.json();
// Use data.people, data.adjusted, data.motion, data.risk
```