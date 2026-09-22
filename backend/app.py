from flask import Flask, request, jsonify
from flask_cors import CORS
from pypdf import PdfReader
import os
from pathlib import Path
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from werkzeug.utils import secure_filename
from resume_analyzer import analyze_resume
from question_generator import generate_questions
from answer_evaluator import evaluate_answer
from final_report import generate_final_report
from speech_to_text import transcribe_audio

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = Path(__file__).resolve().parent / "uploads"
AUDIO_FOLDER = UPLOAD_FOLDER / "interview_audio"

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(AUDIO_FOLDER, exist_ok=True)

# The interview UI never waits on these jobs. Use Redis/Celery or a database
# backed queue when deploying across multiple application processes.
INTERVIEW_SESSIONS = {}
INTERVIEW_LOCK = Lock()
INTERVIEW_EXECUTOR = ThreadPoolExecutor(
    max_workers=int(os.getenv("INTERVIEW_WORKERS", "2"))
)
RESUME_ANALYSES = {}
RESUME_FILES = {}
RESUME_ANALYSIS_LOCK = Lock()
RESUME_ANALYSIS_EXECUTOR = ThreadPoolExecutor(
    max_workers=int(os.getenv("RESUME_ANALYSIS_WORKERS", "2"))
)


def _run_resume_analysis(analysis_id, resume_path):
    """Extract and analyse a resume outside the request thread."""
    try:
        reader = PdfReader(resume_path)
        resume_text = "\n".join(
            page.extract_text() or "" for page in reader.pages
        ).strip()
        if not resume_text:
            raise ValueError("No readable text was found in this PDF.")

        with RESUME_ANALYSIS_LOCK:
            RESUME_ANALYSES[analysis_id]["status"] = "analyzing"
            RESUME_ANALYSES[analysis_id]["progress"] = "Analyzing resume with AI"

        analysis = analyze_resume(resume_text)

        with RESUME_ANALYSIS_LOCK:
            RESUME_ANALYSES[analysis_id].update({
                "status": "completed",
                "progress": "Resume analysis complete",
                "analysis": analysis,
            })
    except Exception as error:
        with RESUME_ANALYSIS_LOCK:
            RESUME_ANALYSES[analysis_id].update({
                "status": "failed",
                "progress": "Resume analysis failed",
                "error": str(error),
            })


def _session_or_404(session_id):
    with INTERVIEW_LOCK:
        session = INTERVIEW_SESSIONS.get(session_id)
    if not session:
        return None
    return session


def _serialize_attempt(attempt):
    return {
        "id": attempt["id"],
        "question_index": attempt["question_index"],
        "question": attempt["question"],
        "topic": attempt.get("topic"),
        "difficulty": attempt.get("difficulty"),
        "audio_reference": attempt["audio_reference"],
        "status": attempt["status"],
        "answer": attempt.get("answer", ""),
        "evaluation": attempt.get("evaluation"),
        "error": attempt.get("error"),
    }


def _build_summary(attempts):
    completed = [attempt for attempt in attempts if attempt["status"] == "completed"]
    if not completed:
        return None

    def average(field):
        return round(sum(float(item["evaluation"].get(field, 0)) for item in completed) / len(completed), 1)

    return {
        "attempted_questions": len(attempts),
        "evaluated_questions": len(completed),
        "overall_score": average("score"),
        "technical_score": average("technical_score"),
        "communication_score": average("communication_score"),
        "relevance_score": average("relevance_score"),
    }


def _process_interview_answer(session_id, attempt_id, audio_path):
    """Run STT and LLM evaluation without holding the request/UI thread."""
    try:
        transcription = transcribe_audio(str(audio_path))

        with INTERVIEW_LOCK:
            session = INTERVIEW_SESSIONS.get(session_id)
            if not session:
                return
            attempt = next(item for item in session["attempts"] if item["id"] == attempt_id)
            attempt["answer"] = transcription["text"]
            attempt["transcription"] = transcription
            question = attempt["question"]
            role = session["role"]

        evaluation = evaluate_answer(question, transcription["text"], role)

        with INTERVIEW_LOCK:
            attempt["evaluation"] = evaluation
            attempt["status"] = "completed"
    except Exception as error:
        with INTERVIEW_LOCK:
            session = INTERVIEW_SESSIONS.get(session_id)
            if session:
                attempt = next((item for item in session["attempts"] if item["id"] == attempt_id), None)
                if attempt:
                    attempt["status"] = "failed"
                    attempt["error"] = str(error)
    finally:
        # Audio is intentionally retained as the stored voice-answer reference.
        pass


