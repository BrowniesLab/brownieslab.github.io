from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
RECORDINGS_DIR = BASE_DIR / "recordings"
RECORDINGS_DIR.mkdir(exist_ok=True)

# Replace with your preferred token(s) or integrate real auth later
VALID_TOKENS = {"TEST_TOKEN_ABC123"}

# Timezone to use when creating folder names & timestamps
TIMEZONE = "Asia/Bangkok"

BASE_DIR = Path(__file__).resolve().parent
GOOGLE_KEY_PATH = BASE_DIR / "speech-sa.json"  # file JSON tải từ Google Cloud
