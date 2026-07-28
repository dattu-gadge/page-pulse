import { useState } from "react";

import Sidebar from "./components/Sidebar";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import SearchBar from "./components/SearchBar";
import WebsiteCard from "./components/WebsiteCard";
import ScoreCard from "./components/ScoreCard";
import PerformanceCards from "./components/PerformanceCards";
import SEOAnalysis from "./components/SEOAnalysis";

function App() {
  const [result, setResult] = useState(null);

  return (
    <div
      style={{
        display: "flex",
        background: "#050816",
        minHeight: "100vh",
      }}
    >
      <Sidebar />

      <main
        style={{
          marginLeft: "260px",
          width: "100%",
          padding: "30px",
        }}
      >
        <Navbar />

        <Hero />

        <SearchBar onResult={setResult} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gap: "25px",
            marginTop: "30px",
          }}
        >
          <WebsiteCard data={result} />
          <ScoreCard data={result} />
        </div>

        <PerformanceCards data={result} />

        <SEOAnalysis data={result} />
      </main>
    </div>
  );
}

export default App;