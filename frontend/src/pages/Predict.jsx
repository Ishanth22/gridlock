import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { api, getCISCategory, formatNumber } from '../utils/api';
import { cellToBoundary } from 'h3-js';

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

export default function Predict() {
  const [forecast, setForecast] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [selectedHex, setSelectedHex] = useState(null);
  const [shapData, setShapData] = useState(null);
  const mapContainer = useRef(null);
  const map = useRef(null);

  useEffect(() => {
    Promise.all([api.getForecast(), api.getModelMetrics()])
      .then(([fc, mt]) => {
        setForecast(fc);
        setMetrics(mt);
        if (fc && fc.predictions && fc.predictions.length > 0) {
          const first = fc.predictions[0];
          setSelectedHex({
            hex_id: first.h3_res8,
            predicted: Math.round(first.predicted_total),
            predicted_lower: Math.round(first.predicted_total_lower || (first.predicted_total * 0.95)),
            predicted_upper: Math.round(first.predicted_total_upper || (first.predicted_total * 1.05)),
            actual: first.actual_total,
            cis: first.cis_score || 0,
            trend: first.trend,
            trend_direction: first.trend_direction,
            is_emerging: first.is_emerging,
            station: first.police_station || '',
          });
          api.getShapExplanation(first.h3_res8).then(setShapData).catch(() => setShapData(null));
        }
      });
  }, []);

  // Init map
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
  }, [forecast !== null]);

  // Add/Update forecast hexes
  useEffect(() => {
    if (!map.current || !forecast) return;
    
    let isCancelled = false;
    const onLoad = () => {
      if (isCancelled) return;
      
      const features = forecast.predictions.map((p) => {
        const boundary = cellToBoundary(p.h3_res8, true);
        const coords = [...boundary, boundary[0]];
        return {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [coords] },
          properties: {
            hex_id: p.h3_res8,
            predicted: Math.round(p.predicted_total),
            predicted_lower: Math.round(p.predicted_total_lower || (p.predicted_total * 0.95)),
            predicted_upper: Math.round(p.predicted_total_upper || (p.predicted_total * 1.05)),
            actual: p.actual_total,
            cis: p.cis_score || 0,
            trend: p.trend,
            trend_direction: p.trend_direction,
            is_emerging: p.is_emerging,
            station: p.police_station || '',
          },
        };
      });

      const geojsonData = { type: 'FeatureCollection', features };

      // Update hexagons source directly if it already exists
      if (map.current.getSource('forecast')) {
        map.current.getSource('forecast').setData(geojsonData);
        return;
      }

      map.current.addSource('forecast', {
        type: 'geojson',
        data: geojsonData,
      });

      map.current.addLayer({
        id: 'forecast-fill',
        type: 'fill',
        source: 'forecast',
        paint: {
          'fill-color': [
            'case',
            ['get', 'is_emerging'], '#f59e0b',
            ['interpolate', ['linear'], ['get', 'predicted'],
              0, '#10b981', 50, '#06b6d4', 200, '#f97316', 500, '#ef4444',
            ],
          ],
          'fill-opacity': ['interpolate', ['linear'], ['get', 'predicted'], 0, 0.2, 500, 0.7],
        },
      });

      map.current.addLayer({
        id: 'forecast-line',
        type: 'line',
        source: 'forecast',
        paint: {
          'line-color': [
            'case',
            ['get', 'is_emerging'], '#f59e0b',
            ['interpolate', ['linear'], ['get', 'predicted'], 0, '#10b98155', 500, '#ef444499'],
          ],
          'line-width': 1.5,
        },
      });

      map.current.on('click', 'forecast-fill', (e) => {
        const props = e.features[0].properties;
        setSelectedHex(props);
        api.getShapExplanation(props.hex_id).then(setShapData).catch(() => setShapData(null));
      });

      map.current.on('mouseenter', 'forecast-fill', () => { map.current.getCanvas().style.cursor = 'pointer'; });
      map.current.on('mouseleave', 'forecast-fill', () => { map.current.getCanvas().style.cursor = ''; });
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
  }, [forecast]);

  if (!forecast || !metrics) return <div className="loading-container"><div><div className="loading-spinner" /><div className="loading-text">Loading predictions...</div></div></div>;

  const emergingData = forecast.emerging_hotspots || [];

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
          <h2>Predictive Intelligence</h2>
          <div className="subtitle">LightGBM-powered hotspot forecasting with SHAP explainability</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="metric-card" style={{ padding: '8px 16px' }}>
            <div className="metric-value" style={{ fontSize: '1rem' }}>{metrics.regression.r2_score}</div>
            <div className="metric-label" style={{ fontSize: '0.65rem' }}>R2 Score</div>
          </div>
          <div className="metric-card" style={{ padding: '8px 16px' }}>
            <div className="metric-value" style={{ fontSize: '1rem' }}>{metrics.classification.f1_score}</div>
            <div className="metric-label" style={{ fontSize: '0.65rem' }}>F1 Score</div>
          </div>
        </div>
      </div>

      <div className="predict-layout">
        {/* Map */}
        <div className="dashboard-map-section">
          <div ref={mapContainer} className="map-container" />
          <div className="map-overlay map-overlay-top-right" style={{ marginTop: 50 }}>
            <div style={{
              background: 'rgba(10,14,26,0.85)', backdropFilter: 'blur(16px)',
              border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)',
              padding: 12, fontSize: '0.7rem',
            }}>
              <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text-secondary)' }}>Legend</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: '#f59e0b' }} />
                <span style={{ color: 'var(--text-tertiary)' }}>Emerging Hotspot</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: '#ef4444' }} />
                <span style={{ color: 'var(--text-tertiary)' }}>High Predicted</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: '#06b6d4' }} />
                <span style={{ color: 'var(--text-tertiary)' }}>Moderate Predicted</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="dashboard-sidebar">
          {/* Selected Hex SHAP */}
          {selectedHex && (
            <div className="glass-card glass-card-sm">
              <div className="glass-card-header">
                <span className="glass-card-title">Selected Prediction</span>
                <span className={`cis-badge ${getCISCategory(selectedHex.cis)}`}>{Number(selectedHex.cis || 0).toFixed(1)}</span>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                {selectedHex.station}
              </div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Predicted (95% CI Range)</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-primary)' }}>
                    {selectedHex.predicted}
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 6 }}>
                      [{selectedHex.predicted_lower || Math.round(selectedHex.predicted * 0.95)} - {selectedHex.predicted_upper || Math.round(selectedHex.predicted * 1.05)}]
                    </span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Actual</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{selectedHex.actual}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Trend</div>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontWeight: 700,
                    color: selectedHex.trend > 0 ? 'var(--color-critical)' : 'var(--color-success)',
                  }}>
                    {selectedHex.trend > 0 ? '+' : ''}{selectedHex.trend}%
                  </div>
                </div>
              </div>

              {/* SHAP Waterfall */}
              {shapData && shapData.top_factors && (
                <div>
                  <div className="glass-card-title" style={{ marginBottom: 8 }}>SHAP Explanation</div>
                  {shapData.top_factors.map((factor) => {
                    const maxShap = Math.max(...shapData.top_factors.map(f => Math.abs(f.shap_value)), 0.01);
                    const widthPct = Math.min(Math.abs(factor.shap_value) / maxShap * 45, 45);
                    return (
                      <div key={factor.feature} className="shap-bar">
                        <span className="shap-label">{factor.feature}</span>
                        <div className="shap-bar-track">
                          <div
                            className={`shap-bar-fill ${factor.shap_value >= 0 ? 'positive' : 'negative'}`}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                        <span className="shap-value">{factor.shap_value.toFixed(3)}</span>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 8 }}>
                    {shapData.top_factors[0]?.description}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Emerging Hotspots */}
          <div className="glass-card glass-card-sm">
            <div className="glass-card-header">
              <span className="glass-card-title">Emerging Hotspots</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--color-warning)', fontWeight: 600 }}>
                {emergingData.length} detected
              </span>
            </div>
            <div className="emerging-list">
              {emergingData.slice(0, 8).map((item) => (
                <div key={item.h3_res8} className="emerging-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{item.police_station || 'Unknown'}</span>
                    <span className="emerging-trend">+{Math.round(item.trend)}%</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    CIS: {Math.round(item.cis_score || 0)} | Predicted: {Math.round(item.predicted_total)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Feature Importance */}
          {metrics.feature_importance && (
            <div className="glass-card glass-card-sm">
              <div className="glass-card-header">
                <span className="glass-card-title">Feature Importance</span>
              </div>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="99%" height={200}>
                  <BarChart
                    data={Object.entries(metrics.feature_importance).slice(0, 8).map(([name, val]) => ({
                      name: name.length > 12 ? name.substring(0, 12) : name, value: val,
                    }))}
                    layout="vertical"
                  >
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} interval={0} />
                    <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
