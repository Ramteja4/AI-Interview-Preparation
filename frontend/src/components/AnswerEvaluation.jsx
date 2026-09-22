import { useEffect, useRef, useState } from "react";
import "./AnswerEvaluation.css";

const API_URL = "http://127.0.0.1:5000";
const MAX_RECORDING_SECONDS = 300;
const ACTIVE_INTERVIEW_KEY = "activeInterview";

function formatRemainingTime(totalSeconds) {
  const minutes = Math.floor(Math.max(totalSeconds, 0) / 60);
  const seconds = Math.max(totalSeconds, 0) % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getSavedInterview() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_INTERVIEW_KEY) || "null");
  } catch {
    localStorage.removeItem(ACTIVE_INTERVIEW_KEY);
    return null;
  }
}

function AnswerEvaluation() {
  const [questions, setQuestions] = useState([]);
  const [role, setRole] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [submittingCount, setSubmittingCount] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [report, setReport] = useState(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const sessionIdRef = useRef("");

  useEffect(() => {
    let active = true;

    const initializeInterview = async () => {
      try {
        const savedInterview = getSavedInterview();
        if (savedInterview?.sessionId) {
          const savedSessionResponse = await fetch(`${API_URL}/interview-sessions/${savedInterview.sessionId}`);
          const savedSession = await savedSessionResponse.json();
          if (savedSessionResponse.ok && Array.isArray(savedSession.questions)) {
            const resumeIndex = Math.min(
              Math.max(Number(savedInterview.currentQuestionIndex) || 0, 0),
              savedSession.questions.length
            );
            if (active) {
              sessionIdRef.current = savedSession.session_id;
              setSessionId(savedSession.session_id);
              setRole(savedSession.role || savedInterview.role || "");
              setQuestions(savedSession.questions);
              setCurrentQuestion(resumeIndex);
              if (savedSession.finished) {
                setFinishing(true);
              }
            }
            return;
          }
          localStorage.removeItem(ACTIVE_INTERVIEW_KEY);
        }

        const selectedRole = localStorage.getItem("interviewRole") || "Machine Learning Engineer";
        let savedQuestions = JSON.parse(localStorage.getItem("interviewQuestions") || "[]");

        if (!Array.isArray(savedQuestions) || savedQuestions.length === 0) {
          const analysis = JSON.parse(localStorage.getItem("resumeAnalysis") || "null");
          if (!analysis) {
            throw new Error("Please upload and analyze a resume before starting the interview.");
          }

          const questionsResponse = await fetch(`${API_URL}/generate-questions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              resume_analysis: analysis,
              role: selectedRole,
              difficulty: localStorage.getItem("interviewDifficulty") || "medium",
            }),
          });
          const questionsData = await questionsResponse.json();
          if (!questionsResponse.ok || !questionsData.questions?.length) {
            throw new Error(questionsData.error || "Unable to generate interview questions.");
          }
          savedQuestions = questionsData.questions;
          localStorage.setItem("interviewQuestions", JSON.stringify(savedQuestions));
        }

        const sessionResponse = await fetch(`${API_URL}/interview-sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questions: savedQuestions, role: selectedRole }),
        });
        const sessionData = await sessionResponse.json();
        if (!sessionResponse.ok) {
          throw new Error(sessionData.error || "Unable to start the interview session.");
        }

        if (active) {
          sessionIdRef.current = sessionData.session_id;
          setSessionId(sessionData.session_id);
          setRole(selectedRole);
          setQuestions(savedQuestions);
          setCurrentQuestion(0);
          localStorage.setItem(ACTIVE_INTERVIEW_KEY, JSON.stringify({
            sessionId: sessionData.session_id,
            role: selectedRole,
            currentQuestionIndex: 0,
          }));
        }
      } catch (initializationError) {
        if (active) {
          setError(initializationError.message || "Unable to start interview.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    initializeInterview();
    return () => {
      active = false;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      stopMediaTracks();
    };
  }, []);

  useEffect(() => {
    if (!sessionId || questions.length === 0 || report) return;
    localStorage.setItem(ACTIVE_INTERVIEW_KEY, JSON.stringify({
      sessionId,
      role,
      currentQuestionIndex: currentQuestion,
      answeredQuestionIndexes: Array.from({ length: currentQuestion }, (_, index) => index),
    }));
  }, [sessionId, role, questions, currentQuestion, report]);

  useEffect(() => {
    if (!finishing || !sessionId) {
      return undefined;
    }

    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`${API_URL}/interview-sessions/${sessionId}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Unable to retrieve interview results.");
        }
        if (active && data.pending_count === 0) {
          setReport(data);
          setFinishing(false);
          localStorage.removeItem(ACTIVE_INTERVIEW_KEY);
        }
      } catch (pollError) {
        if (active) {
          setError(pollError.message || "Unable to retrieve interview results.");
          setFinishing(false);
        }
      }
    };

    poll();
    const intervalId = window.setInterval(poll, 1000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [finishing, sessionId]);

  const getSupportedMimeType = () => {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  };

  function stopMediaTracks() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const submitAnswer = async (audioBlob, questionIndex) => {
    setSubmittingCount((count) => count + 1);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "interview-answer.webm");
      formData.append("question_index", String(questionIndex));

      const response = await fetch(
        `${API_URL}/interview-sessions/${sessionIdRef.current}/answers`,
        { method: "POST", body: formData }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to submit voice answer.");
      }
    } catch (submissionError) {
      setError(submissionError.message || "Unable to submit voice answer.");
    } finally {
      setSubmittingCount((count) => Math.max(0, count - 1));
    }
  };

  const startRecording = async () => {
    if (isRecording || isStartingRecording || !sessionIdRef.current || currentQuestion >= questions.length) {
      return;
    }

    try {
      setIsStartingRecording(true);
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
      });

      const mimeType = getSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks = [];
      const questionIndex = currentQuestion;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => {
        setError("An error occurred while recording audio.");
        if (recorder.state === "recording") {
          recorder.stop();
        }
      };
      recorder.onstart = () => {
        setIsStartingRecording(false);
        setRecordingSeconds(0);
        setIsRecording(true);
        recordingTimerRef.current = window.setInterval(() => {
          setRecordingSeconds((seconds) => {
            const nextSeconds = seconds + 1;
            if (nextSeconds >= MAX_RECORDING_SECONDS) {
              setError("The maximum recording time was reached. Your answer is being submitted.");
              stopRecording();
            }
            return Math.min(nextSeconds, MAX_RECORDING_SECONDS);
          });
        }, 1000);
      };
      recorder.onstop = () => {
        stopMediaTracks();
        mediaRecorderRef.current = null;
        setIsStartingRecording(false);
        setIsRecording(false);
        const audioBlob = new Blob(chunks, { type: mimeType || "audio/webm" });
        if (audioBlob.size > 0) {
          // Deliberately not awaited: the next question is shown immediately.
          submitAnswer(audioBlob, questionIndex);
          setCurrentQuestion((index) => index + 1);
        }
      };

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.start();
    } catch (recordingError) {
      stopMediaTracks();
      mediaRecorderRef.current = null;
      setIsStartingRecording(false);
      setIsRecording(false);
      setError(recordingError.message || "Microphone permission is required.");
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
    }
  };

  const finishInterview = async () => {
    if (isRecording || submittingCount > 0) {
      return;
    }
    try {
      setError("");
      const response = await fetch(`${API_URL}/interview-sessions/${sessionId}/finish`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to finish interview.");
      }
      setFinishing(true);
    } catch (finishError) {
      setError(finishError.message || "Unable to finish interview.");
    }
  };

  if (loading) {
    return <div className="interview-loading"><h1>Preparing your voice interview...</h1></div>;
  }

  if (error && !sessionId) {
    return <div className="interview-error"><h1>Unable to start interview</h1><p>{error}</p></div>;
  }

  if (report) {
    const summary = report.summary;
    return (
      <div className="interview-container final-report">
        <h1>Interview Completed</h1>
        <p className="report-role">Role: <strong>{role}</strong></p>
        {summary ? (
          <>
            <ScoreCards scores={summary} />
            <p>{summary.evaluated_questions} attempted answer(s) were evaluated. Unanswered questions were not scored.</p>
            <button className="primary-button" onClick={() => setShowAnswers((show) => !show)}>
              {showAnswers ? "Hide Answers" : "Check Answers"}
            </button>
            {showAnswers && <AttemptedAnswers attempts={report.attempts} />}
          </>
        ) : (
          <p>No answer could be evaluated. Unanswered questions were not scored.</p>
        )}
      </div>
    );
  }

  const current = questions[currentQuestion];
  const allQuestionsAnswered = currentQuestion >= questions.length;

  return (
    <div className="interview-container">
      <h1>AI Voice Interview</h1>
      <p><strong>Role:</strong> {role}</p>
      {!allQuestionsAnswered ? (
        <>
          <div className="progress-text">Question {currentQuestion + 1} of {questions.length}</div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${(currentQuestion / questions.length) * 100}%` }} /></div>
          <div className="question-section"><h2>Interview Question</h2><div className="question-box">{current.question}</div></div>
          <button
            type="button"
            className={`voice-answer-button ${isRecording ? "recording" : ""}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isStartingRecording}
          >
            {isStartingRecording ? "Starting microphone…" : isRecording ? `Stop & Submit Answer (${recordingSeconds}s)` : "Start Answering"}
          </button>
          <p className="voice-help-text">
            {isRecording
              ? `Recording continues until you submit. Time remaining: ${formatRemainingTime(MAX_RECORDING_SECONDS - recordingSeconds)}.`
              : `Press Start Answering, then Stop & Submit Answer when you have finished. Maximum recording time: ${Math.floor(MAX_RECORDING_SECONDS / 60)} minutes.`}
          </p>
        </>
      ) : (
        <div className="question-section"><h2>All questions have been answered.</h2><p>You may finish now, or finish early at any point using the button below.</p></div>
      )}

      {submittingCount > 0 && <p className="recording-status transcribing">Submitting voice answer… continue with the next question.</p>}
      {error && <div className="error-message">{error}</div>}
      <button className="primary-button finish-button" onClick={finishInterview} disabled={isRecording || submittingCount > 0 || finishing}>
        {finishing ? "Finishing interview and processing attempted answers..." : "Finish Interview"}
      </button>
    </div>
  );
}

function ScoreCards({ scores }) {
  return <div className="score-grid">
    <ScoreCard title="Overall" score={scores.overall_score} />
    <ScoreCard title="Technical" score={scores.technical_score} />
    <ScoreCard title="Communication" score={scores.communication_score} />
    <ScoreCard title="Relevance" score={scores.relevance_score} />
  </div>;
}

function ScoreCard({ title, score }) {
  return <div className="score-card"><h3>{title}</h3><div className="score-value">{score}/10</div></div>;
}

function AttemptedAnswers({ attempts }) {
  return <div className="attempted-answers">
    <h2 className="results-heading">Attempted Answers</h2>
    {attempts.map((attempt, index) => (
      <div className="question-result-card" key={attempt.id}>
        <h3>Question {index + 1}</h3>
        <p><strong>Question</strong></p><p>{attempt.question}</p>
        {attempt.status === "completed" ? <>
          <p><strong>Your Answer</strong></p><p className="preserved-text">{attempt.answer}</p>
          <p><strong>Evaluation</strong></p><p>{attempt.evaluation.feedback}</p>
          {attempt.evaluation.strengths?.length > 0 && <><p><strong>Strengths</strong></p><ul>{attempt.evaluation.strengths.map((strength, strengthIndex) => <li key={strengthIndex}>{strength}</li>)}</ul></>}
          {attempt.evaluation.weaknesses?.length > 0 && <><p><strong>Areas to improve</strong></p><ul>{attempt.evaluation.weaknesses.map((weakness, weaknessIndex) => <li key={weaknessIndex}>{weakness}</li>)}</ul></>}
          <ScoreCards scores={{
            overall_score: attempt.evaluation.score,
            technical_score: attempt.evaluation.technical_score,
            communication_score: attempt.evaluation.communication_score,
            relevance_score: attempt.evaluation.relevance_score,
          }} />
          <p><strong>Feedback</strong></p><p>{attempt.evaluation.feedback}</p>
          {attempt.evaluation.improvement && <><p><strong>How to improve</strong></p><p>{attempt.evaluation.improvement}</p></>}
        </> : <p>Processing failed: {attempt.error || "No transcription was produced."}</p>}
      </div>
    ))}
  </div>;
}

export default AnswerEvaluation;
