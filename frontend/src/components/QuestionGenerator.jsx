import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_URL = "http://127.0.0.1:5000";
const ROLE_SUGGESTIONS = ["Software Engineer", "Data Scientist", "AI Engineer", "Machine Learning Engineer", "Data Analyst", "Web Developer", "DevOps Engineer", "Product Manager", "Frontend Developer", "Backend Developer", "Cloud Engineer", "Cybersecurity Analyst"];

function QuestionGenerator({ analysis }) {
  const [role, setRole] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const suggestions = useMemo(() => ROLE_SUGGESTIONS.filter((item) => item.toLowerCase().includes(role.toLowerCase()) && item.toLowerCase() !== role.toLowerCase()), [role]);

  const startInterview = async () => {
    const selectedRole = role.trim();
    if (!selectedRole) return setError("Enter the role you want to practice for.");
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/generate-questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume_analysis: analysis, role: selectedRole, difficulty }),
      });
      const data = await response.json();
      if (!response.ok || !data.questions?.length) throw new Error(data.error || "Unable to generate interview questions.");
      localStorage.setItem("interviewQuestions", JSON.stringify(data.questions));
      localStorage.setItem("interviewRole", selectedRole);
      localStorage.setItem("interviewDifficulty", difficulty);
      navigate("/interview");
    } catch (requestError) {
      setError(requestError.message || "Could not connect to the backend.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="question-generator" aria-labelledby="interview-setup-heading">
      <h2 id="interview-setup-heading">Interview Setup</h2>
      <label htmlFor="interview-role">Role</label>
      <input id="interview-role" type="text" value={role} onChange={(event) => setRole(event.target.value)} placeholder="Enter any job role" autoComplete="off" />
      {role && suggestions.length > 0 && <ul className="role-suggestions" role="listbox">{suggestions.map((suggestion) => <li key={suggestion}><button type="button" onClick={() => setRole(suggestion)}>{suggestion}</button></li>)}</ul>}
      <label htmlFor="difficulty">Difficulty</label>
      <select id="difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
      {error && <p className="form-error">{error}</p>}
      <button className="primary-action" onClick={startInterview} disabled={loading}>{loading ? "Generating Questions…" : "Start Interview"}</button>
    </section>
  );
}

export default QuestionGenerator;
