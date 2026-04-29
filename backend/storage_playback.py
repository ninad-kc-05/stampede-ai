import json
import threading
import time
import uuid
from pathlib import Path

import cv2
import numpy as np


MOTION_THRESHOLD = 12.0


def _safe_suffix(filename: str | None) -> str:
    suffix = Path(filename or "upload.mp4").suffix.lower()
    return suffix if suffix else ".mp4"


def _density_from_adjusted(adjusted_count: int) -> str:
    if adjusted_count > 200:
        return "HIGH"
    if adjusted_count > 80:
        return "MEDIUM"
    return "LOW"


def _fuse_risk(density: str, movement: str) -> dict:
    if density == "HIGH" and movement == "ABNORMAL":
        return {
            "risk": "HIGH",
            "threat": "CRITICAL",
            "action": "ALERT",
            "stampede_risk": True,
            "trigger_reason": "High density + abnormal movement",
            "status": "critical",
        }
    if density == "HIGH" and movement == "NORMAL":
        return {
            "risk": "MEDIUM",
            "threat": "WATCH",
            "action": "MONITOR",
            "stampede_risk": False,
            "trigger_reason": "Crowded but stable",
            "status": "watch",
        }
    if density == "MEDIUM" and movement == "ABNORMAL":
        return {
            "risk": "MEDIUM",
            "threat": "WARNING",
            "action": "PREPARE",
            "stampede_risk": False,
            "trigger_reason": "Medium density + abnormal movement",
            "status": "warning",
        }
    if density == "LOW" and movement == "ABNORMAL":
        return {
            "risk": "MEDIUM",
            "threat": "CHECK",
            "action": "VERIFY",
            "stampede_risk": False,
            "trigger_reason": "Low density + abnormal movement",
            "status": "check",
        }
    return {
        "risk": "LOW",
        "threat": "NOMINAL",
        "action": "STANDBY",
        "stampede_risk": False,
        "trigger_reason": "Normal density + normal movement",
        "status": "normal",
    }


