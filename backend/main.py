"""
Stampede AI - Backend API
Dual-mode processing backend:
1) prototype_buffered
2) continuous_monitoring
"""

import base64
import asyncio
import logging
import os
import threading
import time
import uuid
from collections import deque
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import torch
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from ultralytics import YOLO

try:
    from .storage_playback import StoragePlaybackService
except ImportError:
    from storage_playback import StoragePlaybackService

app = FastAPI(title="Stampede AI - Crowd Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Performance / detection settings
YOLO_IMAGE_SIZE = 960
YOLO_CONFIDENCE = 0.15
YOLO_IOU = 0.4
MOTION_THRESHOLD = 12.0
MAX_PROCESS_WIDTH = 960
TARGET_FPS = 12
FRAME_SKIP = 2
JPEG_QUALITY = 70
MAX_HISTORY = 60
MAX_FEEDS = 6

MODE_PROTOTYPE = "prototype_buffered"
MODE_CONTINUOUS = "continuous_monitoring"
# Legacy-only path retained for backward compatibility; frontend no longer uses it.
MODE_STORAGE = "storage_playback"
DELETE_PIN = "1234"

STATE_IDLE = "IDLE"
STATE_UPLOADED = "UPLOADED"
STATE_PROCESSING = "PROCESSING"
STATE_READY = "READY"
STATE_LOOPING = "LOOPING"
STATE_RUNNING = "RUNNING"
STATE_STOPPED = "STOPPED"
STATE_ERROR = "ERROR"

APP_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = APP_DIR / "uploads"
STORAGE_DIR = APP_DIR / "storage"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
storage_service = StoragePlaybackService(STORAGE_DIR)
app.mount("/storage", StaticFiles(directory=str(STORAGE_DIR)), name="storage")

model_lock = threading.Lock()
feed_lock = threading.RLock()
state_lock = feed_lock
yolo_processing_lock = threading.Lock()
processing_queue = deque()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("stampede-ai")

yolo_model = None
inference_device = "cpu"
inference_half = False

heatmap_enabled = True
debug_boxes_enabled = True
debug_telemetry_enabled = True
active_feed_id = 1


def default_metrics(feed_id: int = 1):
    return {
        "people": None,
        "adjusted": None,
        "adjusted_count": None,
        "density_score": None,
        "density": None,
        "movement": None,
        "risk": None,
        "threat": "STANDBY",
        "action": "WAITING",
        "stampede_risk": False,
        "trigger_reason": "Awaiting detection",
        "timestamp": 0,
        "fps": 0,
        "frame_id": 0,
        "status": "idle",
        "left_zone": None,
        "right_zone": None,
        "motion": None,
        "motion_score": None,
        "feed_id": feed_id,
    }


def create_feed_state(feed_id: int):
    return {
        "feed_id": feed_id,
        "lock": threading.RLock(),
        "video_path": None,
        "video_id": None,
        "status": STATE_IDLE,
        "mode": MODE_PROTOTYPE,
        "processed_packets": [],
        "current_index": 0,
        "analytics_history": [],
        "metrics": default_metrics(feed_id),
        "processing_thread": None,
        "playback_thread": None,
        "stop_event": threading.Event(),
        "progress": 0,
        "message": "Awaiting video upload",
        "total_frames": 0,
        "processed_frames": 0,
        "latest_packet": None,
        "clean_frame_bytes": None,
        "debug_frame_bytes": None,
        "queued_for_processing": False,
        "generation": 0,
    }


feeds = {fid: create_feed_state(fid) for fid in range(1, MAX_FEEDS + 1)}


def _loop_exception_handler(loop, context):
    """Suppress benign Windows socket-reset noise during server shutdown."""
    exc = context.get("exception")
    if isinstance(exc, ConnectionResetError):
        return
    loop.default_exception_handler(context)


@app.on_event("startup")
async def configure_loop_exception_handler():
    try:
        loop = asyncio.get_running_loop()
        loop.set_exception_handler(_loop_exception_handler)
    except RuntimeError:
        pass


def ensure_feed(feed_id: int):
    fid = max(1, int(feed_id))
    with state_lock:
        if fid not in feeds:
            feeds[fid] = create_feed_state(fid)
        return feeds[fid]


def clear_uploads_folder():
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    for item in UPLOAD_DIR.iterdir():
        if item.is_file():
            try:
                item.unlink()
            except OSError:
                pass


def reset_feed_runtime(feed_id: int, keep_video: bool = True):
    feed = ensure_feed(feed_id)
    with state_lock:
        existing_video = feed["video_path"] if keep_video else None
        existing_mode = feed["mode"]
        existing_lock = feed.get("lock") or threading.RLock()
        next_generation = int(feed.get("generation", 0)) + 1
        next_state = create_feed_state(feed_id)
        next_state["lock"] = existing_lock
        feed.update(next_state)
        feed["mode"] = existing_mode
        feed["video_path"] = existing_video
        feed["generation"] = next_generation
        if existing_video:
            feed["status"] = STATE_UPLOADED
            feed["message"] = "Video uploaded"
    return feed


def load_model():
    global yolo_model, inference_device, inference_half
    with model_lock:
        if yolo_model is None:
            yolo_model = YOLO("yolov8n.pt")
            if torch.cuda.is_available():
                inference_device = "cuda:0"
                inference_half = True
            else:
                inference_device = "cpu"
                inference_half = False
    return yolo_model


def preprocess_for_inference(frame):
    h, w = frame.shape[:2]
    if w <= MAX_PROCESS_WIDTH:
        return frame, 1.0
    ratio = MAX_PROCESS_WIDTH / float(w)
    resized = cv2.resize(frame, (MAX_PROCESS_WIDTH, int(h * ratio)))
    return resized, ratio


def detect_people(frame):
    model = load_model()
    infer_frame, ratio = preprocess_for_inference(frame)
    results = model(
        infer_frame,
        imgsz=YOLO_IMAGE_SIZE,
        conf=YOLO_CONFIDENCE,
        iou=YOLO_IOU,
        classes=[0],
        device=inference_device,
        half=inference_half,
        verbose=False,
    )
    detections = []
    if not results:
        return detections
    inv_ratio = 1.0 / ratio
    for box in results[0].boxes:
        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
        detections.append(
            {
                "x1": int(x1 * inv_ratio),
                "y1": int(y1 * inv_ratio),
                "x2": int(x2 * inv_ratio),
                "y2": int(y2 * inv_ratio),
                "conf": float(box.conf[0].cpu().numpy()),
            }
        )
    return detections


def crowd_multiplier(people_total):
    if people_total < 20:
        return 3
    if people_total < 40:
        return 4
    return 5


def get_density(adjusted):
    if adjusted is None:
        return None
    if adjusted > 200:
        return "HIGH"
    if adjusted > 80:
        return "MEDIUM"
    return "LOW"


def fuse_risk(density, movement):
    if density == "HIGH" and movement == "ABNORMAL":
        return "HIGH", "CRITICAL", "ALERT", True, "High density + abnormal movement", "STAMPEDE RISK DETECTED"
    if density == "HIGH" and movement == "NORMAL":
        return "MEDIUM", "WATCH", "MONITOR", False, "High density + normal movement", "CROWDED BUT STABLE"
    if density == "MEDIUM" and movement == "ABNORMAL":
        return "MEDIUM", "WARNING", "PREPARE", False, "Medium density + abnormal movement", "MOVEMENT WARNING"
    if density == "LOW" and movement == "ABNORMAL":
        return "MEDIUM", "CHECK", "VERIFY", False, "Low density + abnormal movement", "UNUSUAL MOVEMENT"
    return "LOW", "NOMINAL", "STANDBY", False, "Density and movement stable", "NORMAL"


def calculate_metrics(frame, detections, prev_frame, current_fps, feed_id: int):
    h, w = frame.shape[:2]
    center_x = w // 2

    people = len(detections)
    left = 0
    right = 0
    for det in detections:
        cx = (det["x1"] + det["x2"]) // 2
        if cx < center_x:
            left += 1
        else:
            right += 1

    adjusted = people * crowd_multiplier(people)
    density = get_density(adjusted)
    if prev_frame is None:
        motion_score = 0.0
    else:
        prev = prev_frame
        if prev.shape != frame.shape:
            prev = cv2.resize(prev, (frame.shape[1], frame.shape[0]))
        motion_score = float(cv2.absdiff(prev, frame).mean())
    movement = "ABNORMAL" if motion_score > MOTION_THRESHOLD else "NORMAL"
    risk, threat, action, stampede_risk, trigger_reason, status_text = fuse_risk(density, movement)

    return (
        {
            "people": people,
            "adjusted": adjusted,
            "adjusted_count": adjusted,
            "density_score": adjusted,
            "density": density,
            "movement": movement,
            "risk": risk,
            "threat": threat,
            "action": action,
            "stampede_risk": stampede_risk,
            "trigger_reason": trigger_reason,
            "timestamp": datetime.now().isoformat(timespec="milliseconds"),
            "fps": round(float(current_fps), 2),
            "frame_id": 0,
            "status": status_text,
            "left_zone": left,
            "right_zone": right,
            "motion": round(float(motion_score), 3),
            "motion_score": round(float(motion_score), 3),
            "feed_id": feed_id,
        },
        frame.copy(),
    )


def draw_clean_frame(frame, metrics):
    return frame.copy()


def apply_heatmap(frame, detections, grid_size=8, alpha=0.3):
    if not detections:
        return frame
    h, w = frame.shape[:2]
    cell_h = max(1, h // grid_size)
    cell_w = max(1, w // grid_size)
    grid = np.zeros((grid_size, grid_size), dtype=np.int32)
    for det in detections:
        cx = int((det["x1"] + det["x2"]) / 2)
        cy = int((det["y1"] + det["y2"]) / 2)
        gx = min(grid_size - 1, max(0, cx // cell_w))
        gy = min(grid_size - 1, max(0, cy // cell_h))
        grid[gy, gx] += 1

    overlay = frame.copy()
    for gy in range(grid_size):
        for gx in range(grid_size):
            count = int(grid[gy, gx])
            if count <= 0:
                continue
            x1 = gx * cell_w
            y1 = gy * cell_h
            x2 = w if gx == grid_size - 1 else (gx + 1) * cell_w
            y2 = h if gy == grid_size - 1 else (gy + 1) * cell_h
            if count >= 3:
                color = (0, 0, 255)
            elif count >= 2:
                color = (0, 180, 255)
            else:
                color = (0, 255, 65)
            cv2.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
    return cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)


def draw_debug_frame(frame, detections, metrics, show_boxes=None, show_telemetry=None):
    render = frame.copy()
    h, w = render.shape[:2]
    center_x = w // 2

    if show_boxes is None:
        show_boxes = debug_boxes_enabled
    if show_telemetry is None:
        show_telemetry = debug_telemetry_enabled

    if show_boxes:
        for det in detections:
            x1, y1, x2, y2 = det["x1"], det["y1"], det["x2"], det["y2"]
            box_color = (255, 255, 0)
            cv2.rectangle(render, (x1, y1), (x2, y2), box_color, 3)
            label = f"Person {det['conf']:.2f}"
            (label_w, label_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.56, 2)
            ly1 = max(0, y1 - label_h - 10)
            ly2 = min(h - 1, ly1 + label_h + 8)
            lx1 = x1
            lx2 = min(w - 1, lx1 + label_w + 8)
            cv2.rectangle(render, (lx1, ly1), (lx2, ly2), (0, 0, 0), -1)
            cv2.rectangle(render, (lx1, ly1), (lx2, ly2), box_color, 2)
            cv2.putText(render, label, (lx1 + 4, ly2 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.56, (0, 255, 65), 2)

    if show_telemetry:
        cv2.line(render, (center_x, 0), (center_x, h), (255, 255, 255), 2)
        cv2.rectangle(render, (0, 0), (620, 365), (0, 0, 0), -1)
        cv2.rectangle(render, (0, 0), (620, 365), (0, 255, 65), 2)
        lines = [
            f"People: {metrics['people']}",
            f"Adjusted: {metrics['adjusted']}",
            f"Density: {metrics['density']}",
            f"Motion Score: {metrics['motion']}",
            f"Movement: {metrics['movement']}",
            f"Risk: {metrics['risk']}",
            f"Stampede Risk: {str(metrics.get('stampede_risk', False)).upper()}",
            f"Trigger: {metrics.get('trigger_reason', '--')}",
            f"FPS: {metrics['fps']}",
            f"Time: {str(metrics['timestamp']).split('T')[-1]}",
            f"Frame: {metrics['frame_id']}",
        ]
        y = 30
        for text in lines:
            color = (0, 255, 65)
            if metrics.get("stampede_risk") and (text.startswith("Risk:") or text.startswith("Stampede")):
                color = (0, 0, 255)
            elif text.startswith("Risk:") and metrics["risk"] == "MEDIUM":
                color = (0, 165, 255)
            cv2.putText(render, text, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.56, color, 2)
            y += 27
        if metrics.get("stampede_risk"):
            banner_y = min(h - 35, 405)
            cv2.rectangle(render, (0, banner_y - 34), (min(w - 1, 760), banner_y + 10), (0, 0, 180), -1)
            cv2.putText(
                render,
                "STAMPEDE RISK: HIGH DENSITY + ABNORMAL MOTION",
                (12, banner_y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.72,
                (255, 255, 255),
                2,
            )
    return render


def encode_frame(frame):
    if frame is None:
        logger.error("Frame encoding skipped: frame is None")
        return None
    if not isinstance(frame, np.ndarray) or frame.size == 0:
        logger.error("Frame encoding skipped: invalid frame object")
        return None
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok or buffer is None:
        logger.error("Frame encoding failed: cv2.imencode returned no buffer")
        return None
    frame_bytes = buffer.tobytes()
    if len(frame_bytes) == 0:
        logger.error("Frame encoding failed: encoded JPEG is empty")
        return None
    return frame_bytes


def valid_jpeg_bytes(frame_bytes):
    return isinstance(frame_bytes, (bytes, bytearray)) and len(frame_bytes) > 0


def packet_has_valid_frames(packet):
    if not packet:
        return False
    return valid_jpeg_bytes(packet.get("clean_frame_jpeg")) and valid_jpeg_bytes(packet.get("debug_frame_jpeg"))


def update_analytics(feed_id: int, metrics):
    feed = ensure_feed(feed_id)
    row = {
        "frame_id": metrics["frame_id"],
        "time": metrics["timestamp"],
        "people": metrics["people"],
        "adjusted": metrics["adjusted"],
        "density_score": metrics["adjusted"],
        "motion": metrics["motion"],
        "motion_score": metrics["motion"],
        "density": metrics["density"],
        "movement": metrics["movement"],
        "risk": metrics["risk"],
        "risk_score": 2 if metrics["risk"] == "HIGH" else 1 if metrics["risk"] == "MEDIUM" else 0,
        "threat": metrics["threat"],
        "action": metrics["action"],
        "stampede_risk": metrics.get("stampede_risk", False),
        "trigger_reason": metrics.get("trigger_reason", ""),
        "feed_id": metrics.get("feed_id", feed_id),
    }
    with state_lock:
        feed["analytics_history"].append(row)
        if len(feed["analytics_history"]) > MAX_HISTORY:
            feed["analytics_history"] = feed["analytics_history"][-MAX_HISTORY:]


def update_feed_status(feed_id: int, state=None, progress=None, message=None):
    feed = ensure_feed(feed_id)
    with state_lock:
        if state is not None:
            feed["status"] = state
        if progress is not None:
            feed["progress"] = int(max(0, min(100, progress)))
        if message is not None:
            feed["message"] = message


def is_yolo_busy(exclude_feed_id: int | None = None):
    with state_lock:
        for fid, feed in feeds.items():
            if exclude_feed_id is not None and fid == exclude_feed_id:
                continue
            if feed["status"] in (STATE_PROCESSING, STATE_RUNNING):
                return True
    return False


def stop_feed_runtime(feed_id: int):
    feed = ensure_feed(feed_id)
    with state_lock:
        try:
            processing_queue.remove(feed_id)
        except ValueError:
            pass
        feed["queued_for_processing"] = False
    with state_lock:
        feed["stop_event"].set()
        p_thread = feed["processing_thread"]
        l_thread = feed["playback_thread"]
    if p_thread and p_thread.is_alive():
        p_thread.join(timeout=1.0)
    if l_thread and l_thread.is_alive():
        l_thread.join(timeout=1.0)
    with state_lock:
        feed["processing_thread"] = None
        feed["playback_thread"] = None
        feed["stop_event"] = threading.Event()


def safe_remove_file(path: str | Path | None) -> bool:
    if not path:
        return False
    try:
        file_path = Path(path).resolve()
        allowed_roots = (UPLOAD_DIR.resolve(), STORAGE_DIR.resolve())
        if not any(file_path == root or root in file_path.parents for root in allowed_roots):
            logger.warning("[DELETE] Skipped unsafe path path=%s", file_path)
            return False
        if file_path.is_file():
            os.remove(file_path)
            return True
    except OSError as exc:
        logger.warning("[DELETE] Could not remove path=%s error=%s", path, exc)
    return False


def delete_storage_artifacts(video_id: str) -> int:
    removed = 0
    output_dir = (STORAGE_DIR / video_id).resolve()
    storage_root = STORAGE_DIR.resolve()
    if not (output_dir == storage_root or storage_root in output_dir.parents):
        logger.warning("[DELETE] Skipped unsafe storage path video_id=%s path=%s", video_id, output_dir)
        return removed
    if output_dir.exists():
        for item in sorted(output_dir.rglob("*"), key=lambda p: len(p.parts), reverse=True):
            if item.is_file() and safe_remove_file(item):
                removed += 1
            elif item.is_dir():
                try:
                    item.rmdir()
                except OSError:
                    pass
        try:
            output_dir.rmdir()
        except OSError:
            pass
    with storage_service.lock:
        storage_service.jobs.pop(video_id, None)
    return removed


def reset_deleted_feed(feed_id: int):
    feed = reset_feed_runtime(feed_id, keep_video=False)
    with feed["lock"]:
        feed["status"] = STATE_IDLE
        feed["message"] = "Video deleted"
        feed["video_id"] = None
        feed["video_path"] = None
        feed["progress"] = 0
        feed["metrics"] = default_metrics(feed_id)
        feed["processed_packets"] = []
        feed["analytics_history"] = []
        feed["processed_frames"] = 0
        feed["total_frames"] = 0


def find_feed_by_video_id(video_id: str):
    with state_lock:
        for fid, feed in feeds.items():
            if str(feed.get("video_id") or "") == str(video_id):
                return fid
    return None


def queue_feed_for_processing(feed_id: int):
    feed = ensure_feed(feed_id)
    with state_lock:
        if feed_id not in processing_queue:
            processing_queue.append(feed_id)
        feed["queued_for_processing"] = True
        feed["status"] = STATE_UPLOADED
        feed["progress"] = 0
        feed["message"] = "Queued for processing. Waiting for active feed."


def maybe_start_next_queued_feed():
    with state_lock:
        if yolo_processing_lock.locked():
            return
        next_feed_id = None
        while processing_queue:
            candidate = processing_queue.popleft()
            cfeed = ensure_feed(candidate)
            if not cfeed["video_path"] or not os.path.exists(cfeed["video_path"]):
                cfeed["queued_for_processing"] = False
                continue
            if cfeed["mode"] != MODE_PROTOTYPE:
                cfeed["queued_for_processing"] = False
                continue
            if cfeed["status"] in (STATE_PROCESSING, STATE_RUNNING, STATE_LOOPING):
                continue
            next_feed_id = candidate
            cfeed["queued_for_processing"] = False
            cfeed["stop_event"] = threading.Event()
            cfeed["status"] = STATE_PROCESSING
            cfeed["progress"] = 0
            cfeed["message"] = "Processing uploaded video"
            break
        if next_feed_id is None:
            return

    proc_thread = threading.Thread(target=process_prototype_buffered, args=(next_feed_id,), daemon=True)
    with state_lock:
        feed = ensure_feed(next_feed_id)
        feed["processing_thread"] = proc_thread
    proc_thread.start()


def create_packet(frame_id: int, metrics, clean_bytes: bytes, debug_bytes: bytes):
    return {
        "frame_id": frame_id,
        "timestamp": metrics["timestamp"],
        "clean_frame_jpeg": clean_bytes,
        "debug_frame_jpeg": debug_bytes,
        "metrics": metrics,
    }


def advance_prototype_packet(feed_id: int):
    feed = ensure_feed(feed_id)
    with feed["lock"]:
        packets = feed["processed_packets"]
        if not packets:
            feed["status"] = STATE_STOPPED
            feed["message"] = f"No processed frames available for Feed {feed_id}"
            return None
        idx = min(max(0, int(feed["current_index"])), len(packets) - 1)
        packet = packets[idx]
        if not packet_has_valid_frames(packet):
            logger.error("Feed %s has invalid packet at index %s", feed_id, idx)
            return None
        feed["latest_packet"] = packet
        feed["metrics"] = packet["metrics"]
        feed["clean_frame_bytes"] = packet["clean_frame_jpeg"]
        feed["debug_frame_bytes"] = packet["debug_frame_jpeg"]
        feed["current_index"] = (idx + 1) % len(packets)
        return packet


def process_prototype_buffered(feed_id: int):
    feed = ensure_feed(feed_id)
    with feed["lock"]:
        video_path = feed["video_path"]
        video_id = feed.get("video_id") or f"feed-{feed_id}"
        stop_event = feed["stop_event"]
        generation = feed["generation"]
        feed["processed_packets"] = []
        feed["analytics_history"] = []
        feed["processed_frames"] = 0
        feed["total_frames"] = 0
        feed["current_index"] = 0
        feed["latest_packet"] = None
        feed["clean_frame_bytes"] = None
        feed["debug_frame_bytes"] = None
        feed["metrics"] = default_metrics(feed_id)
        feed["metrics"]["feed_id"] = feed_id
    if not video_path or not os.path.exists(video_path):
        update_feed_status(feed_id, state=STATE_STOPPED, progress=0, message="Video file not found")
        with state_lock:
            if feed["generation"] == generation:
                feed["processing_thread"] = None
        return

    acquired = yolo_processing_lock.acquire(blocking=False)
    if not acquired:
        update_feed_status(feed_id, state=STATE_STOPPED, progress=0, message="Another feed is currently processing. Please wait.")
        with state_lock:
            if feed["generation"] == generation:
                feed["processing_thread"] = None
        return

    try:
        update_feed_status(feed_id, state=STATE_PROCESSING, progress=0, message="Processing uploaded video")
        logger.info("[PROCESSING STARTED] video_id=%s feed_id=%s", video_id, feed_id)
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            update_feed_status(feed_id, state=STATE_STOPPED, progress=0, message="Unable to open video source")
            return
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        with state_lock:
            feed["total_frames"] = total_frames

        frame_counter = 0
        packet_counter = 0
        cached_detections = []
        prev_motion_frame = None
        fps_times = deque(maxlen=60)
        packet_list = []

        while not stop_event.is_set():
            ok, frame = cap.read()
            if not ok:
                break
            frame_counter += 1
            if frame_counter % FRAME_SKIP == 0 or not cached_detections:
                cached_detections = detect_people(frame)

            now = time.time()
            fps_times.append(now)
            current_fps = 0.0
            if len(fps_times) >= 2:
                elapsed = fps_times[-1] - fps_times[0]
                if elapsed > 0:
                    current_fps = (len(fps_times) - 1) / elapsed

            metrics, prev_motion_frame = calculate_metrics(frame, cached_detections, prev_motion_frame, current_fps, feed_id)
            packet_counter += 1
            metrics["frame_id"] = packet_counter

            clean_frame = draw_clean_frame(frame, metrics)
            # In prototype-buffered mode, cache a full debug copy (heatmap + boxes + telemetry)
            # so playback stays perfectly synced with analytics without re-running YOLO.
            debug_frame = apply_heatmap(frame.copy(), cached_detections, grid_size=8, alpha=0.3)
            debug_frame = draw_debug_frame(debug_frame, cached_detections, metrics, show_boxes=True, show_telemetry=True)

            clean_bytes = encode_frame(clean_frame)
            debug_bytes = encode_frame(debug_frame)
            if not valid_jpeg_bytes(clean_bytes) or not valid_jpeg_bytes(debug_bytes):
                logger.error("Skipping Feed %s frame %s: invalid encoded JPEG bytes", feed_id, frame_counter)
                continue

            packet = create_packet(packet_counter, metrics, clean_bytes, debug_bytes)
            if not packet_has_valid_frames(packet):
                logger.error("Skipping Feed %s frame %s: packet frame validation failed", feed_id, frame_counter)
                continue
            with feed["lock"]:
                if feed["generation"] != generation:
                    cap.release()
                    return
            packet_list.append(packet)
            update_analytics(feed_id, metrics)

            progress = int((frame_counter / max(1, total_frames)) * 100) if total_frames > 0 else min(99, frame_counter % 100)
            with feed["lock"]:
                if feed["generation"] != generation:
                    cap.release()
                    return
                feed["processed_frames"] = frame_counter
                feed["progress"] = min(99, progress)
                feed["message"] = f"Processing frame {frame_counter} / {total_frames if total_frames > 0 else '?'}"

        cap.release()
        if stop_event.is_set():
            with feed["lock"]:
                same_generation = feed["generation"] == generation
            if same_generation:
                update_feed_status(feed_id, state=STATE_STOPPED, message="Feed stopped")
            return

        with feed["lock"]:
            if feed["generation"] != generation:
                return
            feed["processed_packets"] = packet_list
            feed["current_index"] = 0
            feed["processed_frames"] = frame_counter
            feed["total_frames"] = frame_counter if total_frames <= 0 else total_frames
            if packet_list:
                feed["latest_packet"] = packet_list[0]
                feed["metrics"] = packet_list[0]["metrics"]
                feed["clean_frame_bytes"] = packet_list[0]["clean_frame_jpeg"]
                feed["debug_frame_bytes"] = packet_list[0]["debug_frame_jpeg"]
                feed["status"] = STATE_READY
                feed["progress"] = 100
                feed["message"] = "Processing complete"
                logger.info("[PROCESSING DONE] video_id=%s feed_id=%s", video_id, feed_id)
            else:
                feed["status"] = STATE_ERROR
                feed["progress"] = 0
                feed["message"] = "No frames were processed"
    finally:
        with feed["lock"]:
            if feed["generation"] == generation:
                feed["processing_thread"] = None
        yolo_processing_lock.release()
        maybe_start_next_queued_feed()


def prototype_playback_loop(feed_id: int):
    feed = ensure_feed(feed_id)
    with feed["lock"]:
        stop_event = feed["stop_event"]
    update_feed_status(feed_id, state=STATE_LOOPING, progress=100, message="Looping synced processed output")
    interval = 1.0 / max(1.0, TARGET_FPS)

    while not stop_event.is_set():
        if advance_prototype_packet(feed_id) is None:
            break
        time.sleep(interval)

    with feed["lock"]:
        if feed["status"] == STATE_LOOPING:
            feed["status"] = STATE_STOPPED
            feed["message"] = "Feed stopped"
        feed["playback_thread"] = None


def process_continuous_monitoring(feed_id: int):
    feed = ensure_feed(feed_id)
    with feed["lock"]:
        video_path = feed["video_path"]
        video_id = feed.get("video_id") or f"feed-{feed_id}"
        stop_event = feed["stop_event"]
        generation = feed["generation"]
        feed["latest_packet"] = None
        feed["clean_frame_bytes"] = None
        feed["debug_frame_bytes"] = None
        feed["processed_frames"] = 0
        feed["current_index"] = 0
        feed["processed_packets"] = []
        feed["analytics_history"] = []
        feed["metrics"] = default_metrics(feed_id)
        feed["metrics"]["feed_id"] = feed_id
    if not video_path or not os.path.exists(video_path):
        update_feed_status(feed_id, state=STATE_STOPPED, progress=0, message="Video file not found")
        with state_lock:
            if feed["generation"] == generation:
                feed["processing_thread"] = None
        return

    acquired = yolo_processing_lock.acquire(blocking=False)
    if not acquired:
        update_feed_status(feed_id, state=STATE_STOPPED, progress=0, message="Another feed is currently processing. Please wait.")
        with state_lock:
            if feed["generation"] == generation:
                feed["processing_thread"] = None
        return

    try:
        update_feed_status(feed_id, state=STATE_RUNNING, progress=100, message="Continuous monitoring active")
        logger.info("[PROCESSING STARTED] video_id=%s feed_id=%s", video_id, feed_id)
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            update_feed_status(feed_id, state=STATE_STOPPED, progress=0, message="Unable to open video source")
            return

        frame_counter = 0
        packet_counter = 0
        cached_detections = []
        prev_motion_frame = None
        fps_times = deque(maxlen=60)
        process_interval = 1.0 / max(1.0, TARGET_FPS)

        while not stop_event.is_set():
            tick = time.perf_counter()
            ok, frame = cap.read()
            if not ok:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                cached_detections = []
                prev_motion_frame = None
                continue
            frame_counter += 1
            if frame_counter % FRAME_SKIP == 0 or not cached_detections:
                cached_detections = detect_people(frame)

            now = time.time()
            fps_times.append(now)
            current_fps = 0.0
            if len(fps_times) >= 2:
                elapsed = fps_times[-1] - fps_times[0]
                if elapsed > 0:
                    current_fps = (len(fps_times) - 1) / elapsed

            metrics, prev_motion_frame = calculate_metrics(frame, cached_detections, prev_motion_frame, current_fps, feed_id)
            packet_counter += 1
            metrics["frame_id"] = packet_counter

            clean_frame = draw_clean_frame(frame, metrics)
            debug_frame = frame.copy()
            debug_frame = apply_heatmap(debug_frame, cached_detections, grid_size=8, alpha=0.3)
            debug_frame = draw_debug_frame(
                debug_frame,
                cached_detections,
                metrics,
                show_boxes=debug_boxes_enabled,
                show_telemetry=debug_telemetry_enabled,
            )

            clean_bytes = encode_frame(clean_frame)
            debug_bytes = encode_frame(debug_frame)
            if not valid_jpeg_bytes(clean_bytes) or not valid_jpeg_bytes(debug_bytes):
                logger.error("Skipping Feed %s continuous frame %s: invalid encoded JPEG bytes", feed_id, frame_counter)
                continue

            packet = create_packet(packet_counter, metrics, clean_bytes, debug_bytes)
            if not packet_has_valid_frames(packet):
                logger.error("Skipping Feed %s continuous frame %s: packet frame validation failed", feed_id, frame_counter)
                continue
            with feed["lock"]:
                if feed["generation"] != generation:
                    break
                feed["latest_packet"] = packet
                feed["clean_frame_bytes"] = clean_bytes
                feed["debug_frame_bytes"] = debug_bytes
                feed["metrics"] = metrics
                feed["processed_frames"] = frame_counter
                feed["current_index"] = packet_counter
                feed["message"] = "Continuous monitoring active"
                feed["status"] = STATE_RUNNING
                feed["progress"] = 100
            update_analytics(feed_id, metrics)

            elapsed = time.perf_counter() - tick
            if elapsed < process_interval:
                time.sleep(process_interval - elapsed)

        cap.release()
    finally:
        logger.info("[PROCESSING DONE] video_id=%s feed_id=%s", video_id, feed_id)
        with feed["lock"]:
            if feed["generation"] == generation:
                if feed["status"] == STATE_RUNNING:
                    feed["status"] = STATE_STOPPED
                    feed["message"] = "Feed stopped"
                feed["processing_thread"] = None
        yolo_processing_lock.release()
        maybe_start_next_queued_feed()


def get_current_packet_for_feed(feed_id: int):
    feed = ensure_feed(feed_id)
    with state_lock:
        mode = feed["mode"]
        if mode == MODE_PROTOTYPE:
            packets = feed["processed_packets"]
            if not packets:
                return None
            if feed["status"] == STATE_LOOPING and feed["latest_packet"] is not None:
                return feed["latest_packet"] if packet_has_valid_frames(feed["latest_packet"]) else None
            idx = min(max(0, feed["current_index"]), len(packets) - 1)
            packet = packets[idx]
            return packet if packet_has_valid_frames(packet) else None
        packet = feed["latest_packet"]
        return packet if packet_has_valid_frames(packet) else None


def build_placeholder(feed_id: int, message: str):
    img = np.zeros((720, 1280, 3), dtype=np.uint8)
    cv2.putText(img, f"FEED {feed_id}", (560, 280), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 65), 2)
    cv2.putText(img, message, (300, 335), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 210, 65), 2)
    return encode_frame(img)


def read_stream_frame(feed_id: int, frame_key: str, packet_key: str, local_index: int):
    feed = feeds.get(feed_id)
    if not feed:
        return None, local_index

    lock = feed.get("lock", state_lock)
    with lock:
        packets = feed.get("processed_packets") or []
        if packets:
            idx = local_index % len(packets)
            packet = packets[idx]
            frame = packet.get(packet_key)
            if valid_jpeg_bytes(frame):
                next_index = (idx + 1) % len(packets)
                feed[frame_key] = frame
                feed["latest_packet"] = packet
                feed["metrics"] = packet["metrics"]
                feed["current_index"] = next_index
                return bytes(frame), next_index

        frame = feed.get(frame_key)
        if valid_jpeg_bytes(frame):
            return bytes(frame), local_index
    return None, local_index


def generate_clean_stream(feed_id: int):
    local_index = 0
    while True:
        frame, local_index = read_stream_frame(feed_id, "clean_frame_bytes", "clean_frame_jpeg", local_index)

        if not valid_jpeg_bytes(frame):
            time.sleep(0.05)
            continue

        yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        time.sleep(0.03)


def generate_debug_stream(feed_id: int):
    local_index = 0
    while True:
        frame, local_index = read_stream_frame(feed_id, "debug_frame_bytes", "debug_frame_jpeg", local_index)

        if not valid_jpeg_bytes(frame):
            time.sleep(0.05)
            continue

        yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        time.sleep(0.03)


def summarize_history(history):
    if not history:
        return {
            "avg_people": 0,
            "avg_density": 0,
            "avg_motion": 0,
            "peak_motion": 0,
            "max_density": 0,
            "risk_events": 0,
            "stampede_risk_events": 0,
            "high_risk_duration": 0,
            "highest_risk_feed": None,
            "stability": "STABLE",
        }
    people = [row.get("people", 0) or 0 for row in history]
    density = [row.get("adjusted", 0) or 0 for row in history]
    motion = [row.get("motion", 0) or 0 for row in history]
    stampede_duration = sum(1 for row in history if row.get("stampede_risk") is True)
    stampede_events = 0
    previous_stampede = False
    for row in history:
        current_stampede = row.get("stampede_risk") is True
        if current_stampede and not previous_stampede:
            stampede_events += 1
        previous_stampede = current_stampede
    risk_events = stampede_events
    highest_risk_feed = None
    for row in history:
        if row.get("stampede_risk") is True or row.get("risk") == "HIGH":
            highest_risk_feed = row.get("feed_id")
            break
    return {
        "avg_people": round(sum(people) / len(people), 2),
        "avg_density": round(sum(density) / len(density), 2),
        "avg_motion": round(sum(motion) / len(motion), 2),
        "peak_motion": round(max(motion), 2),
        "max_density": max(density),
        "risk_events": risk_events,
        "stampede_risk_events": stampede_events,
        "high_risk_duration": stampede_duration,
        "highest_risk_feed": highest_risk_feed,
        "stability": "UNSTABLE" if stampede_events > 0 else "STABLE",
    }


def packet_to_history_row(packet):
    metrics = packet.get("metrics") or {}
    risk = str(metrics.get("risk") or "LOW").upper()
    stampede_risk = bool(metrics.get("stampede_risk"))
    return {
        "frame_id": metrics.get("frame_id", packet.get("frame_id", 0)),
        "time": metrics.get("timestamp", packet.get("timestamp", "")),
        "people": metrics.get("people", 0) or 0,
        "adjusted": metrics.get("adjusted", 0) or 0,
        "density_score": metrics.get("adjusted", 0) or 0,
        "motion": metrics.get("motion", 0) or 0,
        "motion_score": metrics.get("motion", 0) or 0,
        "density": metrics.get("density"),
        "movement": metrics.get("movement"),
        "risk": risk,
        "risk_score": 2 if risk == "HIGH" else 1 if risk == "MEDIUM" else 0,
        "threat": metrics.get("threat"),
        "action": metrics.get("action"),
        "stampede_risk": stampede_risk,
        "trigger_reason": metrics.get("trigger_reason", ""),
        "feed_id": metrics.get("feed_id"),
    }


def history_for_feed(feed):
    with state_lock:
        mode = feed["mode"]
        packets = list(feed["processed_packets"])
        idx = int(feed["current_index"])
        fallback = list(feed["analytics_history"])[-MAX_HISTORY:]

    if mode != MODE_PROTOTYPE or not packets:
        return fallback

    total = len(packets)
    if total <= 0:
        return fallback

    idx = max(0, min(idx, total - 1))
    length = min(MAX_HISTORY, total)
    start = idx - (length - 1)
    rows = []
    for offset in range(length):
        packet = packets[(start + offset) % total]
        rows.append(packet_to_history_row(packet))
    return rows


def derive_events(history):
    events = []
    prev_risk = None
    prev_adjusted = None
    prev_stampede = False
    for row in history:
        time_val = row.get("time", "")
        adjusted = row.get("adjusted", 0) or 0
        motion = row.get("motion", 0) or 0
        risk = row.get("risk", "LOW")
        density = row.get("density")
        movement = row.get("movement")
        stampede_risk = bool(row.get("stampede_risk"))
        if prev_adjusted is not None and prev_adjusted <= 250 < adjusted:
            events.append({"time": time_val, "type": "DENSITY_THRESHOLD", "severity": "WARNING", "message": "Density threshold crossed"})
        if movement == "ABNORMAL" or motion >= 15:
            events.append({"time": time_val, "type": "ABNORMAL_MOVEMENT", "severity": "WARNING", "message": "Abnormal movement detected"})
        if density == "HIGH" and movement == "NORMAL":
            events.append({"time": time_val, "type": "CROWDED_STABLE", "severity": "WATCH", "message": "Crowded but stable"})
        if not prev_stampede and stampede_risk:
            events.append(
                {
                    "time": time_val,
                    "type": "STAMPEDE_RISK",
                    "severity": "CRITICAL",
                    "message": "Stampede risk detected: High density + abnormal movement.",
                }
            )
        if prev_risk and prev_risk != "HIGH" and risk == "HIGH":
            events.append({"time": time_val, "type": "RISK_ESCALATION", "severity": "CRITICAL", "message": "Risk escalated to HIGH"})
        prev_risk = risk
        prev_adjusted = adjusted
        prev_stampede = stampede_risk
    return events[-20:]


def derive_insight(summary, feed_id=None):
    feed_label = f"Feed {feed_id}" if feed_id else "Selected feed"
    if summary.get("stampede_risk_events", 0) > 0:
        return f"{feed_label} showed stampede-risk condition due to high density and abnormal movement."
    if summary["avg_density"] > 250:
        return "Crowd remained dense but stable. Continue monitoring."
    if summary["peak_motion"] > 15:
        return "Unusual movement detected. Verify ground conditions."
    return "Crowd conditions stable."


def storage_public_url(video_id: str, filename: str):
    return storage_service.public_url(video_id, filename)


def update_storage_job(video_id: str, **updates):
    return storage_service.update_job(video_id, **updates)


def get_storage_job(video_id: str):
    return storage_service.get_job(video_id)


def _storage_feed_progress(feed_id: int, frame_id: int, total_frames: int, progress: int, metrics: dict, message: str):
    feed = ensure_feed(feed_id)
    with feed["lock"]:
        feed["mode"] = MODE_STORAGE
        feed["status"] = STATE_PROCESSING
        feed["processed_frames"] = frame_id
        feed["total_frames"] = total_frames
        feed["progress"] = progress
        feed["message"] = message
        feed["metrics"] = metrics


def _storage_feed_complete(feed_id: int, video_id: str, frame_count: int, total_frames: int, latest_metrics: dict, analytics_history: list, message: str):
    feed = ensure_feed(feed_id)
    with feed["lock"]:
        feed["mode"] = MODE_STORAGE
        feed["status"] = STATE_READY
        feed["progress"] = 100
        feed["message"] = message
        feed["processed_frames"] = frame_count
        feed["total_frames"] = total_frames
        feed["metrics"] = latest_metrics
        feed["analytics_history"] = analytics_history[-MAX_HISTORY:]
        feed["video_id"] = video_id


def _storage_feed_error(feed_id: int, message: str):
    feed = ensure_feed(feed_id)
    with feed["lock"]:
        feed["mode"] = MODE_STORAGE
        feed["status"] = STATE_ERROR
        feed["progress"] = 0
        feed["message"] = message


def process_storage_video(video_id: str, input_path: str, feed_id: int):
    logger.info("[PROCESSING STARTED] video_id=%s feed_id=%s", video_id, feed_id)
    storage_service.process_video(
        video_id=video_id,
        input_path=input_path,
        feed_id=feed_id,
        on_progress=_storage_feed_progress,
        on_complete=_storage_feed_complete,
        on_error=_storage_feed_error,
    )
    job = get_storage_job(video_id) or {}
    if job.get("status") == "done":
        logger.info("[PROCESSING DONE] video_id=%s feed_id=%s", video_id, feed_id)


def stop_all_feeds():
    for fid in list(feeds.keys()):
        stop_feed_runtime(fid)
        with state_lock:
            feeds[fid]["status"] = STATE_IDLE
            feeds[fid]["message"] = "Awaiting video upload"


@app.post("/upload")
async def upload_for_storage_playback(file: UploadFile = File(...), feed_id: int = 1):
    fid = max(1, int(feed_id))
    data = await file.read()
    video_id, source_path = storage_service.save_upload(file.filename, data, fid)
    logger.info("[UPLOAD] Video received video_id=%s feed_id=%s filename=%s", video_id, fid, file.filename)
    feed = ensure_feed(fid)
    with feed["lock"]:
        feed["mode"] = MODE_STORAGE
        feed["video_path"] = str(source_path)
        feed["video_id"] = video_id
        feed["status"] = STATE_PROCESSING
        feed["progress"] = 0
        feed["message"] = "Storage processing uploaded video"
        feed["metrics"] = default_metrics(fid)
        feed["processed_packets"] = []
        feed["analytics_history"] = []
        feed["processed_frames"] = 0
        feed["total_frames"] = 0

    thread = threading.Thread(target=process_storage_video, args=(video_id, str(source_path), fid), daemon=True)
    thread.start()
    return {
        "video_id": video_id,
        "feed_id": fid,
        "status": "processing",
        "message": "Upload saved. Processing started.",
        "status_url": f"/status/{video_id}",
    }


@app.get("/status/{video_id}")
async def storage_playback_status(video_id: str):
    job = get_storage_job(video_id)
    if not job:
        return JSONResponse(status_code=404, content={"status": "not_found", "message": "Unknown video_id"})
    return job


@app.get("/")
async def root():
    return {
        "system": "Stampede AI - Crowd Detection",
        "status": "ONLINE",
        "version": "5.0.0",
        "model": "YOLOv8n",
    }


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/debug/feed-state")
async def debug_feed_state(feed_id: int = 1):
    fid = max(1, int(feed_id))
    feed = ensure_feed(fid)
    with state_lock:
        packets = feed["processed_packets"]
        packet = None
        if packets:
            idx = min(max(0, int(feed["current_index"])), len(packets) - 1)
            packet = packets[idx]
        clean_bytes = packet.get("clean_frame_jpeg") if packet else feed["clean_frame_bytes"]
        debug_bytes = packet.get("debug_frame_jpeg") if packet else feed["debug_frame_bytes"]
        return {
            "feed_id": fid,
            "status": feed["status"],
            "mode": feed["mode"],
            "packets_count": len(packets),
            "current_index": feed["current_index"],
            "has_clean_frame": valid_jpeg_bytes(clean_bytes),
            "clean_frame_bytes": len(clean_bytes) if valid_jpeg_bytes(clean_bytes) else 0,
            "has_debug_frame": valid_jpeg_bytes(debug_bytes),
            "debug_frame_bytes": len(debug_bytes) if valid_jpeg_bytes(debug_bytes) else 0,
            "metrics": feed["metrics"],
            "video_path": feed["video_path"],
            "video_id": feed.get("video_id"),
            "progress": feed["progress"],
            "message": feed["message"],
        }


@app.get("/status")
async def processing_status(feed_id: int = 1):
    feed = ensure_feed(feed_id)
    with state_lock:
        state = {
            "feed_id": feed_id,
            "mode": feed["mode"],
            "state": feed["status"],
            "progress": feed["progress"],
            "message": feed["message"],
            "video_id": feed.get("video_id"),
            "processed_frames": feed["processed_frames"],
            "packets_count": len(feed["processed_packets"]),
            "total_frames": feed["total_frames"],
            "current_index": feed["current_index"],
            "has_video": bool(feed["video_path"] and os.path.exists(feed["video_path"])),
            "active_feed_id": active_feed_id,
            "heatmap_enabled": heatmap_enabled,
            "debug_boxes_enabled": debug_boxes_enabled,
            "debug_telemetry_enabled": debug_telemetry_enabled,
            "queued_for_processing": feed["queued_for_processing"],
            "queue_length": len(processing_queue),
        }
    return state


@app.post("/video/upload")
async def upload_video(file: UploadFile = File(...), feed_id: int = 1):
    global active_feed_id
    fid = max(1, int(feed_id))
    active_feed_id = fid
    stop_feed_runtime(fid)
    feed = reset_feed_runtime(fid, keep_video=False)
    video_id = uuid.uuid4().hex

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    target = UPLOAD_DIR / f"feed_{fid}_{file.filename}"
    data = await file.read()
    with open(target, "wb") as f:
        f.write(data)
    logger.info("[UPLOAD] Video received video_id=%s feed_id=%s filename=%s", video_id, fid, file.filename)

    with feed["lock"]:
        feed["video_path"] = str(target)
        feed["video_id"] = video_id
        feed["status"] = STATE_UPLOADED
        feed["progress"] = 0
        feed["message"] = "Video uploaded"
        feed["metrics"] = default_metrics(fid)

    # Prototype mode starts processing immediately after upload.
    with state_lock:
        mode = feed["mode"]
    if mode == MODE_PROTOTYPE:
        if is_yolo_busy(exclude_feed_id=fid):
            queue_feed_for_processing(fid)
            return {
                "status": "queued",
                "message": "Video uploaded and added to processing queue.",
                "video_path": str(target),
                "video_id": video_id,
                "feed_id": fid,
            }

        with feed["lock"]:
            feed["stop_event"] = threading.Event()
            feed["status"] = STATE_PROCESSING
            feed["progress"] = 0
            feed["message"] = "Processing uploaded video"
        proc_thread = threading.Thread(target=process_prototype_buffered, args=(fid,), daemon=True)
        with feed["lock"]:
            feed["processing_thread"] = proc_thread
        proc_thread.start()
        return {
            "status": "processing_started",
            "message": "Processing uploaded video",
            "video_path": str(target),
            "video_id": video_id,
            "feed_id": fid,
        }

    return {"status": "uploaded", "message": "Video uploaded", "video_path": str(target), "video_id": video_id, "feed_id": fid}


@app.post("/video/start")
async def start_video(video_path: str = "", feed_id: int = 1):
    global active_feed_id
    fid = max(1, int(feed_id))
    active_feed_id = fid
    feed = ensure_feed(fid)

    with feed["lock"]:
        if video_path:
            feed["video_path"] = video_path
        mode = feed["mode"]
        status = feed["status"]
        video_id = feed.get("video_id")
        has_video = bool(feed["video_path"] and os.path.exists(feed["video_path"]))

    if not has_video:
        update_feed_status(fid, state=STATE_IDLE, progress=0, message="No video uploaded")
        return JSONResponse(status_code=400, content={"status": "error", "message": "No video uploaded"})

    if mode == MODE_PROTOTYPE:
        if status == STATE_PROCESSING:
            with state_lock:
                return {
                    "status": "processing",
                    "message": feed["message"],
                    "progress": feed["progress"],
                    "processed_frames": feed["processed_frames"],
                    "total_frames": feed["total_frames"],
                    "video_id": video_id,
                }
        if status == STATE_LOOPING:
            return {"status": "already_running", "message": "Looping synced processed output", "feed_id": fid, "video_id": video_id}
        with feed["lock"]:
            has_cached = len(feed["processed_packets"]) > 0
        if status in (STATE_READY, STATE_STOPPED) and has_cached:
            stop_feed_runtime(fid)
            with feed["lock"]:
                feed["stop_event"] = threading.Event()
                feed["current_index"] = 0
                feed["latest_packet"] = feed["processed_packets"][0]
                feed["metrics"] = feed["latest_packet"]["metrics"]
                feed["clean_frame_bytes"] = feed["latest_packet"]["clean_frame_jpeg"]
                feed["debug_frame_bytes"] = feed["latest_packet"]["debug_frame_jpeg"]
            loop_thread = threading.Thread(target=prototype_playback_loop, args=(fid,), daemon=True)
            with feed["lock"]:
                feed["playback_thread"] = loop_thread
            loop_thread.start()
            return {"status": "started", "message": "Looping synced processed output", "feed_id": fid, "video_id": video_id}

        if is_yolo_busy(exclude_feed_id=fid):
            queue_feed_for_processing(fid)
            return {
                "status": "queued",
                "message": "Another feed is currently processing. Added to queue.",
                "feed_id": fid,
                "video_id": video_id,
            }

        stop_feed_runtime(fid)
        with feed["lock"]:
            feed["stop_event"] = threading.Event()
        proc_thread = threading.Thread(target=process_prototype_buffered, args=(fid,), daemon=True)
        with feed["lock"]:
            feed["processing_thread"] = proc_thread
            feed["status"] = STATE_PROCESSING
            feed["progress"] = 0
            feed["message"] = "Processing uploaded video"
        proc_thread.start()
        return {"status": "started", "message": "Processing uploaded video", "feed_id": fid, "video_id": video_id}

    # continuous_monitoring
    if status == STATE_RUNNING:
        return {"status": "already_running", "message": "Continuous monitoring active", "feed_id": fid, "video_id": video_id}
    if is_yolo_busy(exclude_feed_id=fid):
        return JSONResponse(
            status_code=409,
            content={"status": "busy", "message": "Another feed is currently processing. Please wait."},
        )

    stop_feed_runtime(fid)
    with feed["lock"]:
        feed["stop_event"] = threading.Event()
        feed["status"] = STATE_RUNNING
        feed["progress"] = 100
        feed["message"] = "Continuous monitoring active"
    proc_thread = threading.Thread(target=process_continuous_monitoring, args=(fid,), daemon=True)
    with feed["lock"]:
        feed["processing_thread"] = proc_thread
    proc_thread.start()
    return {"status": "started", "message": "Continuous monitoring active", "feed_id": fid, "video_id": video_id}


@app.post("/video/stop")
async def stop_video(feed_id: int = 1):
    fid = max(1, int(feed_id))
    stop_feed_runtime(fid)
    update_feed_status(fid, state=STATE_STOPPED, progress=0, message="Feed stopped")
    return {"status": "stopped", "message": "Feed stopped", "feed_id": fid}


@app.get("/video/stream")
def video_stream(feed_id: int = 1):
    fid = max(1, int(feed_id))
    return StreamingResponse(
        generate_clean_stream(fid),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"},
    )


@app.get("/video/debug-stream")
def debug_stream(feed_id: int = 1):
    fid = max(1, int(feed_id))
    return StreamingResponse(
        generate_debug_stream(fid),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"},
    )


@app.get("/data")
async def data(feed_id: int = 1):
    fid = max(1, int(feed_id))
    feed = ensure_feed(fid)
    packet = get_current_packet_for_feed(fid)
    if packet is None:
        with state_lock:
            if feed["mode"] == MODE_STORAGE and (feed["metrics"].get("frame_id") or 0) > 0:
                return feed["metrics"]
            out = default_metrics(fid)
            out["status"] = str(feed["status"]).lower()
            return out
    return packet["metrics"]


@app.get("/analytics")
async def analytics(feed_id: int = 1):
    fid = max(1, int(feed_id))
    feed = ensure_feed(fid)
    history = history_for_feed(feed)
    summary = summarize_history(history)
    summary["highest_risk_feed"] = fid if summary.get("stampede_risk_events", 0) > 0 else summary.get("highest_risk_feed")
    events = derive_events(history)
    insight = derive_insight(summary, fid)
    return {"history": history, "summary": summary, "events": events, "insight": insight}


@app.get("/analytics/global")
async def analytics_global():
    all_rows = []
    with state_lock:
        snapshot = [feeds[fid] for fid in sorted(feeds.keys())]
    for feed in snapshot:
        all_rows.extend(history_for_feed(feed))
    summary = summarize_history(all_rows)
    events = derive_events(all_rows)
    insight = derive_insight(summary, None)
    active_feeds = 0
    high_risk_feeds = 0
    watch_feeds = 0
    idle_feeds = 0
    with state_lock:
        for feed in feeds.values():
            state = str(feed.get("status") or "").upper()
            if state in (STATE_READY, STATE_LOOPING, STATE_RUNNING, STATE_PROCESSING, STATE_UPLOADED):
                active_feeds += 1
            if feed.get("metrics", {}).get("risk") == "HIGH":
                high_risk_feeds += 1
            elif feed.get("metrics", {}).get("risk") == "MEDIUM":
                watch_feeds += 1
            if state in (STATE_IDLE, STATE_STOPPED) and not feed.get("video_path"):
                idle_feeds += 1
    return {
        "history": all_rows[-MAX_HISTORY:],
        "summary": summary,
        "events": events,
        "insight": insight,
        "live_monitoring": {
            "active_feeds": active_feeds,
            "high_risk_feeds": high_risk_feeds,
            "watch_feeds": watch_feeds,
            "idle_feeds": idle_feeds,
        },
    }


class HeatmapSettings(BaseModel):
    enabled: bool


@app.get("/settings")
async def settings(feed_id: int = 1):
    feed = ensure_feed(feed_id)
    with state_lock:
        mode = feed["mode"]
    return {
        "mode": mode,
        "heatmap_enabled": heatmap_enabled,
        "debug_heatmap_enabled": heatmap_enabled,
        "debug_boxes_enabled": debug_boxes_enabled,
        "debug_telemetry_enabled": debug_telemetry_enabled,
        "active_feed_id": active_feed_id,
    }


@app.post("/settings/heatmap")
async def set_heatmap(payload: HeatmapSettings):
    global heatmap_enabled
    heatmap_enabled = bool(payload.enabled)
    return {"heatmap_enabled": heatmap_enabled}


class DebugVisualSettings(BaseModel):
    boxes_enabled: bool | None = None
    telemetry_enabled: bool | None = None


@app.post("/settings/debug-visuals")
async def set_debug_visuals(payload: DebugVisualSettings):
    global debug_boxes_enabled, debug_telemetry_enabled
    if payload.boxes_enabled is not None:
        debug_boxes_enabled = bool(payload.boxes_enabled)
    if payload.telemetry_enabled is not None:
        debug_telemetry_enabled = bool(payload.telemetry_enabled)
    return {
        "debug_boxes_enabled": debug_boxes_enabled,
        "debug_telemetry_enabled": debug_telemetry_enabled,
        "debug_heatmap_enabled": heatmap_enabled,
    }


class ModeSettings(BaseModel):
    mode: str
    feed_id: int = 1


class DeleteRequest(BaseModel):
    pin: str


@app.delete("/delete/{video_id}")
async def delete_video(video_id: str, payload: DeleteRequest):
    if payload.pin != DELETE_PIN:
        return JSONResponse(status_code=403, content={"status": "forbidden", "message": "Invalid PIN"})

    removed_files = 0
    deleted_feed_id = find_feed_by_video_id(video_id)

    if deleted_feed_id is not None:
        feed = ensure_feed(deleted_feed_id)
        with feed["lock"]:
            video_path = feed.get("video_path")
        stop_feed_runtime(deleted_feed_id)
        if safe_remove_file(video_path):
            removed_files += 1
        removed_files += delete_storage_artifacts(video_id)
        reset_deleted_feed(deleted_feed_id)
    else:
        removed_files += delete_storage_artifacts(video_id)

    logger.info("[DELETED] video_id=%s feed_id=%s removed_files=%s", video_id, deleted_feed_id, removed_files)
    return {"status": "deleted"}


@app.post("/settings/mode")
async def set_mode(payload: ModeSettings):
    fid = max(1, int(payload.feed_id))
    mode = str(payload.mode).strip()
    if mode not in (MODE_PROTOTYPE, MODE_CONTINUOUS):
        return JSONResponse(status_code=400, content={"status": "error", "message": "Invalid mode"})
    feed = ensure_feed(fid)
    with state_lock:
        if feed["status"] in (STATE_PROCESSING, STATE_LOOPING, STATE_RUNNING):
            return JSONResponse(status_code=409, content={"status": "error", "message": "Stop feed before changing mode."})
        feed["mode"] = mode
        feed["message"] = f"Mode set to {mode}"
    return {"status": "ok", "feed_id": fid, "mode": mode}


@app.post("/debug/toggle")
async def debug_toggle(enabled: bool = True):
    return {"debug_mode": enabled, "message": "Use /video/debug-stream for debug view"}


@app.post("/debug/confidence")
async def debug_confidence(threshold: float = 0.15):
    global YOLO_CONFIDENCE
    YOLO_CONFIDENCE = float(max(0.01, min(0.95, threshold)))
    return {"confidence_threshold": YOLO_CONFIDENCE, "message": f"Confidence threshold set to {YOLO_CONFIDENCE}"}


@app.post("/reset")
async def reset():
    stop_all_feeds()
    clear_uploads_folder()
    with state_lock:
        for fid in list(feeds.keys()):
            feeds[fid] = create_feed_state(fid)
    return {"status": "reset", "message": "Detection state cleared"}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    data = await file.read()
    nparr = np.frombuffer(data, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        return JSONResponse(status_code=400, content={"detail": "Invalid image format"})

    detections = detect_people(frame)
    metrics, _ = calculate_metrics(frame, detections, None, 0.0, 1)
    metrics["frame_id"] = 1
    debug_frame = frame.copy()
    if heatmap_enabled:
        debug_frame = apply_heatmap(debug_frame, detections, grid_size=8, alpha=0.3)
    debug_frame = draw_debug_frame(debug_frame, detections, metrics)
    encoded = encode_frame(debug_frame)
    if encoded is None:
        return JSONResponse(status_code=500, content={"detail": "Frame encoding failed"})
    out = dict(metrics)
    out["frame"] = base64.b64encode(encoded).decode("utf-8")
    return JSONResponse(out)


@app.post("/analyze/frame")
async def analyze_frame(file: UploadFile = File(...)):
    data = await file.read()
    nparr = np.frombuffer(data, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        return JSONResponse(status_code=400, content={"detail": "Invalid image"})
    detections = detect_people(frame)
    metrics, _ = calculate_metrics(frame, detections, None, 0.0, 1)
    metrics["frame_id"] = 1
    return metrics


# Fresh startup
clear_uploads_folder()
for fid in list(feeds.keys()):
    feeds[fid] = create_feed_state(fid)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
