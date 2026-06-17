import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

export default function FieldPortal() {
  const [alerts, setAlerts] = useState([]);
  const [clearingId, setClearingId] = useState(null);
  const [notification, setNotification] = useState(null);
  const [recentCleared, setRecentCleared] = useState([]);

  // Fetch alerts on load and poll every 3 seconds for new dispatches
  const fetchAlerts = async (silent = false) => {
    try {
      const res = await fetch('/api/dispatch/alerts');
      if (res.ok) {
        const data = await res.json();
        
        // Detect if a new alert was added to show a phone notification banner
        if (!silent && alerts.length > 0 && data.length > alerts.length) {
          const newAlert = data[0];
          setNotification(`🚨 NEW DISPATCH: ${newAlert.type} in ${newAlert.location}`);
          setTimeout(() => setNotification(null), 5000);
        }
        setAlerts(data);
      }
    } catch (err) {
      console.error("Failed to load dispatch alerts", err);
    }
  };

  useEffect(() => {
    fetchAlerts(true);
    const interval = setInterval(() => fetchAlerts(false), 3000);
    return () => clearInterval(interval);
  }, [alerts]);

  const handleClear = async (hexId, alertId, location, type) => {
    setClearingId(alertId);
    try {
      const res = await fetch('/api/incidents/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hex_id: hexId }),
      });
      if (res.ok) {
        // Add to recent cleared for feedback
        setRecentCleared(prev => [
          { id: alertId, location, type, clearedAt: new Date().toLocaleTimeString() },
          ...prev.slice(0, 4)
        ]);
        // Update local alerts state immediately
        setAlerts(prev => prev.filter(a => a.id !== alertId));
      }
    } catch (err) {
      console.error("Failed to clear incident", err);
    } finally {
      setClearingId(null);
    }
  };

  return (
    <div className="field-portal-wrapper">
      {/* Local Style overrides for smartphone frame layout */}
      <style>{`
        .field-portal-wrapper {
          min-height: 100vh;
          background-color: #0b0f19;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          font-family: 'Inter', sans-serif;
          color: #f1f5f9;
        }
        .phone-frame {
          width: 375px;
          height: 750px;
          background: #111827;
          border: 12px solid #374151;
          border-radius: 40px;
          position: relative;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .phone-notch {
          width: 150px;
          height: 25px;
          background: #374151;
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          border-bottom-left-radius: 18px;
          border-bottom-right-radius: 18px;
          z-index: 100;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .phone-notch-speaker {
          width: 40px;
          height: 4px;
          background: #1f2937;
          border-radius: 2px;
        }
        .phone-header {
          padding: 30px 16px 12px 16px;
          background: #1f2937;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .phone-time {
          font-size: 0.8rem;
          font-weight: 600;
        }
        .phone-icons {
          display: flex;
          gap: 6px;
          font-size: 0.8rem;
          color: #9ca3af;
        }
        .phone-content {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .field-title {
          font-size: 1.1rem;
          font-weight: 700;
          color: var(--color-primary);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .badge-status {
          background: rgba(16,185,129,0.15);
          color: #10b981;
          padding: 2px 8px;
          border-radius: 20px;
          font-size: 0.65rem;
          font-weight: 600;
        }
        .dispatch-card {
          background: rgba(31,41,55,0.7);
          border: 1px solid rgba(239,68,68,0.25);
          border-radius: 16px;
          padding: 14px;
          position: relative;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .dispatch-card.critical {
          border-left: 4px solid #ef4444;
        }
        .dispatch-card.high {
          border-left: 4px solid #f97316;
          border-color: rgba(249,115,22,0.25);
        }
        .dispatch-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .dispatch-tag {
          font-size: 0.65rem;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .dispatch-tag.critical {
          background: rgba(239,68,68,0.2);
          color: #ef4444;
        }
        .dispatch-tag.high {
          background: rgba(249,115,22,0.2);
          color: #f97316;
        }
        .dispatch-time {
          font-size: 0.65rem;
          color: #9ca3af;
        }
        .dispatch-loc {
          font-size: 0.85rem;
          font-weight: 700;
          margin-bottom: 4px;
          color: #f3f4f6;
        }
        .dispatch-details {
          font-size: 0.75rem;
          color: #d1d5db;
          margin-bottom: 12px;
          line-height: 1.4;
        }
        .dispatch-meta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          background: rgba(0,0,0,0.2);
          padding: 8px;
          border-radius: 8px;
          margin-bottom: 12px;
          font-size: 0.7rem;
        }
        .dispatch-meta span {
          color: #9ca3af;
        }
        .dispatch-meta strong {
          color: #f3f4f6;
        }
        .clear-btn {
          width: 100%;
          padding: 10px;
          background: #10b981;
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }
        .clear-btn:hover {
          background: #059669;
        }
        .clear-btn:disabled {
          background: #374151;
          cursor: not-allowed;
        }
        .sms-box {
          background: #1f2937;
          border-radius: 12px;
          padding: 12px;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .sms-box-title {
          font-size: 0.75rem;
          font-weight: 700;
          color: #9ca3af;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .sms-message {
          font-size: 0.7rem;
          background: #111827;
          padding: 8px;
          border-radius: 8px;
          border-left: 2px solid var(--color-primary);
          margin-bottom: 6px;
          line-height: 1.3;
        }
        .sms-body {
          color: #d1d5db;
        }
        .sms-sender {
          font-weight: 600;
          color: var(--color-primary);
          margin-bottom: 2px;
        }
        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: #9ca3af;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .phone-notification {
          position: absolute;
          top: 40px;
          left: 10px;
          right: 10px;
          background: rgba(17,24,39,0.95);
          border: 1px solid var(--color-primary);
          padding: 12px;
          border-radius: 16px;
          font-size: 0.75rem;
          font-weight: 600;
          box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5);
          z-index: 200;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .phone-notification-dot {
          width: 8px;
          height: 8px;
          background: #ef4444;
          border-radius: 50%;
          animation: pulse 1s infinite;
        }
        @keyframes pulse {
          0% { transform: scale(0.8); opacity: 0.5; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(0.8); opacity: 0.5; }
        }
      `}</style>

      {/* Standalone Smartphone Shell Container */}
      <div className="phone-frame">
        {/* Notch details */}
        <div className="phone-notch">
          <div className="phone-notch-speaker" />
        </div>

        {/* Dynamic sliding phone notification banner */}
        <AnimatePresence>
          {notification && (
            <motion.div
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -50, opacity: 0 }}
              className="phone-notification"
            >
              <div className="phone-notification-dot" />
              <span>{notification}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mock phone status bar */}
        <div className="phone-header">
          <div className="phone-time">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="phone-icons">
            <span>📶</span>
            <span>🛜</span>
            <span>🔋 92%</span>
          </div>
        </div>

        {/* Phone Content viewport */}
        <div className="phone-content">
          {/* Header Portal details */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="field-title">
              <span>👮</span> BTP Patrol Hub
            </div>
            <span className="badge-status">Active Duty</span>
          </div>

          <div style={{ fontSize: '0.75rem', color: '#9ca3af', display: 'flex', justifyContent: 'space-between' }}>
            <span>Officer: <strong>BTP-206 (North)</strong></span>
            <span>Patrol: <strong>Zone A</strong></span>
          </div>

          <hr style={{ border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)', margin: 0 }} />

          {/* Active Dispatches Header */}
          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Active Dispatch Calls ({alerts.length})
          </div>

          {/* List of Active Dispatches */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <AnimatePresence initial={false}>
              {alerts.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="empty-state"
                >
                  <span style={{ fontSize: '2rem' }}>🌿</span>
                  <span>No active congestion hotspots in your sector. All roads clear!</span>
                </motion.div>
              ) : (
                alerts.map((alert) => (
                  <motion.div
                    key={alert.id}
                    initial={{ opacity: 0, x: -50 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 50 }}
                    transition={{ duration: 0.3 }}
                    className={`dispatch-card ${alert.severity.toLowerCase()}`}
                  >
                    <div className="dispatch-header">
                      <span className={`dispatch-tag ${alert.severity.toLowerCase()}`}>{alert.severity}</span>
                      <span className="dispatch-time">{alert.timestamp}</span>
                    </div>
                    <div className="dispatch-loc">{alert.location}</div>
                    <div className="dispatch-details">{alert.description}</div>
                    
                    <div className="dispatch-meta">
                      <div>
                        <span>Violation:</span><br />
                        <strong>{alert.type}</strong>
                      </div>
                      <div>
                        <span>Vehicle Class:</span><br />
                        <strong>{alert.vehicle}</strong>
                      </div>
                    </div>

                    <button
                      className="clear-btn"
                      disabled={clearingId === alert.id}
                      onClick={() => handleClear(alert.hex_id, alert.id, alert.location, alert.type)}
                    >
                      {clearingId === alert.id ? "CLEARING HOTSPOT..." : "MARK COMPLETED & RE-OPEN LANE"}
                    </button>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>

          {/* Dispatch SMS Inbox simulator */}
          <div className="sms-box">
            <div className="sms-box-title">BTP Automated SMS Alerts</div>
            <div className="sms-message">
              <div className="sms-sender">ASTraM Dispatch</div>
              <div className="sms-body">BTP Duty Notice: Clear double parking corridors before morning commute peaks. Penalties applied via SCITA.</div>
            </div>
            {recentCleared.map(rc => (
              <div key={rc.id} className="sms-message" style={{ borderLeftColor: '#10b981' }}>
                <div className="sms-sender" style={{ color: '#10b981' }}>ASTraM Confirmation</div>
                <div className="sms-body">Hotspot cleared successfully at {rc.clearedAt} for {rc.type} in {rc.location.split(',')[0]}.</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
            <Link
              to="/"
              style={{
                display: 'block',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '0.75rem',
                textDecoration: 'none',
                padding: '8px',
                border: '1px dashed #4b5563',
                borderRadius: '8px'
              }}
            >
              ← Return to Commander Console
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
