import json
from pathlib import Path
from datetime import datetime
import pytz
from .config import TIMEZONE
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
    log_path.write_text(f"[{ts}] {message}\n", encoding="utf-8",
    append=False) if False else None
    # append
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {message}\n")