import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { path: '/', icon: '\u2302', label: 'Command Center' },
  { path: '/predict', icon: '\u26A1', label: 'Predictive Intel' },
  { path: '/enforce', icon: '\u2691', label: 'Enforce Optimizer' },
  { path: '/simulate', icon: '\u2699', label: 'What-If Simulator' },
  { path: '/analytics', icon: '\u2261', label: 'Analytics & ML' },
];

export default function Layout() {
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
    </div>
  );
}
