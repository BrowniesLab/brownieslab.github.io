from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import shutil
import json
from .config import RECORDINGS_DIR, VALID_TOKENS, TIMEZONE
from .utils import make_folder_name, sanitize_filename, write_metadata, log_event, now_iso

app = FastAPI(title="Web Interview Recorder API")
# Serve the static frontend
app.mount("/static",
            StaticFiles(directory=Path(__file__).resolve().parents[1] / "static"),
            name="static")
# Allow local dev origin
app.add_middleware(
                    CORSMiddleware,
                    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
                    allow_credentials=True,
                    allow_methods=["*"],
                    allow_headers=["*"],
                    )
@app.post("/api/verify-token")
async def verify_token(token: str = Form(...)):
    if token in VALID_TOKENS:
        return {"ok": True}
    raise HTTPException(status_code=401, detail="Invalid token")
@app.post("/api/session/start")
async def session_start(token: str = Form(...), userName: str = Form(...)):
    if token not in VALID_TOKENS:
        raise HTTPException(status_code=401, detail="Invalid token")
    safe_name = sanitize_filename(userName)
    folder_name = make_folder_name(safe_name)
    folder = RECORDINGS_DIR / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    # initial metadata
    meta = {
    "userName": userName,
    "createdAt": now_iso(),
    "timeZone": TIMEZONE,
    "questions": [],
    }
    write_metadata(folder, meta)
    log_event(folder, f"Session started for {userName}")
    return {"ok": True, "folder": folder_name}
@app.post("/api/upload-one")
async def upload_one(token: str = Form(...), folder: str = Form(...),
questionIndex: int = Form(...), video: UploadFile = File(...)):
    if token not in VALID_TOKENS:
        raise HTTPException(status_code=401, detail="Invalid token")
    # Basic MIME / size checks (size check is advisory here)
    if video.content_type not in ["video/webm", "video/webm;codecs=vp8", "video/webm;codecs=vp9"]:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Unsupported MIME type"})
    target_folder = RECORDINGS_DIR / folder
    if not target_folder.exists():
        return JSONResponse(status_code=400, content={"ok": False, "error": "Folder not found"})
    fname = f"Q{questionIndex}.webm"
    out_path = target_folder / fname
    # Save file
    with out_path.open("wb") as f:
        shutil.copyfileobj(video.file, f)
    # update metadata
    meta_path = target_folder / "meta.json"
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        meta = {}
    qentry = {"index": questionIndex, "savedAs": fname, "uploadedAt": now_iso()}
    meta.setdefault("questions", []).append(qentry)
    write_metadata(target_folder, meta)
    log_event(target_folder, f"Received {fname} (questionIndex={questionIndex})")
    return {"ok": True, "savedAs": fname}
@app.post("/api/session/finish")
async def session_finish(token: str = Form(...), folder: str = Form(...),
questionsCount: int = Form(...)):
    if token not in VALID_TOKENS:
        raise HTTPException(status_code=401, detail="Invalid token")
    target_folder = RECORDINGS_DIR / folder
    if not target_folder.exists():
        return JSONResponse(status_code=400, content={"ok": False, "error":
    "Folder not found"})
    # update final metadata
    try:
        meta = json.loads((target_folder /"meta.json").read_text(encoding="utf-8"))
    except Exception:
        meta = {}
        meta["finishedAt"] = now_iso()
        meta["questionsCount"] = questionsCount
        write_metadata(target_folder, meta)
        log_event(target_folder, f"Session finished (questionsCount={questionsCount})")
        return {"ok": True}
# Simple health check
@app.get("/api/health")
async def health():
    return {"ok": True}

