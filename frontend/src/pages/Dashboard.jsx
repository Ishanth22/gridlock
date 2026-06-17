import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { motion } from 'framer-motion';
import { api, getCISColor, getCISCategory, formatNumber, formatHour } from '../utils/api';

const BENGALURU_CENTER = [77.59, 12.97];
const PIE_COLORS = ['#06b6d4', '#f97316', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];

const RASTER_MAP_STYLE = {
  version: 8,
  sources: {
    'raster-tiles': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors, © CARTO'
    }
  },
  layers: [
    {
      id: 'simple-tiles',
      type: 'raster',
      source: 'raster-tiles',
      minzoom: 0,
      maxzoom: 20
    }
  ]
};

export default function Dashboard() {
  const navigate = useNavigate();
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [overview, setOverview] = useState(null);
  const [heatmap, setHeatmap] = useState(null);
  const [hotspots, setHotspots] = useState([]);
  const [timelapse, setTimelapse] = useState(null);
  const [currentHour, setCurrentHour] = useState(10);
  const [isPlaying, setIsPlaying] = useState(false);
  const playInterval = useRef(null);

  // Set up navigation for map popups
  useEffect(() => {
    window.reactNavigate = (path) => {
      navigate(path);
    };
    return () => {
      delete window.reactNavigate;
    };
  }, [navigate]);

  const [weatherMode, setWeatherMode] = useState('sunny');
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportHex, setReportHex] = useState('');
  const [reportViolation, setReportViolation] = useState('DOUBLE PARKING');
  const [reportVehicle, setReportVehicle] = useState('CAR');
  const [reportDesc, setReportDesc] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
 
  // Sync active weather mode on mount
  useEffect(() => {
    api.getWeather()
      .then(data => setWeatherMode(data.weather || 'sunny'))
      .catch(console.error);
  }, []);
 
  const loadData = useCallback(() => {
    Promise.all([
      api.getOverview(),
      api.getHeatmap(),
      api.getHotspots(10),
      api.getTimelapse(),
    ]).then(([ov, hm, hs, tl]) => {
      setOverview(ov);
      setHeatmap(hm);
      setHotspots(hs);
      setTimelapse(tl);
      
      // Auto-select a hotspot for reporting if none selected
      if (hs.length > 0 && !reportHex) {
        setReportHex(hs[0].hex_id);
      }
    });
  }, [reportHex]);
 
  useEffect(() => {
    loadData();
  }, [loadData]);
 
  const handleWeatherChange = async (mode) => {
    setWeatherMode(mode);
    try {
      await api.setWeather(mode);
      loadData();
    } catch (err) {
      console.error("Failed to update weather mode", err);
    }
  };
 
  const handleSubmitReport = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await api.reportIncident({
        hex_id: reportHex,
        violation_type: reportViolation,
        vehicle_type: reportVehicle,
        description: reportDesc,
      });
      if (res.status === 'success') {
        setShowReportModal(false);
        setReportDesc('');
        loadData();
        alert('📸 Public Eye Report logged successfully! Ingested into ASTraM pipeline. Automated dispatch triggered.');
      }
    } catch (err) {
      console.error("Failed to submit citizen report", err);
    } finally {
      setIsSubmitting(false);
    }
  };
 
  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: RASTER_MAP_STYLE,
      center: BENGALURU_CENTER,
      zoom: 11.5,
      pitch: 0,
      attributionControl: false,
    });
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
 
    const resizeTimer = setTimeout(() => {
      if (map.current) {
        map.current.resize();
      }
    }, 300);
 
    return () => {
      clearTimeout(resizeTimer);
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [overview !== null && heatmap !== null]);

  // Add heatmap layer
  useEffect(() => {
    if (!map.current || !heatmap) return;
    
    let isCancelled = false;
    const onLoad = () => {
      if (isCancelled) return;
      
      // Update hexagons source directly if it already exists
      if (map.current.getSource('hexagons')) {
        map.current.getSource('hexagons').setData(heatmap);
        return;
      }
      
      map.current.addSource('hexagons', {
        type: 'geojson',
        data: heatmap,
      });

      map.current.addLayer({
        id: 'hex-fill',
        type: 'fill',
        source: 'hexagons',
        paint: {
          'fill-color': [
            'interpolate', ['linear'], ['get', 'cis_score'],
            0, '#10b981',
            30, '#22d3ee',
            50, '#f59e0b',
            70, '#f97316',
            85, '#ef4444',
            100, '#dc2626',
          ],
          'fill-opacity': [
            'interpolate', ['linear'], ['get', 'cis_score'],
            0, 0.15,
            50, 0.4,
            80, 0.6,
            100, 0.8,
          ],
        },
      });

      map.current.addLayer({
        id: 'hex-outline',
        type: 'line',
        source: 'hexagons',
        paint: {
          'line-color': [
            'interpolate', ['linear'], ['get', 'cis_score'],
            0, 'rgba(16,185,129,0.3)',
            50, 'rgba(245,158,11,0.5)',
            80, 'rgba(239,68,68,0.7)',
            100, 'rgba(220,38,38,0.9)',
          ],
          'line-width': 1,
        },
      });

      // Popup on click
      map.current.on('click', 'hex-fill', (e) => {
        const props = e.features[0].properties;
        const html = `
          <div class="popup-title">${props.location_name?.substring(0, 60) || 'Unknown'}</div>
          <div class="popup-row"><span class="popup-label">CIS Score</span><span class="popup-value" style="color:${getCISColor(props.cis_score)}">${props.cis_score}</span></div>
          <div class="popup-row"><span class="popup-label">Violations</span><span class="popup-value">${props.total_violations}</span></div>
          <div class="popup-row"><span class="popup-label">Carriageway</span><span class="popup-value">-${props.carriageway_reduction}%</span></div>
          <div class="popup-row"><span class="popup-label">Type</span><span class="popup-value" style="font-size:0.7rem">${props.dominant_violation}</span></div>
          <div class="popup-row"><span class="popup-label">Station</span><span class="popup-value">${props.police_station}</span></div>
          <div style="margin-top:8px">
            <a href="#" onclick="window.reactNavigate('/hotspot/${props.hex_id}'); return false;" style="color:var(--color-primary);font-size:0.8rem;font-weight:600">View Deep Dive &rarr;</a>
          </div>
        `;
        new maplibregl.Popup({ maxWidth: '300px' })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map.current);
      });

      map.current.on('mouseenter', 'hex-fill', () => {
        map.current.getCanvas().style.cursor = 'pointer';
      });
      map.current.on('mouseleave', 'hex-fill', () => {
        map.current.getCanvas().style.cursor = '';
      });
      map.current.resize();
    };

    if (map.current.isStyleLoaded()) {
      onLoad();
    } else {
      map.current.once('load', onLoad);
    }

    return () => {
      isCancelled = true;
    };
  }, [heatmap]);

  // Time slider animation for timelapse
  useEffect(() => {
    if (!isPlaying || !timelapse) return;
    playInterval.current = setInterval(() => {
      setCurrentHour((h) => (h + 1) % 24);
    }, 800);
    return () => clearInterval(playInterval.current);
  }, [isPlaying, timelapse]);

  // Update map opacity based on timelapse hour
  useEffect(() => {
    if (!map.current || !timelapse || !map.current.getLayer('hex-fill')) return;
    
    const frame = timelapse[currentHour];
    if (!frame) return;
    
    // Create a set of active hex IDs for this hour
    const activeHexes = new Set(frame.hexes.map(h => h.hex_id));
    
    // Update the fill opacity based on whether hex is active this hour
    // We use a more dynamic approach - modulate base opacity
    const hourlyIntensity = frame.total_violations / 
      Math.max(...timelapse.map(f => f.total_violations), 1);
    
    map.current.setPaintProperty('hex-fill', 'fill-opacity', [
      'interpolate', ['linear'], ['get', 'cis_score'],
      0, 0.1 + hourlyIntensity * 0.15,
      50, 0.25 + hourlyIntensity * 0.25,
      80, 0.4 + hourlyIntensity * 0.3,
      100, 0.5 + hourlyIntensity * 0.4,
    ]);
  }, [currentHour, timelapse]);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  if (!overview || !heatmap) {
    return (
      <div className="loading-container" style={{ height: '100vh' }}>
        <div>
          <div className="loading-spinner" />
          <div className="loading-text">Loading ParkSense AI...</div>
        </div>
      </div>
    );
  }

  // Prepare chart data
  const hourlyData = Object.entries(overview.hourly_distribution)
    .map(([hour, count]) => ({ hour: formatHour(Number(hour)), count, rawHour: Number(hour) }))
    .sort((a, b) => a.rawHour - b.rawHour);

  const vehicleData = Object.entries(overview.vehicle_distribution)
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.4 }}
      className="page-container"
      style={{ padding: '16px' }}
    >
      {/* Dynamic Header with Weather simulator, Public Eye reporting, and Portal toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>Command Center Cockpit</h2>
          <div className="subtitle" style={{ margin: 0 }}>Real-time parking congestion intelligence overview</div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Weather / Event simulator */}
          <div className="weather-selector" style={{ background: 'rgba(31, 41, 55, 0.6)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px', display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', padding: '0 4px', fontWeight: 600 }}>ENVIRONMENT:</span>
            {['sunny', 'rain', 'vip'].map((mode) => (
              <button
                key={mode}
                onClick={() => handleWeatherChange(mode)}
                className={`btn ${weatherMode === mode ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '4px 8px', fontSize: '0.65rem', textTransform: 'capitalize', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
              >
                {mode === 'sunny' ? '☀️ Sunny' : mode === 'rain' ? '🌧️ Rain' : '🚘 VIP Route'}
              </button>
            ))}
          </div>
          
          {/* Public Eye Report Trigger */}
          <button 
            className="btn btn-primary"
            style={{ fontSize: '0.7rem', padding: '6px 12px', background: 'var(--color-ai)', borderRadius: '6px', border: 'none', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => setShowReportModal(true)}
          >
            📸 Public Eye Report
          </button>

          {/* Floating Officer Portal link */}
          <Link 
            to="/field" 
            className="btn"
            style={{ fontSize: '0.7rem', padding: '6px 12px', border: '1px solid var(--color-primary)', color: 'var(--color-primary)', borderRadius: '6px', textDecoration: 'none', fontWeight: 600 }}
          >
            👮 Field Portal
          </Link>
        </div>
      </div>

      {/* KPI Row */}
      <div className="kpi-grid stagger-children" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="kpi-card animate-count" style={{ '--accent-color': 'var(--color-primary)' }}>
          <div className="kpi-label">Total Violations</div>
          <div className="kpi-value primary">{formatNumber(overview.total_violations)}</div>
          <div className="kpi-trend neutral">Nov 2023 - Mar 2024</div>
        </div>
        <div className="kpi-card animate-count" style={{ '--accent-color': 'var(--color-critical)' }}>
          <div className="kpi-label">Critical Hotspots</div>
          <div className="kpi-value critical">{overview.critical_hotspots}</div>
          <div className="kpi-trend up">CIS &ge; 80</div>
        </div>
        <div className="kpi-card animate-count" style={{ '--accent-color': 'var(--color-high)' }}>
          <div className="kpi-label">High Priority</div>
          <div className="kpi-value high">{overview.high_priority_hotspots}</div>
          <div className="kpi-trend up">CIS &ge; 60</div>
        </div>
        <div className="kpi-card animate-count" style={{ '--accent-color': 'var(--color-warning)' }}>
          <div className="kpi-label">Hex Cells</div>
          <div className="kpi-value warning">{overview.total_hex_cells}</div>
          <div className="kpi-trend neutral">H3 Resolution 8</div>
        </div>
        <div className="kpi-card animate-count" style={{ '--accent-color': 'var(--color-success)' }}>
          <div className="kpi-label">Enforcement Rate</div>
          <div className="kpi-value success">{overview.enforcement_rate}%</div>
          <div className="kpi-trend neutral">SCITA integration</div>
        </div>
      </div>

      {/* Main Dashboard: Map + Sidebar */}
      <div className="dashboard-layout">
        {/* Map */}
        <div className="dashboard-map-section">
          <div ref={mapContainer} className="map-container" />
          {/* Time Slider Overlay */}
          <div className="map-overlay map-overlay-bottom">
            <div className="time-slider-container">
              <button className="time-slider-play" onClick={togglePlay}>
                {isPlaying ? '\u23F8' : '\u25B6'}
              </button>
              <span className="time-slider-label">{formatHour(currentHour)}</span>
              <input
                type="range"
                min="0"
                max="23"
                value={currentHour}
                onChange={(e) => setCurrentHour(Number(e.target.value))}
                className="time-slider"
              />
              <span className="time-slider-stats">
                {timelapse ? `${timelapse[currentHour]?.total_violations?.toLocaleString()} violations` : ''}
              </span>
            </div>
          </div>
          {/* Map Legend */}
          <div className="map-overlay map-overlay-top-right" style={{ marginTop: '50px' }}>
            <div style={{
              background: 'rgba(10,14,26,0.85)', backdropFilter: 'blur(16px)',
              border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)',
              padding: '12px', fontSize: '0.7rem',
            }}>
              <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text-secondary)' }}>
                CIS Score
              </div>
              {[
                { label: 'Critical (80-100)', color: '#ef4444' },
                { label: 'High (60-80)', color: '#f97316' },
                { label: 'Moderate (40-60)', color: '#f59e0b' },
                { label: 'Low (0-40)', color: '#10b981' },
              ].map((item) => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, background: item.color, opacity: 0.7 }} />
                  <span style={{ color: 'var(--text-tertiary)' }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="dashboard-sidebar">
          {/* Top Hotspots */}
          <div className="glass-card glass-card-sm">
            <div className="glass-card-header">
              <span className="glass-card-title">Top Critical Hotspots</span>
            </div>
            <div className="hotspot-list">
              {hotspots.slice(0, 5).map((hs, i) => (
                <Link
                  key={hs.hex_id}
                  to={`/hotspot/${hs.hex_id}`}
                  className="hotspot-item animate-slide"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <span className="hotspot-rank">#{i + 1}</span>
                  <div className="hotspot-info">
                    <div className="hotspot-name">{hs.police_station}</div>
                    <div className="hotspot-meta">
                      {hs.total_violations} violations &middot; {hs.dominant_violation}
                    </div>
                  </div>
                  <span className={`cis-badge ${getCISCategory(hs.cis_score)}`}>
                    {hs.cis_score}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          {/* Hourly Trend */}
          <div className="glass-card glass-card-sm">
            <div className="glass-card-header">
              <span className="glass-card-title">Hourly Pattern</span>
            </div>
            <div className="chart-container-sm">
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={hourlyData}>
                  <defs>
                    <linearGradient id="hourGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="hour" tick={{ fontSize: 9, fill: '#64748b' }}
                    axisLine={false} tickLine={false} interval={3}
                  />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      background: '#111827', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8, fontSize: 12, color: '#f1f5f9',
                    }}
                  />
                  <Area
                    type="monotone" dataKey="count" stroke="#06b6d4"
                    fill="url(#hourGrad)" strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Vehicle Breakdown */}
          <div className="glass-card glass-card-sm">
            <div className="glass-card-header">
              <span className="glass-card-title">Vehicle Types</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 120, height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={vehicleData} cx="50%" cy="50%"
                      innerRadius={30} outerRadius={55}
                      dataKey="value" stroke="none"
                    >
                      {vehicleData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, fontSize: '0.75rem' }}>
                {vehicleData.slice(0, 5).map((v, i) => (
                  <div key={v.name} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '2px 0', color: 'var(--text-secondary)',
                  }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: 2,
                      background: PIE_COLORS[i],
                    }} />
                    <span style={{ flex: 1 }}>{v.name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {formatNumber(v.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* CIS Summary */}
          <div className="glass-card glass-card-sm">
            <div className="glass-card-header">
              <span className="glass-card-title">CIS Distribution</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(overview.cis_summary).map(([cat, count]) => {
                const color = cat === 'critical' ? '#ef4444' : cat === 'high' ? '#f97316' : cat === 'moderate' ? '#f59e0b' : '#10b981';
                const pct = (count / overview.total_hex_cells * 100).toFixed(1);
                return (
                  <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
                    <span style={{ width: 70, textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{cat}</span>
                    <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, width: 35, textAlign: 'right', color }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Citizen Report Modal */}
      {showReportModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000, padding: 16
        }}>
          <div className="glass-card" style={{ maxWidth: 450, width: '100%', padding: 24, border: '1px solid var(--color-primary)', background: '#111827' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.2rem', color: 'var(--color-ai)', fontWeight: 700 }}>
              Simulate Public Eye Citizen Upload
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 16px 0' }}>
              Select a bottleneck zone, snap an offense, and push it directly into the BTP data ingestion pipeline.
            </p>
            <form onSubmit={handleSubmitReport}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>Target H3 Hexagon Area</label>
                <select 
                  value={reportHex} 
                  onChange={e => setReportHex(e.target.value)}
                  style={{ width: '100%', padding: 8, background: '#1f2937', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff', fontSize: '0.8rem' }}
                >
                  {hotspots.slice(0, 10).map(hs => (
                    <option key={hs.hex_id} value={hs.hex_id}>
                      {hs.police_station} - {hs.hex_id} (CIS: {Math.round(hs.cis_score)})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>Violation Category</label>
                  <select 
                    value={reportViolation} 
                    onChange={e => setReportViolation(e.target.value)}
                    style={{ width: '100%', padding: 8, background: '#1f2937', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff', fontSize: '0.8rem' }}
                  >
                    <option value="DOUBLE PARKING">Double Parking</option>
                    <option value="FOOTPATH PARKING">Footpath Parking</option>
                    <option value="WRONG PARKING">Wrong Parking</option>
                    <option value="PARKING NEAR JUNCTION">Junction Blockage</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>Vehicle Type</label>
                  <select 
                    value={reportVehicle} 
                    onChange={e => setReportVehicle(e.target.value)}
                    style={{ width: '100%', padding: 8, background: '#1f2937', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff', fontSize: '0.8rem' }}
                  >
                    <option value="CAR">Car</option>
                    <option value="SCOOTER">Scooter / Two Wheeler</option>
                    <option value="PASSENGER AUTO">Auto Rickshaw</option>
                    <option value="LORRY/GOODS VEHICLE">Truck / Delivery Van</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>Incident Details / Description</label>
                <textarea 
                  value={reportDesc} 
                  onChange={e => setReportDesc(e.target.value)}
                  placeholder="e.g. Delivery truck parked on main lane causing 500m queue backup..."
                  style={{ width: '100%', height: 60, padding: 8, background: '#1f2937', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff', fontSize: '0.8rem', resize: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button 
                  type="button" 
                  className="btn btn-ghost" 
                  style={{ fontSize: '0.75rem', padding: '6px 12px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#9ca3af', borderRadius: 6, cursor: 'pointer' }}
                  onClick={() => setShowReportModal(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ fontSize: '0.75rem', padding: '6px 12px', background: 'var(--color-primary)', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer' }}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Ingesting...' : 'Submit Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </motion.div>
  );
}
