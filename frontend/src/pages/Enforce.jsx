import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { motion } from 'framer-motion';
import { api, formatNumber } from '../utils/api';

const BENGALURU_CENTER = [77.59, 12.97];

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

// Helper to compute centroid of hexagon boundary coordinates
const getHexCenter = (coords) => {
  if (!coords || coords.length < 3) return BENGALURU_CENTER;
  let sumLng = 0;
  let sumLat = 0;
  const len = coords.length - 1; // exclude loop closing point
  for (let i = 0; i < len; i++) {
    sumLng += coords[i][0];
    sumLat += coords[i][1];
  }
  return [sumLng / len, sumLat / len];
};

// Nearest-neighbor solver to construct an optimized continuous patrol path
const sortCoordinatesIntoPath = (hexList, center) => {
  const points = hexList.map(h => ({
    id: h.hex_id,
    pt: getHexCenter(h.coordinates)
  }));
  
  const path = [];
  let current = [center.lng, center.lat];
  const unvisited = [...points];
  
  while (unvisited.length > 0) {
    let bestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const dist = Math.hypot(unvisited[i].pt[0] - current[0], unvisited[i].pt[1] - current[1]);
      if (dist < minDist) {
        minDist = dist;
        bestIdx = i;
      }
    }
    const next = unvisited.splice(bestIdx, 1)[0];
    path.push(next.pt);
    current = next.pt;
  }
  return path;
};

