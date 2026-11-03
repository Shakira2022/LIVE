import logging
import tempfile
from pathlib import Path

import whisper
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

app = FastAPI(title="LIVE Voice-to-Text API")

# Load Whisper once when the API starts.
model = whisper.load_model("base")

ALLOWED_EXTENSIONS = {
    ".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac", ".mp4", ".aac"
}

MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "whisper-transcription"
    }


@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    extension = Path(file.filename or "").suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported audio format."
        )

    audio_data = await file.read(MAX_FILE_SIZE + 1)

    if not audio_data:
        raise HTTPException(
            status_code=400,
            detail="The audio file is empty."
        )

    if len(audio_data) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Audio file exceeds the 15 MB limit."
        )

    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            suffix=extension,
            delete=False
        ) as temp_file:
            temp_file.write(audio_data)
            temp_path = Path(temp_file.name)

        # Run the slow transcription in a worker thread so the API stays responsive.
        result = await run_in_threadpool(
            model.transcribe,
            str(temp_path),
            task="transcribe",
            fp16=False,
        )

        return {
            "text": result["text"].strip(),
            "language": result["language"]
        }

    except Exception as exc:
        logging.exception("Audio transcription failed")

        raise HTTPException(
            status_code=500,
            detail="Audio transcription failed."
        ) from exc

    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)