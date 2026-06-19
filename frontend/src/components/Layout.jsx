import { NavLink, Outlet } from 'react-router-dom';
import DemoTour from './DemoTour';

const navItems = [
  { path: '/', icon: '🏠', label: 'Command Center' },
  { path: '/predict', icon: '⚡', label: 'Predictive Intel' },
  { path: '/cctv', icon: '📹', label: 'CCTV Monitor' },
  { path: '/enforce', icon: '🏳️', label: 'Enforce Optimizer' },
  { path: '/simulate', icon: '⚙️', label: 'What-If Simulator' },
  { path: '/analytics', icon: '📊', label: 'Analytics & ML' },
];

export default function Layout() {
  const startDemo = () => {
    sessionStorage.setItem('gridlock_demo_step', '1');
    window.location.hash = ''; // reset hash if any
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">P</div>
          <div>
            <h1>ParkSense AI</h1>
          </div>
          <span className="logo-badge">v1.0</span>
        </div>
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Navigation</div>
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `nav-item ${isActive ? 'active' : ''}`
              }
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
          
          <div className="sidebar-section-label" style={{ marginTop: '12px' }}>
            Interactive Demo
          </div>
          <button
            onClick={startDemo}
            className="nav-item"
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'linear-gradient(135deg, var(--color-primary-dim), var(--color-ai-dim))',
              border: '1px solid var(--color-primary)',
              borderRadius: '6px',
              color: 'var(--color-primary)',
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              textAlign: 'center'
            }}
          >
            <span>⚡ Start Demo Tour</span>
          </button>

          <div className="sidebar-section-label" style={{ marginTop: '16px' }}>
            System
          </div>
          <div
            className="nav-item"
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              cursor: 'default',
              padding: '4px 16px',
            }}
          >
            <span style={{ fontSize: '0.7rem' }}>Powered by</span>
            <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
              LightGBM + H3
            </span>
          </div>
          <div
            className="nav-item"
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              cursor: 'default',
              padding: '4px 16px',
            }}
          >
            <span style={{ fontSize: '0.7rem' }}>Data</span>
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
              298K Records
            </span>
          </div>
        </nav>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
      <DemoTour />
    </div>
  );
}