export default function Enforce() {
  const [routes, setRoutes] = useState(null);
  const [officerCount, setOfficerCount] = useState(5);
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    api.getEnforcementRoutes(officerCount).then(setRoutes);
  }, [officerCount]);

  // Init map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: RASTER_MAP_STYLE,
      center: BENGALURU_CENTER, zoom: 11.5, attributionControl: false,
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
  }, [routes !== null]);

  // Clear markers on unmount
  useEffect(() => {
    return () => {
      markersRef.current.forEach(m => m.remove());
    };
  }, []);

  // Render zones & patrol paths on map
  useEffect(() => {
    if (!map.current || !routes) return;
    
    let isCancelled = false;
    const renderZones = () => {
      if (isCancelled) return;
      
      // Clear previous layers and sources
      routes.zones.forEach((_, i) => {
        if (map.current.getLayer(`zone-fill-${i}`)) map.current.removeLayer(`zone-fill-${i}`);
        if (map.current.getLayer(`zone-line-${i}`)) map.current.removeLayer(`zone-line-${i}`);
        if (map.current.getLayer(`zone-route-${i}`)) map.current.removeLayer(`zone-route-${i}`);
        if (map.current.getSource(`zone-${i}`)) map.current.removeSource(`zone-${i}`);
        if (map.current.getSource(`zone-route-src-${i}`)) map.current.removeSource(`zone-route-src-${i}`);
      });
      
      // Secondary cleanup for index changes
      for (let i = 0; i < 25; i++) {
        if (map.current.getLayer(`zone-fill-${i}`)) map.current.removeLayer(`zone-fill-${i}`);
        if (map.current.getLayer(`zone-line-${i}`)) map.current.removeLayer(`zone-line-${i}`);
        if (map.current.getLayer(`zone-route-${i}`)) map.current.removeLayer(`zone-route-${i}`);
        if (map.current.getSource(`zone-${i}`)) map.current.removeSource(`zone-${i}`);
        if (map.current.getSource(`zone-route-src-${i}`)) map.current.removeSource(`zone-route-src-${i}`);
      }

      // Clear previous markers
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];

      routes.zones.forEach((zone, i) => {
        const features = zone.all_hexes.map((hex) => ({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [hex.coordinates] },
          properties: { cis: hex.cis_score, zone_id: i },
        }));

        // 1. Render Hexagon outlines and fills
        map.current.addSource(`zone-${i}`, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
        });

        map.current.addLayer({
          id: `zone-fill-${i}`,
          type: 'fill',
          source: `zone-${i}`,
          paint: { 'fill-color': zone.color, 'fill-opacity': 0.3 },
        });

        map.current.addLayer({
          id: `zone-line-${i}`,
          type: 'line',
          source: `zone-${i}`,
          paint: { 'line-color': zone.color, 'line-width': 1.5 },
        });

        // 2. Compute and render optimized path lines
        if (zone.all_hexes.length > 1) {
          const pathCoords = sortCoordinatesIntoPath(zone.all_hexes, zone.center);
          map.current.addSource(`zone-route-src-${i}`, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: pathCoords }
            }
          });

          map.current.addLayer({
            id: `zone-route-${i}`,
            type: 'line',
            source: `zone-route-src-${i}`,
            paint: {
              'line-color': zone.color,
              'line-width': 3,
              'line-dasharray': [3, 2],
              'line-opacity': 0.8
            }
          });
        }

        // 3. Zone center marker
        const marker = new maplibregl.Marker({ color: zone.color, scale: 0.8 })
          .setLngLat([zone.center.lng, zone.center.lat])
          .setPopup(new maplibregl.Popup().setHTML(
            `<div class="popup-title">${zone.officer_label} HQ</div>
             <div class="popup-row"><span class="popup-label">Hex Cells</span><span class="popup-value">${zone.n_hexes}</span></div>
             <div class="popup-row"><span class="popup-label">Avg CIS</span><span class="popup-value">${zone.avg_cis}</span></div>
             <div class="popup-row"><span class="popup-label">Station</span><span class="popup-value">${zone.police_station}</span></div>`
          ))
          .addTo(map.current);
        markersRef.current.push(marker);
      });
      map.current.resize();
    };

    if (map.current.isStyleLoaded()) renderZones();
    else map.current.once('load', renderZones);

    return () => {
      isCancelled = true;
    };
  }, [routes]);

  const handlePushDispatch = async (zone) => {
    const worstHex = zone.top_hexes[0];
    if (!worstHex) return;
    
    try {
      await api.addDispatchAlert({
        hex_id: worstHex.hex_id,
        location: `${zone.police_station} Sector (Hex ${worstHex.hex_id.substring(0, 8)})`,
        type: zone.dominant_violation,
        vehicle: zone.dominant_vehicle,
        severity: zone.max_cis >= 80 ? 'CRITICAL' : 'HIGH',
        description: `Patrol zone route assignment for ${zone.officer_label}. Focus clearing peak hotspot area.`
      });
      alert(`🚨 Dispatch Alert pushed to ${zone.officer_label}'s mobile view successfully!`);
    } catch (err) {
      console.error("Failed to trigger officer dispatch", err);
    }
  };

  if (!routes) return <div className="loading-container"><div><div className="loading-spinner" /><div className="loading-text">Optimizing routes...</div></div></div>;

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
          <h2>Enforcement Optimizer</h2>
          <div className="subtitle">AI-optimized patrol zone assignment using K-Means clustering</div>
        </div>
      </div>

      {/* Officer Slider */}
      <div className="glass-card glass-card-sm" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 24 }}>
        <div className="sim-control-label">Officers Available</div>
        <input
          type="range" min="3" max="20" value={officerCount}
          onChange={(e) => setOfficerCount(Number(e.target.value))}
          className="sim-slider" style={{ maxWidth: 300 }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-primary)', minWidth: 30 }}>
          {officerCount}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
          <div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Coverage</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-success)' }}>
              {routes.coverage.coverage_pct}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Est. Reduction</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-primary)' }}>
              {routes.expected_impact.violation_reduction_pct}%
            </div>
          </div>
        </div>
      </div>

      <div className="enforce-layout">
        {/* Map */}
        <div className="dashboard-map-section">
          <div ref={mapContainer} className="map-container" />
        </div>

        {/* Zone Cards */}
        <div className="zone-list">
          {routes.zones.map((zone) => (
            <div key={zone.zone_id} className="zone-card">
              <div className="zone-header">
                <div className="zone-color-dot" style={{ background: zone.color }} />
                <span className="zone-title">{zone.officer_label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 700, color: zone.color }}>
                  CIS {zone.avg_cis}
                </span>
              </div>
              <div className="zone-stats">
                <div className="zone-stat">
                  Hexes: <span className="zone-stat-value">{zone.n_hexes}</span>
                </div>
                <div className="zone-stat">
                  Max CIS: <span className="zone-stat-value">{zone.max_cis}</span>
                </div>
                <div className="zone-stat">
                  Violations: <span className="zone-stat-value">{formatNumber(zone.total_violations)}</span>
                </div>
                <div className="zone-stat">
                  Station: <span className="zone-stat-value">{zone.police_station}</span>
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {zone.schedule}
              </div>
              <div style={{ marginTop: 4, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                Primary: {zone.dominant_violation} | {zone.dominant_vehicle}
              </div>
              
              <button
                className="btn btn-primary"
                style={{
                  width: '100%',
                  marginTop: '12px',
                  padding: '6px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  background: 'var(--color-primary)',
                  borderRadius: '6px'
                }}
                onClick={() => handlePushDispatch(zone)}
              >
                📡 Dispatch to Officer
              </button>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
