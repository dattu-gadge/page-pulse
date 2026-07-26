import { useState } from "react";
import "./App.css";

function App() {
  const [url, setUrl] = useState("");
  const [report, setReport] = useState(null);

  const handleAnalyze = async () => {
  if (!url) {
    alert("Please enter a URL");
    return;
  }

  try {
    const response = await fetch("https://page-pulse-lo70.onrender.com/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();
    setReport(data);
  } catch (error) {
    console.error(error);
    alert("Unable to connect to server");
  }
};

  return (
    <div className="container">
      <h1>🌐 Page Pulse</h1>
      <p>Website SEO & Performance Analyzer</p>

      <input
        type="text"
        placeholder="https://example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />

      <button onClick={handleAnalyze}>
        Analyze Website
      </button>

      <div className="report">
        <h2>Report</h2>

        <p><strong>HTTP Status:</strong> {report?.status ?? "--"}</p>
        <p><strong>Response Time:</strong> {report?.responseTime ?? "--"}</p>
        <p><strong>Page Title:</strong> {report?.pageTitle ?? "--"}</p>
        <p><strong>Meta Description:</strong> {report?.metaDescription || "Not Found"}</p>
        <p><strong>H1 Count:</strong> {report?.h1Count ?? "--"}</p>
        <p><strong>Images Missing Alt:</strong> {report?.imagesMissingAlt ?? "--"}</p>
        <p><strong>Word Count:</strong> {report?.wordCount ?? "--"}</p>
      </div>

      <footer>
        Built for Digital Heroes Training Task
      </footer>
    </div>
  );
}

export default App;