@app.route("/interview-sessions", methods=["POST"])
def create_interview_session():
    data = request.get_json() or {}
    questions = data.get("questions")
    role = data.get("role")

    if not isinstance(questions, list) or not questions:
        return jsonify({"error": "Interview questions are required"}), 400
    if not role:
        return jsonify({"error": "Interview role is required"}), 400

    session_id = uuid4().hex
    with INTERVIEW_LOCK:
        INTERVIEW_SESSIONS[session_id] = {
            "id": session_id,
            "role": role,
            "questions": questions,
            "attempts": [],
            "finished": False,
        }
    return jsonify({"session_id": session_id}), 201


@app.route("/interview-sessions/<session_id>/answers", methods=["POST"])
def submit_interview_answer(session_id):
    session = _session_or_404(session_id)
    if not session:
        return jsonify({"error": "Interview session not found"}), 404
    if "audio" not in request.files:
        return jsonify({"error": "No audio file uploaded"}), 400

    audio = request.files["audio"]
    try:
        question_index = int(request.form.get("question_index", ""))
    except ValueError:
        return jsonify({"error": "A valid question index is required"}), 400

    if not 0 <= question_index < len(session["questions"]):
        return jsonify({"error": "Question index is out of range"}), 400
    if not audio.filename:
        return jsonify({"error": "No audio file selected"}), 400

    attempt_id = uuid4().hex
    extension = Path(audio.filename).suffix.lower() or ".webm"
    audio_path = AUDIO_FOLDER / f"{attempt_id}{extension}"
    audio.save(audio_path)
    question = session["questions"][question_index]
    attempt = {
        "id": attempt_id,
        "question_index": question_index,
        "question": question.get("question", str(question)),
        "topic": question.get("topic"),
        "difficulty": question.get("difficulty"),
        "audio_reference": str(audio_path.relative_to(UPLOAD_FOLDER)),
        "status": "processing",
    }

    with INTERVIEW_LOCK:
        session["attempts"].append(attempt)

    INTERVIEW_EXECUTOR.submit(_process_interview_answer, session_id, attempt_id, audio_path)
    return jsonify({"attempt_id": attempt_id, "status": "processing"}), 202


@app.route("/interview-sessions/<session_id>/finish", methods=["POST"])
def finish_interview_session(session_id):
    session = _session_or_404(session_id)
    if not session:
        return jsonify({"error": "Interview session not found"}), 404
    with INTERVIEW_LOCK:
        session["finished"] = True
    return jsonify({"message": "Interview marked as finished"})


@app.route("/interview-sessions/<session_id>", methods=["GET"])
def get_interview_session(session_id):
    session = _session_or_404(session_id)
    if not session:
        return jsonify({"error": "Interview session not found"}), 404

    with INTERVIEW_LOCK:
        attempts = [_serialize_attempt(item) for item in session["attempts"]]
        pending_count = sum(item["status"] == "processing" for item in session["attempts"])
        summary = _build_summary(session["attempts"]) if session["finished"] and pending_count == 0 else None
        return jsonify({
            "session_id": session_id,
            "role": session["role"],
            "questions": session["questions"],
            "finished": session["finished"],
            "pending_count": pending_count,
            "attempts": attempts,
            "summary": summary,
        })


@app.route("/interview-sessions/<session_id>/exit", methods=["POST"])
def exit_interview_session(session_id):
    session = _session_or_404(session_id)
    if not session:
        return jsonify({"error": "Interview session not found"}), 404
    with INTERVIEW_LOCK:
        session["finished"] = True
        session["exited"] = True
    return jsonify({"message": "Interview exited"})


@app.route("/")
def home():
    return {
        "message": "AI Interview System Backend Running"
    }


