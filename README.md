# 📝 Web Interview Recorder

A lightweight client–server application for conducting asynchronous video interviews using per-question recording and immediate upload.

> **Developed as part of the Network and Communication Technology course.**

## 📌 Overview

The Web Interview Recorder is a browser-based system that allows candidates to answer interview questions one by one.

Each response is recorded as a separate video file and uploaded immediately to the server to prevent data loss caused by network instability or large file transfers.

**The system implements:**
* Per-question video recording
* Immediate upload with retry and exponential backoff
* Token-based authentication
* Session creation and metadata tracking
* Structured server-side storage using timestamps
* Per-question Speech-to-Text transcript generation

## 🚀 Features

* 🎥 **Record video per question** using MediaRecorder
* 📤 **Upload each video immediately** after recording
* 🔐 **Server-side token validation**
* 🌐 **HTTPS compatibility** for accessing camera/microphone
* 📁 **Organized server storage** with timestamp-based folder naming
* ♻️ **Retry logic** with exponential backoff for unreliable networks
* 📝 **Metadata tracking** for all uploaded files
* 🗣️ **Automatic Speech-to-Text** transcript

## 📁 Project Structure

```
COMPUTERNETWORK-WEB_INTERVIEW_RECORDER/
│
├── app/                       # Core backend application package
│   ├── __pycache__/           # Compiled Python bytecode files
│   ├── __init__.py            # Initializes the app module
│   ├── config.py              # Configuration settings (paths, time zone, limits)
│   ├── main.py                # Main API logic: verify-token, start, upload-one, finish
│   └── utils.py               # Helper functions: folder creation, metadata update, naming
│
├── recordings/                # Server-side storage of uploaded interview videos
│                              # Automatically organized by timestamp and username
│
├── static/                    # Frontend assets served by the backend
│   ├── app.js                 # Main client-side logic: recording, upload, retry/backoff
│   ├── favicon.ico            # Website icon
│   ├── index.html             # Main UI for the interview interface
│   └── styles.css             # Page styling and layout
│
├── .gitignore                 # Files and directories excluded from version control
├── .python-version            # Python version pinning for runtime consistency
│
├── pyproject.toml             # Project metadata, dependencies, and build configuration
├── requirements.txt           # Dependencies list for pip installation
│
├── run.sh                     # Shell script to start the server environment
│
└── uv.lock                    # Dependency lock file for reproducible environments

```

## ⚙️ Installation

# 1. Clone the repository

```bash
git clone <repo-url>
cd COMPUTERNETWORK-WEB_INTERVIEW_RECORDER
```
# 2. Create virtual environment
```bash
python -m venv .venv

# Activate the environment:
source .venv/bin/activate   # macOS / Linux
# OR
.\.venv\Scripts\activate    # Windows
```
# 3. Install dependencies
```bash
pip install -r requirements.txt
```
# 4. Run the server
### Grant Execute Permission to the Script
```bash
chmod +x run.sh
```
### Run server
```bash
./run.sh
```
This will launch the backend server and make the system available in the browser (usually at http://localhost:8000/).
