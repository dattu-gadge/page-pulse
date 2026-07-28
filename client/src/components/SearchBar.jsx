import { useState } from "react";
import axios from "axios";
import { FaSearch } from "react-icons/fa";
import "../styles/searchbar.css";

function SearchBar({ onResult }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!url) return;

    try {
      setLoading(true);

      const res = await axios.post(
        "http://localhost:5000/api/analyze",
        { url }
      );

      onResult(res.data);
    } catch (err) {
      alert("Analysis failed");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="search-container">
      <div className="search-box">
        <FaSearch className="search-icon" />

        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
        />

        <button onClick={handleAnalyze}>
          {loading ? "Analyzing..." : "Analyze Website"}
        </button>
      </div>
    </div>
  );
}

export default SearchBar;