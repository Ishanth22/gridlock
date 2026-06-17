const API_BASE = '';

async function fetchJSON(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export const api = {
  getOverview: () => fetchJSON('/api/overview'),
  getHeatmap: () => fetchJSON('/api/heatmap'),
  getHourlyHeatmap: (hour) => fetchJSON(`/api/heatmap/hourly/${hour}`),
  getHotspots: (top = 50) => fetchJSON(`/api/hotspots?top=${top}`),
  getHotspotDetail: (hexId) => fetchJSON(`/api/hotspot/${hexId}`),
  getForecast: () => fetchJSON('/api/forecast'),
  getShapExplanation: (hexId) => fetchJSON(`/api/forecast/shap/${hexId}`),
  getStations: () => fetchJSON('/api/stations'),
  getEnforcementRoutes: (officers = 5) => fetchJSON(`/api/enforce?officers=${officers}`),
  getTimelapse: () => fetchJSON('/api/timelapse'),
  getModelMetrics: () => fetchJSON('/api/model/metrics'),
  getScenarios: () => fetchJSON('/api/scenarios'),
  simulate: (data) =>
    fetch(`${API_BASE}/api/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => r.json()),
};

export function getCISColor(score) {
  if (score >= 80) return '#ef4444';
  if (score >= 60) return '#f97316';
  if (score >= 40) return '#f59e0b';
  return '#10b981';
}

export function getCISCategory(score) {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'moderate';
  return 'low';
}

export function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num?.toLocaleString() || '0';
}

export function formatHour(hour) {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}
