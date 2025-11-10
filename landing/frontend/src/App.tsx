import { useEffect } from "react";
import { useTheme } from "next-themes";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { LandingPage } from "./components/LandingPage";

const App = () => {
  const { setTheme } = useTheme();
  useEffect(() => {
    // Force light theme for all pages
    setTheme("light");
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
      </Routes>
    </Router>
  );
};

export default App;
