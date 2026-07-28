import "../styles/seoanalysis.css";

function SEOAnalysis() {
  const seoData = [
    { title: "Title Tag", value: 95 },
    { title: "Meta Description", value: 85 },
    { title: "Heading Structure", value: 90 },
    { title: "Image Alt Tags", value: 75 },
    { title: "Internal Links", value: 88 },
    { title: "Mobile Friendly", value: 96 },
  ];

  return (
    <section className="seo-analysis">
      <div className="seo-header">
        <h2>SEO Analysis</h2>
        <p>Detailed optimization report</p>
      </div>

      {seoData.map((item, index) => (
        <div className="seo-item" key={index}>
          <div className="seo-title">
            <span>{item.title}</span>
            <span>{item.value}%</span>
          </div>

          <div className="progress">
            <div
              className="progress-fill"
              style={{ width: `${item.value}%` }}
            ></div>
          </div>
        </div>
      ))}
    </section>
  );
}

export default SEOAnalysis;