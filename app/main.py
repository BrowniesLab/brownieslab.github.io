# app/main.py
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import shutil
import json
from datetime import datetime
import pytz
from app.config import VALID_TOKENS, TIMEZONE, RECORDINGS_DIR
from app.utils import extract_audio_from_video, audio_to_text
from app.utils import make_folder_name, sanitize_filename, write_metadata, log_event, now_iso, extract_audio_from_video, audio_to_text

# --- Cấu hình cơ bản ---
BASE_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = BASE_DIR / "static"
RECORDINGS_DIR = RECORDINGS_DIR
TIMEZONE = TIMEZONE
VALID_TOKENS = VALID_TOKENS 

# Tạo thư mục recordings nếu chưa có
RECORDINGS_DIR.mkdir(exist_ok=True)

# --- FastAPI app ---
app = FastAPI(title="Web Interview Recorder")

# --- Favicon ---
from fastapi.responses import FileResponse

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")

# CORS để dev từ localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# --- Helper ---
def now_iso():
    return datetime.utcnow().isoformat()

def sanitize_filename(name: str):
    return "".join(c for c in name if c.isalnum() or c in "-_").rstrip()

def make_folder_name(user: str):
    tz = pytz.timezone("Asia/Bangkok")
    timestamp = datetime.now(tz).strftime("%d_%m_%Y_%H_%M")
    return f"{timestamp}_{user}"

def write_metadata(folder: Path, data: dict):
    with (folder / "meta.json").open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)

def log_event(folder: Path, msg: str):
    with (folder / "log.txt").open("a", encoding="utf-8") as f:
        f.write(f"{now_iso()} | {msg}\n")

# --- Routes ---

# Root trả về index.html
@app.get("/", include_in_schema=False)
async def root_index():
    idx = BASE_DIR / "index.html"
    if not idx.exists():
        raise HTTPException(status_code=404, detail="index.html not found")
    return FileResponse(idx)

# Token verify
@app.post("/api/verify-token")
async def verify_token(token: str = Form(...)):
    if token in VALID_TOKENS:
        return {"ok": True}
    raise HTTPException(status_code=401, detail="Invalid token")

# Start session
@app.post("/api/session/start")
async def session_start(token: str = Form(...), userName: str = Form(...)):
    if token not in VALID_TOKENS:
        raise HTTPException(status_code=401, detail="Invalid token")

    safe_name = sanitize_filename(userName)
    folder_name = make_folder_name(safe_name)
    folder = RECORDINGS_DIR / folder_name
    folder.mkdir(parents=True, exist_ok=True)

    meta = {
        "userName": userName,
        "createdAt": now_iso(),
        "timeZone": TIMEZONE,
        "questions": [],
    }
    write_metadata(folder, meta)
    log_event(folder, f"Session started for {userName}")

    return {"ok": True, "folder": folder_name}

# Upload one video
from pathlib import Path

@app.post("/api/upload-one")
async def upload_one(token: str = Form(...), folder: str = Form(...),
                     questionIndex: int = Form(...), video: UploadFile = File(...)):
    # 1. Kiểm tra Token
    if token not in VALID_TOKENS:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    # 2. Kiểm tra thư mục đích
    target_folder = RECORDINGS_DIR / folder
    if not target_folder.exists():
        return JSONResponse(status_code=400, content={"ok": False, "error": "Folder not found"})
    
    # 3. Lưu Video (Bước quan trọng nhất - thực hiện đầu tiên)
    fname = f"Q{questionIndex}.webm"
    video_path = target_folder / fname
    
    try:
        with video_path.open("wb") as f:
            shutil.copyfileobj(video.file, f)
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": f"Failed to save video: {str(e)}"})

    # 4. Xử lý Audio và Speech-to-Text (Trong khối try-except để không làm hỏng upload nếu lỗi)
    text_path = None
    transcription_status = "not attempted"
    
    try:
        audio_path = target_folder / f"Q{questionIndex}.wav"
        
        # Trích xuất audio
        extract_audio_from_video(video_path, audio_path) 
        
        # Gọi Google Speech-to-Text
        # Lưu ý: language_code="vi-VN" cho tiếng Việt
        text = audio_to_text(audio_path) 
        
        # Lưu kết quả text
        text_path = target_folder / f"Q{questionIndex}.txt"
        text_path.write_text(text, encoding="utf-8")
        
        transcription_status = "transcription saved"
        
    except Exception as e:
        # Nếu lỗi STT, chỉ in log lỗi, KHÔNG throw exception để client vẫn nhận được kết quả OK
        print(f"⚠️ STT Error for {fname}: {e}")
        transcription_status = f"STT failed: {str(e)[:100]}" # Lưu lỗi ngắn gọn vào log
        text_path = None # Đánh dấu là không có file text

    # 5. Cập nhật Metadata
    meta_path = target_folder / "meta.json"
    try:
        if meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        else:
            meta = {}
    except Exception:
        meta = {}
        
    qentry = {
        "index": questionIndex, 
        "savedAs": fname, 
        # Nếu text_path tồn tại thì lưu tên file, nếu không thì null
        "textFile": str(text_path.name) if text_path else None, 
        "uploadedAt": now_iso(),
        "status": transcription_status
    }
    
    meta.setdefault("questions", []).append(qentry)
    write_metadata(target_folder, meta)
    
    log_event(target_folder, f"Received {fname} (Index={questionIndex}). Status: {transcription_status}")

    return {
        "ok": True, 
        "savedAs": fname, 
        "textFile": str(text_path.name) if text_path else None
    }

# Finish session
@app.post("/api/session/finish")
async def session_finish(token: str = Form(...), folder: str = Form(...),
                         questionsCount: int = Form(...)):
    if token not in VALID_TOKENS:
        raise HTTPException(status_code=401, detail="Invalid token")

    target_folder = RECORDINGS_DIR / folder
    if not target_folder.exists():
        return JSONResponse(status_code=400, content={"ok": False, "error": "Folder not found"})

    try:
        meta = json.loads((target_folder / "meta.json").read_text(encoding="utf-8"))
    except Exception:
        meta = {}
    meta["finishedAt"] = now_iso()
    meta["questionsCount"] = questionsCount
    write_metadata(target_folder, meta)
    log_event(target_folder, f"Session finished (questionsCount={questionsCount})")
    return {"ok": True}

# Health check
@app.get("/api/health")
async def health():
    return {"ok": True}
