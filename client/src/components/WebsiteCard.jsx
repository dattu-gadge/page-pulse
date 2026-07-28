import "../styles/websitecard.css";

function WebsiteCard({ data }) {
  if (!data) {
    return (
      <div className="website-card">
        <h2>No Analysis Yet</h2>
        <p>Enter a website URL to analyze.</p>
      </div>
    );
  }

  return (
    <div className="website-card">
      <div className="card-header">
        <div>
          <h2>{data.pageTitle}</h2>
        </div>

        <span className="status">
          Status {data.status}
        </span>
      </div>

      <p className="description">
        {data.metaDescription}
      </p>

      <div className="card-grid">

        <div className="info-box">
          <h4>Response Time</h4>
          <span>{data.responseTime} ms</span>
        </div>

        <div className="info-box">
          <h4>H1 Tags</h4>
          <span>{data.h1Count}</span>
        </div>

        <div className="info-box">
          <h4>Missing Alt</h4>
          <span>{data.imagesMissingAlt}</span>
        </div>

        <div className="info-box">
          <h4>Word Count</h4>
          <span>{data.wordCount}</span>
        </div>

      </div>
    </div>
  );
}

export default WebsiteCard;