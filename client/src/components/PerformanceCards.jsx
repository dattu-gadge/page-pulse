import {
  FaBolt,
  FaClock,
  FaImage,
  FaHeading
} from "react-icons/fa";
import "../styles/performance.css";

function PerformanceCards() {
  const cards = [
    { icon: <FaBolt />, title: "SEO Score", value: "95/100" },
    { icon: <FaClock />, title: "Load Time", value: "0.82 s" },
    { icon: <FaImage />, title: "Images", value: "18" },
    { icon: <FaHeading />, title: "Headings", value: "6" },
  ];

  return (
    <div className="performance-grid">
      {cards.map((card, index) => (
        <div className="performance-card" key={index}>
          <div className="card-icon">{card.icon}</div>
          <h4>{card.title}</h4>
          <h2>{card.value}</h2>
        </div>
      ))}
    </div>
  );
}

export default PerformanceCards;