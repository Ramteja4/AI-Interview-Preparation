


import { BrowserRouter, Routes, Route } from "react-router-dom";

import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import AnswerEvaluation from "./components/AnswerEvaluation";

import "./App.css";

function App() {
  return (
    <BrowserRouter>

      <Navbar />

      <Routes>

        {/* Home Page */}
        <Route
          path="/"
          element={<Home />}
        />

        {/* AI Interview Page */}
        <Route
          path="/interview"
          element={<AnswerEvaluation />}
        />

      </Routes>

    </BrowserRouter>
  );
}

export default App;