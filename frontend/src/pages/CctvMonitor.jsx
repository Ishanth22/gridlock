import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { api, getCISColor } from '../utils/api';

const CAMERA_FEEDS = [
  { hex_id: '8860145b55fffff', name: 'KG Road Circle, Gandhinagar' },
  { hex_id: '8861892e9bfffff', name: 'Main Guard Cross Road, Shivajinagar' },
  { hex_id: '8860145a2bfffff', name: 'Laggere Service Road, Rajajinagar' },
  { hex_id: '8861892535fffff', name: 'Richmond Road flyover ramp' },
];

export default function CctvMonitor() {
  const [selectedFeed, setSelectedFeed] = useState(CAMERA_FEEDS[0]);
  const [vehicles, setVehicles] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [isSimulating, setIsSimulating] = useState(true);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Load warnings on mount
  useEffect(() => {
    api.getWarnings().then(setWarnings).catch(console.error);
  }, []);

  // CCTV Simulation logic (canvas drawing loop)
  useEffect(() => {
    if (!canvasRef.current || !isSimulating) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Set internal resolution
    canvas.width = 640;
    canvas.height = 360;

    // Initialize mock vehicles if empty
    let localVehicles = [
      { id: 1, type: 'CAR', plate: 'KA-03-ME-4829', x: 50, y: 150, speed: 2.2, color: '#06b6d4', stationaryTime: 0, status: 'moving' },
      { id: 2, type: 'SCOOTER', plate: 'KA-02-JH-5522', x: 200, y: 180, speed: 3.1, color: '#f59e0b', stationaryTime: 0, status: 'moving' },
      { id: 3, type: 'CAR', plate: 'KA-05-NB-9081', x: 420, y: 260, speed: 0, color: '#ef4444', stationaryTime: 8.5, status: 'stopped', zone: 'no-parking' },
      { id: 4, type: 'LGV', plate: 'KA-51-P-8833', x: 100, y: 280, speed: 1.8, color: '#10b981', stationaryTime: 0, status: 'moving' }
    ];

    const NO_PARKING_ZONE = { x: 350, y: 220, w: 250, h: 100 };

    const checkViolation = async (veh) => {
      // Trigger warning via backend
      try {
        const res = await api.reportIncident({
          hex_id: selectedFeed.hex_id,
          violation_type: 'DOUBLE PARKING',
          vehicle_type: veh.type,
          description: `CCTV Live Feed Auto-Detection: Vehicle ${veh.plate} stationary in No-Parking Zone for >10s.`,
          license_plate: veh.plate,
        });
        if (res.status === 'success') {
          // Re-load warning list
          const updated = await api.getWarnings();
          setWarnings(updated);
        }
      } catch (err) {
        console.error(err);
      }
    };

    const updateAndDraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Draw static road design
      ctx.fillStyle = '#0f172a'; // dark asphalt
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Lanes outlines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 120); ctx.lineTo(640, 120);
      ctx.moveTo(0, 240); ctx.lineTo(640, 240);
      ctx.stroke();

      // Yellow dashed divider
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.setLineDash([15, 15]);
      ctx.beginPath();
      ctx.moveTo(0, 180); ctx.lineTo(640, 180);
      ctx.stroke();
      ctx.setLineDash([]); // reset

      // 2. Draw highlighted No-Parking Zone
      ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
      ctx.fillRect(NO_PARKING_ZONE.x, NO_PARKING_ZONE.y, NO_PARKING_ZONE.w, NO_PARKING_ZONE.h);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(NO_PARKING_ZONE.x, NO_PARKING_ZONE.y, NO_PARKING_ZONE.w, NO_PARKING_ZONE.h);

      // No Parking label text
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 9px var(--font-heading)';
      ctx.fillText('WARNING: NO PARKING CORRIDOR', NO_PARKING_ZONE.x + 8, NO_PARKING_ZONE.y + 16);

      // 3. Update & Draw vehicles
      localVehicles = localVehicles.map((veh) => {
        let { x, y, speed, stationaryTime, status, plate } = veh;

        // Move vehicle if it is moving
        if (status === 'moving') {
          x += speed;
          if (x > 660) {
            x = -40; // wrap around
            // randomize speed/type/plate on respawn
            const suffixes = ['9081', '4829', '1234', '5522', '8833', '9999', '2134', '1102'];
            plate = `KA-03-ME-${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
          }
        }

        // Check if vehicle has entered the No Parking Zone
        const inZone = (x >= NO_PARKING_ZONE.x && x <= NO_PARKING_ZONE.x + NO_PARKING_ZONE.w &&
                       y >= NO_PARKING_ZONE.y && y <= NO_PARKING_ZONE.y + NO_PARKING_ZONE.h);

        // Simulate random stopping in No Parking zone
        if (inZone && status === 'moving' && Math.random() < 0.005) {
          status = 'stopped';
          speed = 0;
        }

        // Increment stationary timer if stopped in zone
        if (status === 'stopped') {
          stationaryTime += 1 / 60; // 60 FPS
          
          // Triggers BTP warning exactly once when exceeding 10 seconds in simulator
          if (stationaryTime >= 10 && !veh.triggeredWarning) {
            veh.triggeredWarning = true;
            checkViolation(veh);
          }
        }

        // Drawing the vehicle box
        const boxWidth = veh.type === 'LGV' ? 42 : 32;
        const boxHeight = 18;

        ctx.fillStyle = veh.color;
        ctx.fillRect(x, y - boxHeight/2, boxWidth, boxHeight);

        // Bounding box display
        let strokeColor = '#10b981'; // green for moving
        if (status === 'stopped') {
          strokeColor = stationaryTime >= 10 ? '#ef4444' : '#f59e0b'; // red for violation, orange for warning
        }
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 2, y - boxHeight/2 - 2, boxWidth + 4, boxHeight + 4);

        // Labels
        ctx.fillStyle = '#fff';
        ctx.font = '9px var(--font-mono)';
        ctx.fillText(veh.plate, x, y - 14);

        if (status === 'stopped') {
          ctx.fillStyle = strokeColor;
          ctx.fillText(`STOPPED: ${Math.round(stationaryTime)}s`, x, y - 24);
        }

        return { ...veh, x, y, speed, stationaryTime, status, plate };
      });

      // 4. Draw Camera HUD overlay
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(10, 10, 240, 48);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(22, 22, 4, 0, 2 * Math.PI); ctx.fill(); // recording dot

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px var(--font-heading)';
      ctx.fillText('LIVE CCTV STREAMING', 32, 25);
      ctx.fillStyle = 'var(--text-secondary)';
      ctx.fillText(`LOC: ${selectedFeed.name}`, 15, 40);
      ctx.fillText(`H3: ${selectedFeed.hex_id}`, 15, 50);

      // Timestamp
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '9px var(--font-mono)';
      ctx.fillText(new Date().toLocaleTimeString(), 540, 25);

      animationFrameRef.current = requestAnimationFrame(updateAndDraw);
    };

    updateAndDraw();

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [selectedFeed, isSimulating]);

  const clearHotspot = () => {
    // Clear all stopped vehicles on screen
    setIsSimulating(false);
    setTimeout(() => {
      setIsSimulating(true);
    }, 100);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.4 }}
      className="page-container"
      style={{ padding: 16 }}
    >
      <div className="page-header">
        <div>
          <h2>CCTV Enforcement Monitor</h2>
          <div className="subtitle">Computer vision edge vehicle tracking & automated stationary breach detection</div>
        </div>
      </div>

      <div className="predict-layout">
        {/* Left Side: CCTV Live Stream */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Feed Selectors */}
          <div className="glass-card glass-card-sm" style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: 8 }}>
            {CAMERA_FEEDS.map((feed) => (
              <button
                key={feed.hex_id}
                onClick={() => setSelectedFeed(feed)}
                className={`btn ${selectedFeed.hex_id === feed.hex_id ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.75rem', padding: '6px 12px', whiteSpace: 'nowrap' }}
              >
                📹 {feed.name.split(',')[0]}
              </button>
            ))}
          </div>

          {/* Canvas Screen */}
          <div className="dashboard-map-section" style={{ minHeight: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#090d16' }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', maxWidth: 640, maxHeight: 360, borderRadius: 8 }} />
          </div>

          {/* Action Row */}
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-primary" onClick={clearHotspot} style={{ fontSize: '0.75rem', padding: '8px 16px' }}>
              ⚡ Clear Lane Obstructions
            </button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
              ℹ️ Simulated vehicle detection box colors: Green (Moving), Orange (&lt;10s Stop), Red (Breached & Warned)
            </span>
          </div>
        </div>

        {/* Right Side: Warnings Timeline Feed */}
        <div className="dashboard-sidebar">
          <div className="glass-card glass-card-sm">
            <div className="glass-card-header">
              <span className="glass-card-title" style={{ color: 'var(--color-ai)' }}>📢 Live SMS Warnings Log</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--color-high)', fontWeight: 600 }}>Simulated VAHAN Workflow</span>
            </div>
            <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {warnings.length === 0 ? (
                <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', padding: '24px 0' }}>
                  No warnings triggered. Stopped vehicles in red zones will trigger alerts after 10s.
                </div>
              ) : (
                warnings.map((w, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: 'rgba(0,0,0,0.25)',
                      padding: 10,
                      borderRadius: 8,
                      fontSize: '0.72rem',
                      borderLeft: `3px solid ${w.status.includes('RESOLVED') ? '#10b981' : '#ef4444'}`,
                      lineHeight: 1.4
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{w.license_plate}</strong>
                      <span
                        style={{
                          fontSize: '0.6rem',
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontWeight: 700,
                          background: w.status.includes('RESOLVED') ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                          color: w.status.includes('RESOLVED') ? '#10b981' : '#ef4444'
                        }}
                      >
                        {w.status}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Owner: <strong>{w.owner}</strong> ({w.phone}) &middot; Model: {w.model}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', background: 'rgba(255,255,255,0.02)', padding: 4, borderRadius: 4 }}>
                      "{w.message}"
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
