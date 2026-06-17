import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../utils/api';

export default function Simulate() {
  const [scenarios, setScenarios] = useState(null);
  const [activeScenario, setActiveScenario] = useState(null);
  const [activeKey, setActiveKey] = useState(null);

  useEffect(() => {
    api.getScenarios().then((data) => {
      setScenarios(data);
      if (data && Object.keys(data).length > 0) {
        const firstKey = Object.keys(data)[0];
        setActiveKey(firstKey);
        setActiveScenario(data[firstKey]);
      }
    });
  }, []);

  const selectScenario = (key) => {
    setActiveKey(key);
    setActiveScenario(scenarios[key]);
  };

  if (!scenarios) return <div className="loading-container"><div><div className="loading-spinner" /><div className="loading-text">Loading simulator...</div></div></div>;

  const result = activeScenario?.result;
  const summary = result?.summary;
  const displacement = result?.displacement;

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
          <h2>What-If Simulator</h2>
          <div className="subtitle">Model enforcement impact with displacement/diffusion analysis</div>
        </div>
        {summary && (
          <div className="btn-ai" style={{ cursor: 'default' }}>
            Net CIS Reduction: {summary.cis_reduction_pct}%
          </div>
        )}
      </div>

      {/* Preset Scenarios */}
      <div className="glass-card glass-card-sm" style={{ marginBottom: 16 }}>
        <div className="glass-card-header">
          <span className="glass-card-title">Select Enforcement Scenario</span>
        </div>
        <div className="scenario-grid">
          {Object.entries(scenarios).map(([key, scenario]) => (
            <div
              key={key}
              className={`scenario-card ${activeKey === key ? 'active' : ''}`}
              onClick={() => selectScenario(key)}
            >
              <div className="scenario-name">{scenario.name}</div>
              <div className="scenario-desc">{scenario.description}</div>
              <div className="scenario-metrics">
                <div className="scenario-metric">
                  <span className="scenario-metric-value" style={{ color: 'var(--color-primary)' }}>
                    {scenario.result.summary.cis_reduction_pct}%
                  </span>
                  <span className="scenario-metric-label">CIS Reduction</span>
                </div>
                <div className="scenario-metric">
                  <span className="scenario-metric-value" style={{ color: 'var(--color-success)' }}>
                    {scenario.result.summary.violation_reduction_pct}%
                  </span>
                  <span className="scenario-metric-label">Violation Reduction</span>
                </div>
                <div className="scenario-metric">
                  <span className="scenario-metric-value" style={{ color: 'var(--color-warning)' }}>
                    {scenario.result.summary.spillover_warning}
                  </span>
                  <span className="scenario-metric-label">Spillover Zones</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Simulation Results */}
      {result && (
        <>
          {/* Impact Summary */}
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 16 }}>
            <div className="kpi-card" style={{ '--accent-color': 'var(--color-primary)' }}>
              <div className="kpi-label">CIS Reduction</div>
              <div className="kpi-value primary">{summary.cis_reduction_pct}%</div>
            </div>
            <div className="kpi-card" style={{ '--accent-color': 'var(--color-success)' }}>
              <div className="kpi-label">Violations Suppressed</div>
              <div className="kpi-value success">{Math.round(displacement.total_suppressed).toLocaleString()}</div>
            </div>
            <div className="kpi-card" style={{ '--accent-color': 'var(--color-warning)' }}>
              <div className="kpi-label">Violations Displaced</div>
              <div className="kpi-value warning">{Math.round(displacement.total_displaced).toLocaleString()}</div>
            </div>
            <div className="kpi-card" style={{ '--accent-color': 'var(--color-ai)' }}>
              <div className="kpi-label">Net Reduction</div>
              <div className="kpi-value ai">{Math.round(displacement.net_reduction).toLocaleString()}</div>
            </div>
            <div className="kpi-card" style={{ '--accent-color': 'var(--color-high)' }}>
              <div className="kpi-label">Cost Effectiveness</div>
              <div className="kpi-value high">{summary.cost_effectiveness}</div>
              <div className="kpi-trend neutral">CIS reduction per officer</div>
            </div>
          </div>

          <div className="detail-grid">
            {/* Before vs After */}
            <div className="glass-card">
              <div className="glass-card-header">
                <span className="glass-card-title">Before Enforcement</span>
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Hex Cell</th>
                      <th>Violations</th>
                      <th>CIS Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.before).map(([hexId, data]) => (
                      <tr key={hexId}>
                        <td className="mono" style={{ fontSize: '0.7rem' }}>{hexId.substring(0, 12)}...</td>
                        <td className="mono">{data.violations.toLocaleString()}</td>
                        <td><span className="cis-badge critical" style={{ fontSize: '0.7rem' }}>{data.cis_score}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="glass-card">
              <div className="glass-card-header">
                <span className="glass-card-title">After Enforcement</span>
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Hex Cell</th>
                      <th>Violations</th>
                      <th>CIS Score</th>
                      <th>Reduction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.after).map(([hexId, data]) => (
                      <tr key={hexId}>
                        <td className="mono" style={{ fontSize: '0.7rem' }}>{hexId.substring(0, 12)}...</td>
                        <td className="mono">{data.violations.toLocaleString()}</td>
                        <td><span className="cis-badge moderate" style={{ fontSize: '0.7rem' }}>{data.cis_score}</span></td>
                        <td style={{ color: 'var(--color-success)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          -{data.reduction_pct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Displacement / Spillover */}
            <div className="glass-card detail-full">
              <div className="glass-card-header">
                <span className="glass-card-title">Displacement / Spillover Analysis</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-warning)', fontWeight: 600 }}>
                  {summary.spillover_warning} zones affected
                </span>
              </div>
              {displacement.spillover_hexes.length > 0 ? (
                <div style={{ maxHeight: 250, overflowY: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Neighbor Hex</th>
                        <th>Original</th>
                        <th>Displaced Added</th>
                        <th>New Total</th>
                        <th>Increase</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displacement.spillover_hexes.map((sp) => (
                        <tr key={sp.hex_id}>
                          <td className="mono" style={{ fontSize: '0.7rem' }}>{sp.hex_id.substring(0, 12)}...</td>
                          <td className="mono">{sp.original_violations}</td>
                          <td className="mono" style={{ color: 'var(--color-displacement)' }}>+{sp.displaced_violations_added}</td>
                          <td className="mono">{sp.new_total}</td>
                          <td style={{
                            color: sp.increase_pct > 10 ? 'var(--color-critical)' : 'var(--color-warning)',
                            fontFamily: 'var(--font-mono)', fontWeight: 700,
                          }}>
                            +{sp.increase_pct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)' }}>
                  No significant spillover detected
                </div>
              )}
            </div>

            {/* AI Insight */}
            <div className="detail-full">
              <div className="ai-insight">
                <div className="ai-insight-text">
                  Deploying {result.input.n_officers} officers to {Object.keys(result.before).length} target hexes
                  during {result.input.time_window} hours would suppress approximately{' '}
                  {Math.round(displacement.total_suppressed).toLocaleString()} violations ({summary.violation_reduction_pct}% reduction).
                  However, {Math.round(displacement.total_displaced).toLocaleString()} violations ({(displacement.displacement_rate * 100)}%)
                  are projected to displace to {displacement.spillover_hexes.length} neighboring hex cells.
                  Net effective reduction: {Math.round(displacement.net_reduction).toLocaleString()} violations.
                  Cost effectiveness: {summary.cost_effectiveness} CIS points reduced per officer deployed.
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
