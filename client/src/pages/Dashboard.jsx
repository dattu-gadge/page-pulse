import Sidebar from '../components/Sidebar'
import Navbar from '../components/Navbar'
import Hero from '../components/Hero'
import SearchBar from '../components/SearchBar'
import WebsiteCard from '../components/WebsiteCard'
import PerformanceCards from '../components/PerformanceCards'
import SEOAnalysis from '../components/SEOAnalysis'
import Footer from '../components/Footer'
import '../styles/dashboard.css'

function Dashboard() {
  return (
    <div className="dashboard-page">
      <Sidebar />
      <main className="dashboard-main">
        <Navbar />
        <Hero />
        <SearchBar />

        <section className="dashboard-content">
          <div className="overview-grid">
            <WebsiteCard title="Page Status" value="200 OK" description="Server response is healthy." />
            <WebsiteCard title="Uptime" value="99.98%" description="Near-perfect availability." />
            <WebsiteCard title="Mobile Score" value="92" description="Mobile experience is strong." />
          </div>

          <PerformanceCards />
          <SEOAnalysis />
        </section>

        <Footer />
      </main>
    </div>
  )
}

export default Dashboard
