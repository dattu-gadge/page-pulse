import { FaBell, FaMoon, FaUserCircle } from "react-icons/fa";
import "../styles/navbar.css";

function Navbar() {
  return (
    <header className="navbar">
      <div className="navbar-left">
        <h2>Dashboard</h2>
        <p>Welcome back 👋</p>
      </div>

      <div className="navbar-right">
        <button className="icon-btn">
          <FaMoon />
        </button>

        <button className="icon-btn">
          <FaBell />
        </button>

        <div className="profile">
          <FaUserCircle className="profile-icon" />
          <div>
            <h4>Dattu Gadge</h4>
            <span>Developer</span>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Navbar;