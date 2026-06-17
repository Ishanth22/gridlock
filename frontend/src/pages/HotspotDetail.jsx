import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';
import { motion } from 'framer-motion';
import { api, getCISColor, getCISCategory, formatHour } from '../utils/api';

const PIE_COLORS = ['#06b6d4', '#f97316', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

export default function HotspotDetail() {
  const { hexId } = useParams();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    api.getHotspotDetail(hexId)
      .then(setDetail)
      .catch((e) => setError(e.message));
  }, [hexId]);

  // Init map once
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: RASTER_MAP_STYLE,
      center: [77.59, 12.97],
      zoom: 14.5,
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
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [detail !== null]);

  // Update map coordinates and marker when detail changes
  useEffect(() => {
    if (!map.current || !detail) return;
    
    let isCancelled = false;
    const updateMap = () => {
      if (isCancelled) return;
      map.current.flyTo({
        center: [detail.lng, detail.lat],
        zoom: 14.5,
        essential: true,
      });

      if (markerRef.current) {
        markerRef.current.remove();
      }

      markerRef.current = new maplibregl.Marker({ color: getCISColor(detail.cis_score) })
        .setLngLat([detail.lng, detail.lat])
        .addTo(map.current);
      map.current.resize();
    };

    if (map.current.isStyleLoaded()) {
      updateMap();
    } else {
      map.current.once('load', updateMap);
    }

    return () => {
      isCancelled = true;
    };
  }, [detail]);

  if (error) return <div className="page-container"><div className="glass-card">Error: {error}</div></div>;
  if (!detail) return <div className="loading-container"><div><div className="loading-spinner" /><div className="loading-text">Loading hotspot...</div></div></div>;

  // Prepare data
  const violationData = Object.entries(detail.violation_breakdown)
    .map(([name, value]) => ({ name: name.length > 20 ? name.substring(0, 20) + '...' : name, fullName: name, value }));

  const vehicleData = Object.entries(detail.vehicle_breakdown)
    .map(([name, value]) => ({ name, value }));

  const monthlyData = Object.entries(detail.monthly_trend)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  const hourlyData = Object.entries(detail.hourly_distribution)
    .map(([hour, count]) => ({ hour: formatHour(Number(hour)), count, rawHour: Number(hour) }))
    .sort((a, b) => a.rawHour - b.rawHour);

  // Temporal heatmap intensity
  const maxVal = Math.max(...detail.temporal_matrix.flat(), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.4 }}
      className="page-container"
    >
      {/* Header */}
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link to="/" className="btn btn-ghost" style={{ padding: '6px 10px' }}>&larr;</Link>
            <div>
              <h2>{detail.police_station}</h2>
              <div className="subtitle" style={{ maxWidth: 500 }}>
                {detail.location_name?.substring(0, 80)}
                {detail.is_junction ? ` | ${detail.junction_name}` : ''}
              </div>
            </div>
          </div>
        </div>
        <span className={`cis-badge ${detail.cis_category}`} style={{ fontSize: '1.2rem', padding: '8px 20px' }}>
          CIS {detail.cis_score}
        </span>
      </div>

      {/* KPI Row */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="kpi-card" style={{ '--accent-color': getCISColor(detail.cis_score) }}>
          <div className="kpi-label">Total Violations</div>
          <div className="kpi-value primary">{detail.total_violations.toLocaleString()}</div>
        </div>
        <div className="kpi-card" style={{ '--accent-color': 'var(--color-warning)' }}>
          <div className="kpi-label">Daily Average</div>
          <div className="kpi-value warning">{detail.daily_average}</div>
        </div>
        <div className="kpi-card" style={{ '--accent-color': 'var(--color-critical)' }}>
          <div className="kpi-label">Carriageway Reduction</div>
          <div className="kpi-value critical">{detail.carriageway_reduction}%</div>
        </div>
        <div className="kpi-card" style={{ '--accent-color': 'var(--color-high)' }}>
          <div className="kpi-label">Peak Hour</div>
          <div className="kpi-value high">{formatHour(detail.peak_hour)}</div>
        </div>
      </div>

      <div className="detail-grid">
        {/* Map */}
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden', height: 300 }}>
          <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Temporal Heatmap */}
        <div className="glass-card">
          <div className="glass-card-header">
            <span className="glass-card-title">Violation Heatmap (24h x 7d)</span>
          </div>
          <div className="temporal-hour-labels">
            <div />
            {Array.from({ length: 24 }, (_, i) => (
              <div key={i} className="temporal-hour-label">{i % 3 === 0 ? i : ''}</div>
            ))}
          </div>
          <div className="temporal-heatmap">
            {DAYS.map((day, dayIdx) => (
              <React.Fragment key={day}>
                <div className="temporal-heatmap-label">{day}</div>
                {Array.from({ length: 24 }, (_, hourIdx) => {
                  const val = detail.temporal_matrix[dayIdx]?.[hourIdx] || 0;
                  const intensity = val / maxVal;
                  const bg = intensity === 0
                    ? 'rgba(255,255,255,0.03)'
                    : `rgba(6, 182, 212, ${0.15 + intensity * 0.75})`;
                  return (
                    <div
                      key={hourIdx}
                      className="temporal-heatmap-cell"
                      style={{ background: bg }}
                      title={`${day} ${formatHour(hourIdx)}: ${val} violations`}
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Violation Breakdown */}
        <div className="glass-card">
          <div className="glass-card-header">
            <span className="glass-card-title">Violation Types</span>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={violationData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} interval={0} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, color: '#f1f5f9' }} />
                <Bar dataKey="value" fill="#06b6d4" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Vehicle + Monthly */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Vehicle Type */}
          <div className="glass-card" style={{ flex: 1 }}>
            <div className="glass-card-header">
              <span className="glass-card-title">Vehicle Distribution</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: 100 }}>
              <div style={{ width: 100, height: 100 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={vehicleData} cx="50%" cy="50%" innerRadius={25} outerRadius={45} dataKey="value" stroke="none">
                      {vehicleData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, fontSize: '0.75rem' }}>
                {vehicleData.slice(0, 5).map((v, i) => (
                  <div key={v.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0', color: 'var(--text-secondary)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: 2, background: PIE_COLORS[i] }} />
                    <span style={{ flex: 1 }}>{v.name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{v.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Monthly Trend */}
          <div className="glass-card" style={{ flex: 1 }}>
            <div className="glass-card-header">
              <span className="glass-card-title">Monthly Trend</span>
            </div>
            <div style={{ height: 80 }}>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={monthlyData}>
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} />
                  <YAxis hide />
                  <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6', r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* AI Insight */}
        <div className="detail-full">
          <div className="ai-insight">
            <div className="ai-insight-text">{detail.ai_insight}</div>
          </div>
        </div>

        {/* Hourly Distribution */}
        <div className="glass-card detail-full">
          <div className="glass-card-header">
            <span className="glass-card-title">Hourly Violation Pattern</span>
          </div>
          <div className="chart-container-sm">
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={hourlyData}>
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} interval={2} />
                <YAxis hide />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, color: '#f1f5f9' }} />
                <Bar dataKey="count" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Neighbors */}
        {detail.neighbors?.length > 0 && (
          <div className="glass-card detail-full">
            <div className="glass-card-header">
              <span className="glass-card-title">Adjacent Hex Cells</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {detail.neighbors.map((n) => (
                <Link
                  key={n.hex_id}
                  to={`/hotspot/${n.hex_id}`}
                  style={{
                    background: 'var(--bg-glass)', border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-md)', padding: '8px 12px',
                    fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 8,
                    textDecoration: 'none', color: 'inherit'
                  }}
                  className="neighbor-link"
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-primary)' }}>
                    {n.hex_id}
                  </span>
                  <span className={`cis-badge ${getCISCategory(n.cis_score)}`}>{n.cis_score}</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>{n.violations} violations</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
