import { useLocation, useNavigate } from "react-router-dom";

const ACTIVE_INTERVIEW_KEY = "activeInterview";
const API_URL = "http://127.0.0.1:5000";

function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();

  const goHome = async () => {
    const savedSession = JSON.parse(localStorage.getItem(ACTIVE_INTERVIEW_KEY) || "null");
    if (location.pathname === "/interview" && savedSession?.sessionId) {
      const shouldExit = window.confirm("Are you sure you want to exit the interview?");
      if (!shouldExit) return;

      try {
        await fetch(`${API_URL}/interview-sessions/${savedSession.sessionId}/exit`, { method: "POST" });
      } catch {
        // The local interview is still intentionally exited when the backend is unavailable.
      }
      localStorage.removeItem(ACTIVE_INTERVIEW_KEY);
    }
    navigate("/");
  };

  return (
    <nav className="navbar">
      <h2>AI Interview Preparation</h2>
      <div>
        <span onClick={goHome}>Home</span>
        <span>My Interviews</span>
        <span>Profile</span>
      </div>
    </nav>
  );
}

export default Navbar;