@app.route("/upload-resume", methods=["POST"])
def upload_resume():

    # Check if file exists
    if "resume" not in request.files:
        return jsonify({
            "error": "No resume file uploaded"
        }), 400

    file = request.files["resume"]

    # Check filename
    if file.filename == "":
        return jsonify({
            "error": "No file selected"
        }), 400

    # Check PDF
    if not file.filename.lower().endswith(".pdf"):
        return jsonify({
            "error": "Only PDF files are allowed"
        }), 400

    resume_id = uuid4().hex
    filename = secure_filename(file.filename) or "resume.pdf"
    file_path = app.config["UPLOAD_FOLDER"] / f"{resume_id}-{filename}"
    file.save(file_path)
    with RESUME_ANALYSIS_LOCK:
        RESUME_FILES[resume_id] = file_path

    return jsonify({
        "message": "Resume uploaded successfully",
        "filename": filename,
        "resume_id": resume_id,
    })


@app.route("/analyze-resume", methods=["POST"])
def analyze_resume_route():
    data = request.get_json() or {}
    resume_id = data.get("resume_id")
    if not resume_id:
        return jsonify({"error": "A resume upload is required"}), 400

    with RESUME_ANALYSIS_LOCK:
        resume_path = RESUME_FILES.get(resume_id)
    if not resume_path or not resume_path.is_file():
        return jsonify({"error": "Uploaded resume was not found"}), 404

    analysis_id = uuid4().hex
    with RESUME_ANALYSIS_LOCK:
        RESUME_ANALYSES[analysis_id] = {
            "status": "extracting",
            "progress": "Extracting text from resume",
        }
    RESUME_ANALYSIS_EXECUTOR.submit(_run_resume_analysis, analysis_id, resume_path)
    return jsonify({"analysis_id": analysis_id, "status": "extracting"}), 202


@app.route("/resume-analysis/<analysis_id>", methods=["GET"])
def get_resume_analysis(analysis_id):
    with RESUME_ANALYSIS_LOCK:
        result = RESUME_ANALYSES.get(analysis_id)
        if result is None:
            return jsonify({"error": "Resume analysis was not found"}), 404
        response = dict(result)
    return jsonify(response)



@app.route("/generate-questions", methods=["POST"])
def generate_questions_route():

    data = request.get_json()

    if not data:
        return jsonify({
            "error": "Request data is required"
        }), 400

    resume_analysis = data.get("resume_analysis")
    role = data.get("role")
    difficulty = data.get("difficulty", "medium")

    if not resume_analysis:
        return jsonify({
            "error": "Resume analysis is required"
        }), 400

    if not role:
        return jsonify({
            "error": "Interview role is required"
        }), 400

    try:

        questions = generate_questions(
            resume_analysis,
            role,
            difficulty
        )

        return jsonify(questions)

    except Exception as e:

        print("Question generation error:", e)

        return jsonify({
            "error": "Failed to generate questions"
        }), 500


@app.route("/evaluate-answer", methods=["POST"])
def evaluate_answer_api():
    try:
        data = request.get_json()

        question = data.get("question")
        answer = data.get("answer")
        role = data.get("role")

        if not question or not answer or not role:
            return jsonify({
                "error": "Question, answer and role are required"
            }), 400

        evaluation = evaluate_answer(
            question,
            answer,
            role
        )

        return jsonify(evaluation)

    except Exception as e:
        return jsonify({
            "error": str(e)
        }), 500



@app.route("/final-report", methods=["POST"])
def final_report_api():

    try:

        data = request.get_json()

        results = data.get("results")
        role = data.get("role")

        if not results:
            return jsonify({
                "error": "Interview results are required"
            }), 400

        if not role:
            return jsonify({
                "error": "Interview role is required"
            }), 400

        report = generate_final_report(
            results,
            role
        )

        return jsonify(report)

    except Exception as e:

        print("Final report error:", e)

        return jsonify({
            "error": str(e)
        }), 500



@app.route("/speech-to-text", methods=["POST"])
def speech_to_text():
    try:
        if "audio" not in request.files:
            return jsonify({"error": "No audio file uploaded"}), 400

        audio = request.files["audio"]

        if audio.filename == "":
            return jsonify({"error": "No audio file selected"}), 400

        extension = Path(audio.filename).suffix.lower() or ".webm"
        audio_path = app.config["UPLOAD_FOLDER"] / f"audio-{uuid4().hex}{extension}"

        try:
            audio.save(audio_path)
            return jsonify(transcribe_audio(str(audio_path)))
        finally:
            audio_path.unlink(missing_ok=True)

    except Exception as e:
        print("Speech-to-text error:", str(e))

        return jsonify({
            "error": str(e)
        }), 500

if __name__ == "__main__":
    app.run(debug=True)
