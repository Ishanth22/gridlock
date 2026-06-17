import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, CartesianGrid, LineChart, Line, Cell,
} from 'recharts';
import { motion } from 'framer-motion';
import { api, getCISColor, formatNumber } from '../utils/api';

export default function Analytics() {
  const [metrics, setMetrics] = useState(null);
  const [stations, setStations] = useState(null);
  const [overview, setOverview] = useState(null);
  const [sortBy, setSortBy] = useState('total_violations');

  useEffect(() => {
    Promise.all([api.getModelMetrics(), api.getStations(), api.getOverview()])
      .then(([m, s, o]) => { setMetrics(m); setStations(s); setOverview(o); });
  }, []);

  if (!metrics || !stations || !overview) return <div className="loading-container"><div><div className="loading-spinner" /><div className="loading-text">Loading analytics...</div></div></div>;

  const sortedStations = [...stations].sort((a, b) => b[sortBy] - a[sortBy]);

  // Monthly trend data
  const monthlyData = Object.entries(overview.monthly_trend)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  // Violation distribution
  const violationData = Object.entries(overview.violation_distribution)
    .slice(0, 10)
    .map(([name, value]) => ({
      name: name.length > 22 ? name.substring(0, 22) + '...' : name,
      value,
    }));

  // Scatter data for actual vs predicted
  const scatterData = metrics.scatter_data?.slice(0, 200) || [];

  const confMatrix = metrics.classification?.confusion_matrix;

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.4 }}
      className="page-container"
    >
      <div className="page-header">
        <div>
          <h2>Analytics & Model Evaluation</h2>
          <div className="subtitle">ML performance metrics, station rankings, and violation trends</div>
        </div>
      </div>

      {/* Model Metrics Cards */}
      <div className="glass-card" style={{ marginBottom: 16 }}>
        <div className="glass-card-header" style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <span className="glass-card-title">LightGBM Model Performance & Validation Metrics</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {metrics.training_samples} train / {metrics.test_samples} test samples | {metrics.total_features} features
            </span>
          </div>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0 0 0', lineHeight: 1.4 }}>
            💡 <strong>Evaluation Note:</strong> LightGBM forecasts continuous violation counts. To calculate classification metrics (F1, Precision, Recall, and Confusion Matrix), predictions are converted to binary states using a threshold of <strong>&ge; 15 violations/hour</strong> defining a "Hotspot".
          </p>
        </div>
        <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
          <div className="metric-card">
            <div className="metric-value">{metrics.regression.r2_score}</div>
            <div className="metric-label">R2 Score</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{metrics.regression.mae}</div>
            <div className="metric-label">MAE</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{metrics.regression.rmse}</div>
            <div className="metric-label">RMSE</div>
          </div>
          <div className="metric-card" style={{ borderColor: 'rgba(139,92,246,0.3)' }}>
            <div className="metric-value" style={{ color: 'var(--color-ai)' }}>{metrics.classification.precision}</div>
            <div className="metric-label">Precision</div>
          </div>
          <div className="metric-card" style={{ borderColor: 'rgba(139,92,246,0.3)' }}>
            <div className="metric-value" style={{ color: 'var(--color-ai)' }}>{metrics.classification.recall}</div>
            <div className="metric-label">Recall</div>
          </div>
          <div className="metric-card" style={{ borderColor: 'rgba(6,182,212,0.3)' }}>
            <div className="metric-value" style={{ color: 'var(--color-primary)' }}>{metrics.classification.f1_score}</div>
            <div className="metric-label">F1 Score</div>
          </div>
          <div className="metric-card">
            <div className="metric-value" style={{ color: 'var(--color-success)' }}>{metrics.n_estimators}</div>
            <div className="metric-label">Estimators</div>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        {/* Actual vs Predicted Scatter */}
        <div className="glass-card">
          <div className="glass-card-header">
            <span className="glass-card-title">Actual vs Predicted (Scatter)</span>
          </div>
          <div className="chart-container-lg">
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="actual" name="Actual" type="number"
                  tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false}
                  label={{ value: 'Actual', position: 'bottom', fill: '#64748b', fontSize: 11 }}
                />
                <YAxis
                  dataKey="predicted" name="Predicted" type="number"
                  tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false}
                  label={{ value: 'Predicted', angle: -90, position: 'left', fill: '#64748b', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, color: '#f1f5f9' }}
                />
                <Scatter data={scatterData} fill="#8b5cf6" fillOpacity={0.6} r={3} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Feature Importance */}
        <div className="glass-card">
          <div className="glass-card-header">
            <span className="glass-card-title">Feature Importance</span>
          </div>
          <div className="chart-container-lg">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={Object.entries(metrics.feature_importance).slice(0, 12).map(([name, val]) => ({
                  name: name.length > 15 ? name.substring(0, 15) : name,
                  value: val,
                }))}
                layout="vertical"
              >
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, color: '#f1f5f9' }} />
                <Bar dataKey="value" fill="#06b6d4" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Confusion Matrix */}
        {confMatrix && (
          <div className="glass-card">
            <div className="glass-card-header">
              <span className="glass-card-title">Confusion Matrix</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gridTemplateRows: '30px 1fr 1fr', gap: 4, maxWidth: 300, margin: '0 auto' }}>
              <div />
              <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>Pred: No</div>
              <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>Pred: Yes</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', fontWeight: 600, display: 'flex', alignItems: 'center' }}>Actual: No</div>
              <div style={{ background: 'var(--color-success-dim)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.2rem', color: 'var(--color-success)', padding: 16 }}>
                {confMatrix[0][0]}
              </div>
              <div style={{ background: 'var(--color-critical-dim)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.2rem', color: 'var(--color-critical)', padding: 16 }}>
                {confMatrix[0][1]}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', fontWeight: 600, display: 'flex', alignItems: 'center' }}>Actual: Yes</div>
              <div style={{ background: 'var(--color-critical-dim)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.2rem', color: 'var(--color-critical)', padding: 16 }}>
                {confMatrix[1][0]}
              </div>
              <div style={{ background: 'var(--color-success-dim)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.2rem', color: 'var(--color-success)', padding: 16 }}>
                {confMatrix[1][1]}
              </div>
            </div>
          </div>
        )}

        {/* Monthly Trend */}
        <div className="glass-card">
          <div className="glass-card-header">
            <span className="glass-card-title">Monthly Violation Trend</span>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, color: '#f1f5f9' }} />
                <Line type="monotone" dataKey="count" stroke="#06b6d4" strokeWidth={2} dot={{ fill: '#06b6d4', r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Violation Type Distribution */}
        <div className="glass-card detail-full">
          <div className="glass-card-header">
            <span className="glass-card-title">Top Violation Types</span>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={violationData}>
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b', angle: -20, textAnchor: 'end' }} axisLine={false} height={50} interval={0} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, color: '#f1f5f9' }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {violationData.map((_, i) => (
                    <Cell key={i} fill={['#06b6d4', '#f97316', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1', '#84cc16'][i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Methodology & Analytical Integrity Card */}
        <div className="glass-card detail-full" style={{ marginBottom: 16 }}>
          <div className="glass-card-header">
            <span className="glass-card-title">📋 ML Validation Methodology & Data Integrity</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, fontSize: '0.78rem', lineHeight: 1.5, padding: '0 8px 8px 8px' }}>
            <div style={{ background: 'rgba(0,0,0,0.15)', padding: 12, borderRadius: 8, border: '1px solid rgba(139,92,246,0.15)' }}>
              <h4 style={{ color: 'var(--color-ai)', margin: '0 0 8px 0', fontSize: '0.85rem', fontWeight: 700 }}>1. Temporal Validation Split (Preventing Data Leakage)</h4>
              <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                To evaluate predictive power accurately, we implement a strict <strong>temporal time-series validation split</strong> rather than a standard random shuffle. The model trains on Weeks 1–22 and validates its predictions against a future hold-out period (Week 23). This guarantees that spatial/temporal autocorrelation does not leak from the training set, mimicking real-world deployment evaluation.
              </p>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.15)', padding: 12, borderRadius: 8, border: '1px solid rgba(239,68,68,0.15)' }}>
              <h4 style={{ color: 'var(--color-critical)', margin: '0 0 8px 0', fontSize: '0.85rem', fontWeight: 700 }}>2. Enforcement Bias Acknowledgment & Mitigation</h4>
              <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                <strong>Data Limitation:</strong> Parking ticket datasets suffer from enforcement bias—violations are only recorded where police already patrol, skewing raw target distributions. To mitigate this blind spot, our LightGBM model incorporates non-patrol spatial indicators (e.g. proximity to critical intersections, lane capacity, land usage tags) to discover hidden hotspots.
              </p>
            </div>
          </div>
        </div>

        {/* Station Ranking Table */}
        <div className="glass-card detail-full">
          <div className="glass-card-header">
            <span className="glass-card-title">Police Station Performance Ranking</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {['total_violations', 'avg_cis', 'enforcement_rate'].map((key) => (
                <button
                  key={key}
                  className={`btn ${sortBy === key ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: '0.7rem', padding: '4px 10px' }}
                  onClick={() => setSortBy(key)}
                >
                  {key === 'total_violations' ? 'Violations' : key === 'avg_cis' ? 'Avg CIS' : 'Enforcement'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Station</th>
                  <th>Violations</th>
                  <th>Avg CIS</th>
                  <th>Max CIS</th>
                  <th>Critical</th>
                  <th>Enforcement</th>
                  <th>Hex Cells</th>
                </tr>
              </thead>
              <tbody>
                {sortedStations.slice(0, 30).map((s, i) => (
                  <tr key={s.name}>
                    <td className="mono" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td className="mono">{formatNumber(s.total_violations)}</td>
                    <td>
                      <span className={`cis-badge ${s.avg_cis >= 80 ? 'critical' : s.avg_cis >= 60 ? 'high' : s.avg_cis >= 40 ? 'moderate' : 'low'}`}
                        style={{ fontSize: '0.7rem' }}>
                        {s.avg_cis}
                      </span>
                    </td>
                    <td className="mono" style={{ color: getCISColor(s.max_cis) }}>{s.max_cis}</td>
                    <td className="mono" style={{ color: s.critical_hotspots > 0 ? 'var(--color-critical)' : 'var(--text-muted)' }}>
                      {s.critical_hotspots}
                    </td>
                    <td className="mono" style={{ color: s.enforcement_rate > 80 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                      {s.enforcement_rate}%
                    </td>
                    <td className="mono">{s.hex_cells}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
