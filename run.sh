#!/bin/bash

# -------------------------------
# Run FastAPI server for project
# -------------------------------

# Exit if any command fails
set -e

# Virtual environment path
VENV_DIR=".venv"

# Activate virtual environment
if [ -d "$VENV_DIR" ]; then
    echo "Activating virtual environment..."
    source "$VENV_DIR/bin/activate"
else
    echo "Virtual environment not found at $VENV_DIR"
    echo "Please create it first with: python3 -m venv $VENV_DIR"
    exit 1
fi

# Default host and port
HOST="0.0.0.0"
PORT="8000"

# Optional: accept host and port from command line
if [ ! -z "$1" ]; then
    HOST="$1"
fi
if [ ! -z "$2" ]; then
    PORT="$2"
fi

echo "Starting FastAPI server at http://$HOST:$PORT ..."

# Run Uvicorn with reload for development
exec uvicorn app.main:app --host $HOST --port $PORT --reload
