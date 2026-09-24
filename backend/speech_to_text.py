import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import ctranslate2
from faster_whisper import WhisperModel



print("========== WHISPER DEBUG ==========")
print("CTranslate2 version:", ctranslate2.__version__)
print("CTranslate2 path:", ctranslate2.__file__)
print("===================================")
# -----------------------------
# MODEL CONFIG
# -----------------------------

# MODEL_PATH = r"D:\PROGETTI\SMI\backend\models\faster-whisper-large-v3-turbo"

MODEL_NAME = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"

# BASE_DIR = Path(__file__).resolve().parent

# MODEL_PATH = BASE_DIR / "models" / "faster-whisper-large-v3-turbo"


DEVICE = os.getenv(
    "WHISPER_DEVICE",
    "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
)

COMPUTE_TYPE = os.getenv(
    "WHISPER_COMPUTE_TYPE",
    "float16" if DEVICE == "cuda" else "int8"
)


INTERVIEW_GLOSSARY = (
    "Python, JavaScript, TypeScript, React, Node.js, Flask, FastAPI, "
    "Docker, Kubernetes, AWS, Azure, GCP, SQL, PostgreSQL, MongoDB, "
    "REST API, GraphQL, machine learning, deep learning, TensorFlow, "
    "PyTorch, scikit-learn, NumPy, Pandas, GitHub, CI/CD."
)


print(
    f"Loading Whisper model '{MODEL_NAME}' "
    f"on {DEVICE} ({COMPUTE_TYPE})..."
)

model = WhisperModel(
    MODEL_NAME,
    device=DEVICE,
    compute_type=COMPUTE_TYPE
)

# model = WhisperModel(
#     str(MODEL_PATH),
#     device=DEVICE,
#     compute_type=COMPUTE_TYPE
# )


print("Whisper model loaded successfully!")


# -----------------------------
# AUDIO NORMALIZATION
# -----------------------------

def _normalize_audio(source_path: str, output_path: str) -> None:

    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            "FFmpeg is required for audio transcription."
        )

    try:

        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                source_path,
                "-vn",
                "-ac", "1",
                "-ar", "16000",
                "-c:a", "pcm_s16le",
                output_path,
            ],
            check=True,
            capture_output=True,
            text=True,
        )

    except subprocess.CalledProcessError as error:

        raise RuntimeError(
            "The uploaded audio could not be decoded."
        ) from error


# -----------------------------
# TRANSCRIPTION
# -----------------------------

def transcribe_audio(audio_path: str) -> dict:

    with tempfile.TemporaryDirectory() as temp_dir:

        wav_path = str(
            Path(temp_dir) / "normalized.wav"
        )

        _normalize_audio(
            audio_path,
            wav_path
        )

        segments, info = model.transcribe(
            wav_path,
            task="transcribe",
            language="en",
            beam_size=1,
            best_of=1,
            temperature=0,
            vad_filter=True,
            vad_parameters={
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 200
            },
            condition_on_previous_text=True,
            initial_prompt=INTERVIEW_GLOSSARY,
            word_timestamps=False,
        )

        completed_segments = list(segments)

        text = " ".join(
            segment.text.strip()
            for segment in completed_segments
        ).strip()

        return {
            "text": text,

            "language": info.language,

            "language_probability":
                info.language_probability,

            "segments": [
                {
                    "start": segment.start,
                    "end": segment.end,
                    "text": segment.text.strip()
                }
                for segment in completed_segments
            ]
        }