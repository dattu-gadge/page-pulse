import {
  CircularProgressbar,
  buildStyles,
} from "react-circular-progressbar";

import "react-circular-progressbar/dist/styles.css";
import "../styles/scorecard.css";

function ScoreCard({ data }) {

  let score = 0;

  if (data) {
    score = 100;

    if (data.metaDescription === "Not Found")
      score -= 20;

    if (data.h1Count === 0)
      score -= 20;

    score -= data.imagesMissingAlt;

    if (score < 0)
      score = 0;
  }

  return (
    <div className="score-card">
      <h2>SEO Score</h2>

      <div className="progress-wrapper">
        <CircularProgressbar
          value={score}
          text={`${score}%`}
          styles={buildStyles({
            pathColor: "#2563EB",
            textColor: "#fff",
            trailColor: "#1E293B",
          })}
        />
      </div>
    </div>
  );
}

export default ScoreCard;