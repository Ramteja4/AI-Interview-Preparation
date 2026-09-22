import { useState } from "react";
import QuestionGenerator from "./QuestionGenerator";

const API_URL = "http://127.0.0.1:5000";

function ResumeUpload() {
  const [file, setFile] = useState(null);
  const [resumeId, setResumeId] = useState("");
  const [message, setMessage] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [status, setStatus] = useState("selecting");

  const handleFileChange = (event) => {
    const selectedFile = event.target.files[0];
    setFile(selectedFile || null);
    setResumeId("");
    setAnalysis(null);
    setStatus("selecting");
    setMessage("");
  };

  const uploadResume = async () => {
    if (!file) return setMessage("Please select a PDF resume.");
    setStatus("uploading");
    setMessage("");
    const formData = new FormData();
    formData.append("resume", file);
    try {
      const response = await fetch(`${API_URL}/upload-resume`, { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      setResumeId(data.resume_id);
      setStatus("uploaded");
      setMessage("Resume uploaded successfully.");
    } catch (error) {
      setStatus("selecting");
      setMessage(error.message || "Could not connect to the backend.");
    }
  };

  const handleAnalysisError = (error) => {
    setStatus("uploaded");
    setMessage(error.message || "Could not analyze the resume.");
  };

  const pollAnalysis = async (analysisId) => {
    const response = await fetch(`${API_URL}/resume-analysis/${analysisId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Analysis failed.");
    if (data.status === "completed") {
      localStorage.setItem("resumeAnalysis", JSON.stringify(data.analysis));
      setAnalysis(data.analysis);
      setStatus("completed");
      setMessage("");
      return;
    }
    if (data.status === "failed") throw new Error(data.error || "Analysis failed.");
    setMessage(data.progress || "Analyzing resume...");
    window.setTimeout(() => pollAnalysis(analysisId).catch(handleAnalysisError), 900);
  };

  const startAnalysis = async () => {
    setStatus("analyzing");
    setMessage("Extracting text from resume...");
    try {
      const response = await fetch(`${API_URL}/analyze-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume_id: resumeId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start analysis.");
      pollAnalysis(data.analysis_id).catch(handleAnalysisError);
    } catch (error) {
      handleAnalysisError(error);
    }
  };

  return (
    <div className="resume-upload">
      <h2>Upload Your Resume</h2>
      <p>Upload a PDF resume to prepare a tailored voice interview.</p>
      {status === "selecting" && <><input type="file" accept="application/pdf,.pdf" onChange={handleFileChange} />{file && <p>Selected: {file.name}</p>}<button className="primary-action" onClick={uploadResume}>Upload Resume</button></>}
      {status === "uploading" && <p className="loading-state">Uploading resume…</p>}
      {status === "uploaded" && <><p>{message || "Resume uploaded successfully."}</p><button className="primary-action" onClick={startAnalysis}>Start Analysis</button></>}
      {status === "analyzing" && <div className="loading-state" role="status"><span className="spinner" aria-hidden="true" /><p><strong>Analyzing Resume</strong><br />{message || "Preparing your interview setup..."}</p></div>}
      {status === "completed" && <QuestionGenerator analysis={analysis} />}
    </div>
  );
}

export default ResumeUpload;
