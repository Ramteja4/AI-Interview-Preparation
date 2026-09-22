import { useState } from "react";
import ResumeUpload from "../components/ResumeUpload";

function Home() {

 const [role, setRole] = useState("");

  const roles = [
    "Python Developer",
    "C++ Developer",
    "Machine Learning Engineer",
    "React Developer"
  ];

  const startInterview = () => {

    if (!role) {
      alert("Please select an interview role");
      return;
    }

    alert(`Starting ${role} interview`);
  };

  return (
    <div className="home">

      {/* <h1>AI Interview Preparation</h1>

      <p>
        Practice interviews with an AI interviewer
        and improve your technical skills.
      </p>

      <h2>Choose Interview Role</h2> */}

      {/* <div className="roles">

        {roles.map((item) => (

          <button
            key={item}
            className={role === item ? "selected" : ""}
            onClick={() => setRole(item)}
          >
            {item}
          </button>

        ))}

      </div> */}
{/* 
      <button
        className="start-button"
        onClick={startInterview}
      >
        Start Interview
      </button>  */}

      <ResumeUpload />

    </div>
  );
}

export default Home;