def _simulate_detections(frame, frame_id: int) -> list[dict]:
    h, w = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    mean = float(gray.mean())
    std = float(gray.std())
    people = int(np.clip(8 + mean / 8 + std / 3 + (frame_id % 12), 3, 72))
    cols = max(1, min(12, int(np.sqrt(people) + 2)))
    rows = max(1, int(np.ceil(people / cols)))
    box_w = max(24, min(70, w // max(8, cols + 3)))
    box_h = max(42, min(120, h // max(6, rows + 2)))
    detections = []

    for idx in range(people):
        col = idx % cols
        row = idx // cols
        x_step = max(1, (w - box_w - 20) // max(1, cols))
        y_step = max(1, (h - box_h - 20) // max(1, rows))
        jitter_x = ((frame_id * 7 + idx * 13) % 17) - 8
        jitter_y = ((frame_id * 5 + idx * 11) % 13) - 6
        x1 = int(np.clip(10 + col * x_step + jitter_x, 0, max(0, w - box_w - 1)))
        y1 = int(np.clip(20 + row * y_step + jitter_y, 0, max(0, h - box_h - 1)))
        detections.append(
            {
                "x1": x1,
                "y1": y1,
                "x2": min(w - 1, x1 + box_w),
                "y2": min(h - 1, y1 + box_h),
                "conf": 0.58 + ((idx + frame_id) % 35) / 100,
            }
        )
    return detections


def _motion_score(frame, previous_gray):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (160, 90))
    if previous_gray is None:
        return 0.0, small
    diff = cv2.absdiff(small, previous_gray)
    return float(np.mean(diff)), small


def _build_metrics(frame, detections, previous_gray, frame_id: int, fps: float, feed_id: int):
    motion, next_gray = _motion_score(frame, previous_gray)
    people = len(detections)
    adjusted_count = int(people * 5)
    density = _density_from_adjusted(adjusted_count)
    movement = "ABNORMAL" if motion >= MOTION_THRESHOLD else "NORMAL"
    fused = _fuse_risk(density, movement)
    timestamp = round((frame_id - 1) / fps, 3) if fps > 0 else 0
    metrics = {
        "people": int(people),
        "adjusted": adjusted_count,
        "adjusted_count": adjusted_count,
        "density_score": adjusted_count,
        "density": density,
        "movement": movement,
        "motion": round(motion, 3),
        "motion_score": round(motion, 3),
        "timestamp": timestamp,
        "time": timestamp,
        "fps": round(float(fps), 3),
        "frame_id": int(frame_id),
        "feed_id": int(feed_id),
        "left_zone": None,
        "right_zone": None,
        **fused,
    }
    return metrics, next_gray


def _draw_processed_frame(frame, detections, metrics):
    render = frame.copy()
    stampede_risk = bool(metrics.get("stampede_risk"))
    risk = metrics.get("risk")
    box_color = (0, 0, 255) if stampede_risk else (0, 180, 255) if risk == "MEDIUM" else (0, 255, 65)

    for det in detections:
        cv2.rectangle(render, (det["x1"], det["y1"]), (det["x2"], det["y2"]), box_color, 2)

    panel_w = min(render.shape[1] - 1, 720)
    cv2.rectangle(render, (0, 0), (panel_w, 112), (0, 0, 0), -1)
    cv2.rectangle(render, (0, 0), (panel_w, 112), box_color, 2)
    lines = [
        f"Feed {metrics.get('feed_id')} | People {metrics.get('people')} | Density {metrics.get('density')}",
        f"Movement {metrics.get('movement')} | Risk {metrics.get('risk')} | Stampede {str(stampede_risk).upper()}",
        f"Action {metrics.get('action')} | {metrics.get('trigger_reason')}",
    ]
    for idx, line in enumerate(lines):
        cv2.putText(render, line, (12, 30 + idx * 32), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (255, 255, 255), 2)

    if stampede_risk:
        h, w = render.shape[:2]
        cv2.rectangle(render, (0, h - 58), (w - 1, h - 1), (0, 0, 180), -1)
        cv2.putText(
            render,
            "STAMPEDE RISK: HIGH DENSITY + ABNORMAL MOVEMENT",
            (18, h - 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.78,
            (255, 255, 255),
            2,
        )
    return render


def _open_writer(path: Path, fps: float, size: tuple[int, int]):
    for codec in ("avc1", "H264", "mp4v"):
        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*codec), fps, size)
        if writer.isOpened():
            return writer, codec
        writer.release()
    return None, None


def _summarize(rows: list[dict]) -> dict:
    if not rows:
        return {
            "avg_people": 0,
            "avg_density": 0,
            "peak_motion": 0,
            "peak_risk": "LOW",
            "stampede_risk_events": 0,
            "high_risk_duration": 0,
        }
    avg_people = sum(row.get("people", 0) for row in rows) / len(rows)
    avg_density = sum(row.get("adjusted_count", row.get("adjusted", 0)) for row in rows) / len(rows)
    peak_motion = max(row.get("motion_score", row.get("motion", 0)) for row in rows)
    stampede_rows = [row for row in rows if row.get("stampede_risk")]
    return {
        "avg_people": round(avg_people, 2),
        "avg_density": round(avg_density, 2),
        "peak_motion": round(float(peak_motion), 3),
        "peak_risk": "HIGH" if any(row.get("risk") == "HIGH" for row in rows) else "MEDIUM" if any(row.get("risk") == "MEDIUM" for row in rows) else "LOW",
        "stampede_risk_events": len(stampede_rows),
        "high_risk_duration": round(len(stampede_rows) / max(1, rows[0].get("fps", 24)), 3),
    }


def _derive_events(rows: list[dict]) -> list[dict]:
    events = []
    previous_stampede = False
    for row in rows:
        stampede = bool(row.get("stampede_risk"))
        if stampede and not previous_stampede:
            events.append(
                {
                    "time": row.get("timestamp", row.get("time", 0)),
                    "type": "STAMPEDE_RISK",
                    "severity": "CRITICAL",
                    "message": "Stampede risk detected: High density + abnormal movement.",
                }
            )
        previous_stampede = stampede
    return events[-20:]


def _derive_insight(summary: dict, feed_id: int) -> str:
    if summary.get("stampede_risk_events", 0) > 0:
        return f"Feed {feed_id} showed stampede-risk condition due to high density and abnormal movement."
    if summary.get("avg_density", 0) > 200:
        return "Crowd remained dense but stable. Continue monitoring."
    if summary.get("peak_motion", 0) > MOTION_THRESHOLD:
        return "Unusual movement detected. Verify ground conditions."
    return "Crowd conditions stable."


class StoragePlaybackService:
    def __init__(self, storage_dir: Path, public_prefix: str = "/storage"):
        self.storage_dir = Path(storage_dir)
        self.public_prefix = public_prefix.rstrip("/")
        self.jobs = {}
        self.lock = threading.RLock()
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def public_url(self, video_id: str, filename: str) -> str:
        return f"{self.public_prefix}/{video_id}/{filename}"

    def update_job(self, video_id: str, **updates) -> dict:
        with self.lock:
            job = self.jobs.setdefault(video_id, {"video_id": video_id})
            job.update(updates)
            return dict(job)

    def get_job(self, video_id: str) -> dict | None:
        with self.lock:
            job = self.jobs.get(video_id)
            if job:
                return dict(job)

        output_dir = self.storage_dir / video_id
        processed_path = output_dir / "processed.mp4"
        analytics_path = output_dir / "analytics.json"
        if processed_path.exists() and analytics_path.exists():
            return {
                "video_id": video_id,
                "status": "done",
                "progress": 100,
                "message": "Processing complete",
                "video_url": self.public_url(video_id, "processed.mp4"),
                "analytics_url": self.public_url(video_id, "analytics.json"),
            }
        return None

    def save_upload(self, filename: str | None, data: bytes, feed_id: int) -> tuple[str, Path]:
        video_id = uuid.uuid4().hex
        output_dir = self.storage_dir / video_id
        output_dir.mkdir(parents=True, exist_ok=True)
        source_path = output_dir / f"source{_safe_suffix(filename)}"
        source_path.write_bytes(data)
        self.update_job(
            video_id,
            feed_id=int(feed_id),
            status="processing",
            progress=0,
            message="Upload saved. Processing started.",
            video_url=None,
            analytics_url=None,
        )
        return video_id, source_path

    def _fail(self, video_id: str, feed_id: int, message: str, on_error=None):
        self.update_job(video_id, status="error", progress=0, message=message)
        if on_error:
            on_error(feed_id=feed_id, message=message)

    def process_video(self, video_id: str, input_path: str, feed_id: int, on_progress=None, on_complete=None, on_error=None):
        output_dir = self.storage_dir / video_id
        output_dir.mkdir(parents=True, exist_ok=True)
        processed_path = output_dir / "processed.mp4"
        analytics_path = output_dir / "analytics.json"
        self.update_job(video_id, status="processing", progress=1, message="Opening uploaded video")

        cap = cv2.VideoCapture(str(input_path))
        if not cap.isOpened():
            self._fail(video_id, feed_id, "Unable to open uploaded video", on_error)
            return

        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0) or 24.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if width <= 0 or height <= 0:
            cap.release()
            self._fail(video_id, feed_id, "Invalid video dimensions", on_error)
            return

        writer, codec = _open_writer(processed_path, fps, (width, height))
        if writer is None:
            cap.release()
            self._fail(video_id, feed_id, "Unable to create processed video", on_error)
            return

        analytics_rows = []
        previous_gray = None
        frame_id = 0
        started = time.time()

        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                frame_id += 1
                detections = _simulate_detections(frame, frame_id)
                metrics, previous_gray = _build_metrics(frame, detections, previous_gray, frame_id, fps, feed_id)
                writer.write(_draw_processed_frame(frame, detections, metrics))

                row = {
                    **metrics,
                    "boxes": [
                        {
                            "x": det["x1"],
                            "y": det["y1"],
                            "width": det["x2"] - det["x1"],
                            "height": det["y2"] - det["y1"],
                            "confidence": round(float(det["conf"]), 3),
                        }
                        for det in detections
                    ],
                }
                analytics_rows.append(row)

                if frame_id == 1 or frame_id % 10 == 0:
                    progress = int((frame_id / max(1, total_frames)) * 100) if total_frames else min(99, frame_id % 100)
                    progress = max(1, min(99, progress))
                    self.update_job(video_id, progress=progress, message=f"Processing frame {frame_id}")
                    if on_progress:
                        on_progress(
                            feed_id=feed_id,
                            frame_id=frame_id,
                            total_frames=total_frames or frame_id,
                            progress=progress,
                            metrics=metrics,
                            message=f"Storage processing frame {frame_id}",
                        )
        finally:
            cap.release()
            writer.release()

        if frame_id <= 0:
            self._fail(video_id, feed_id, "No frames were processed", on_error)
            return

        summary = _summarize(analytics_rows)
        payload = {
            "video_id": video_id,
            "feed_id": feed_id,
            "fps": fps,
            "frame_count": frame_id,
            "duration": round(frame_id / fps, 3),
            "processing_seconds": round(time.time() - started, 3),
            "codec": codec,
            "processed_video": self.public_url(video_id, "processed.mp4"),
            "frames": analytics_rows,
            "summary": summary,
            "events": _derive_events(analytics_rows),
            "insight": _derive_insight(summary, feed_id),
        }
        analytics_path.write_text(json.dumps(payload), encoding="utf-8")

        latest_metrics = analytics_rows[-1]
        self.update_job(
            video_id,
            status="done",
            progress=100,
            message="Processing complete",
            video_url=self.public_url(video_id, "processed.mp4"),
            analytics_url=self.public_url(video_id, "analytics.json"),
            frame_count=frame_id,
            fps=fps,
            duration=round(frame_id / fps, 3),
            codec=codec,
        )
        if on_complete:
            on_complete(
                feed_id=feed_id,
                video_id=video_id,
                frame_count=frame_id,
                total_frames=total_frames or frame_id,
                latest_metrics=latest_metrics,
                analytics_history=analytics_rows,
                message="Storage processing complete",
            )
