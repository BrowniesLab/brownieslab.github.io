# app/utils.py

import json
from pathlib import Path
from datetime import datetime
import pytz
import os
import io

# --- IMPORTS MỚI CHO WHISPER VÀ XỬ LÝ AUDIO ---
# Xóa import Google Cloud và moviepy
import whisper
from pydub import AudioSegment
# ---------------------------------------------

from .config import TIMEZONE

# --- Khởi tạo Model Whisper (chỉ chạy 1 lần khi server khởi động) ---
# Sử dụng model 'base' (khoảng 140MB). Thay bằng 'small' hoặc 'medium' nếu cần
try:
    WHISPER_MODEL = whisper.load_model("medium") 
    print("🤖 Whisper model 'base' loaded successfully.")
except Exception as e:
    # Nếu không thể tải hoặc lỗi torch/ffmpeg, in lỗi để dễ debug
    print(f"🚨 WARNING: Failed to load Whisper model: {e}")
    WHISPER_MODEL = None
# -----------------------------------------------

# --- Hàm Helpers Cơ bản (Giữ nguyên) ---

def now_iso():
    tz = pytz.timezone(TIMEZONE)
    return datetime.now(tz).isoformat()

def make_folder_name(user_name: str, tz_name: str = TIMEZONE):
    tz = pytz.timezone(tz_name)
    now = datetime.now(tz)
    safe = sanitize_filename(user_name)
    return now.strftime(f"%d_%m_%Y_%H_%M_{safe}")

def sanitize_filename(name: str) -> str:
    # simple sanitizer: remove problematic characters and replace spaces with underscore
    keep = []
    for ch in name:
        if ch.isalnum() or ch in "-_":
            keep.append(ch)
        elif ch.isspace():
            keep.append("_")
    out = "".join(keep)
    return out or "user"

def write_metadata(folder: Path, meta: dict):
    meta_path = folder / "meta.json"
    # Merge existing metadata if present
    if meta_path.exists():
        try:
            existing = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            existing = {}
        existing.update(meta)
        meta = existing
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2),
    encoding="utf-8")

def log_event(folder: Path, message: str):
    log_path = folder / "server.log"
    ts = now_iso()
    # append
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {message}\n")

# --- Thay thế extract_audio_from_video (Sử dụng Pydub) ---

def extract_audio_from_video(video_path: Path, audio_path: Path):
    """
    Trích xuất audio từ video (.webm) và lưu ra file .mp3.
    """
    if not WHISPER_MODEL:
        raise Exception("Whisper model is not loaded. Cannot process audio.")
        
    # Pydub tự động nhận diện định dạng (webm)
    # Lưu ý: Pydub yêu cầu FFmpeg phải được cài đặt trên hệ thống!
    audio = AudioSegment.from_file(os.fspath(video_path))
    
    # Lưu dưới dạng MP3 (để Whisper dễ xử lý hơn)
    mp3_path = audio_path.with_suffix(".mp3")
    audio.export(os.fspath(mp3_path), format="mp3") 
    
    # Trả về đường dẫn MP3 đã tạo để hàm STT sử dụng
    return mp3_path

# --- Thay thế audio_to_text (Sử dụng Whisper) ---

def audio_to_text(audio_path: Path):
    """
    Sử dụng OpenAI Whisper để chuyển audio/video thành văn bản.
    Hàm này nhận audio_path, nhưng sẽ dùng file .mp3 do hàm trên tạo ra.
    """
    if not WHISPER_MODEL:
        return "ERROR: Whisper model failed to load. Transcription aborted."
        
    # File được tạo ra từ extract_audio_from_video
    mp3_path = audio_path.with_suffix(".mp3") 

    # Whisper tự động nhận diện ngôn ngữ nếu không chỉ định, 
    # nhưng chúng ta chỉ định ngôn ngữ Việt Nam để cải thiện tốc độ/độ chính xác.
    result = WHISPER_MODEL.transcribe(
        os.fspath(mp3_path), 
        language="vi" # Sử dụng "vi" cho tiếng Việt
    )
    
    return result["text"].strip()