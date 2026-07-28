import {
  FaHome,
  FaSearch,
  FaChartLine,
  FaFileAlt,
  FaCog,
  FaGlobe,
} from "react-icons/fa";

import "../styles/sidebar.css";

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="logo">
        <FaGlobe className="logo-icon" />
        <div>
          <h2>Page Pulse</h2>
          <p>SEO Analyzer</p>
        </div>
      </div>

      <nav>
        <ul>
          <li className="active">
            <FaHome />
            <span>Dashboard</span>
          </li>

          <li>
            <FaSearch />
            <span>SEO Audit</span>
          </li>

          <li>
            <FaChartLine />
            <span>Performance</span>
          </li>

          <li>
            <FaFileAlt />
            <span>Reports</span>
          </li>

          <li>
            <FaCog />
            <span>Settings</span>
          </li>
        </ul>
      </nav>

      <div className="upgrade-card">
        <h3>Premium</h3>
        <p>Unlock advanced SEO insights.</p>

        <button>Upgrade</button>
      </div>
    </aside>
  );
}

export default Sidebar;