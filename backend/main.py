"""
ParkSense AI -- FastAPI Backend Server
Serves pre-computed JSON data and handles live simulation and dispatch requests.
"""

import json
import os
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import pandas as pd

app = FastAPI(
    title="ParkSense AI",
    description="AI-powered parking congestion intelligence platform for Bengaluru",
    version="1.0.0",
)

# CORS - allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

# ============================================================
# GLOBAL IN-MEMORY STATES FOR REAL-TIME SIMULATION
# ============================================================
WEATHER_MODE = "sunny"  # "sunny", "rain", "vip"
CITIZEN_BUMPS = {}      # hex_id -> { "violations": int, "cis_score": float, "type": str, "vehicle": str }
DISPATCH_ALERTS = []    # List of active officer dispatch events

# Prepopulate with 2 mock dispatch alerts for visual feedback
DISPATCH_ALERTS = [
  {
    "id": "alert-101",
    "hex_id": "8860145b55fffff",
    "location": "5th Main Road, Kempe Gowda Circle, Gandhinagar",
    "type": "DOUBLE PARKING",
    "vehicle": "CAR",
    "severity": "CRITICAL",
    "timestamp": "10 mins ago",
    "description": "Double parked cars blocking primary junction near KG Road. High congestion delay."
  },
  {
    "id": "alert-102",
    "hex_id": "8861892e9bfffff",
    "location": "Main Guard Cross Road, Shivajinagar",
    "type": "FOOTPATH PARKING",
    "vehicle": "SCOOTER",
    "severity": "HIGH",
    "timestamp": "25 mins ago",
    "description": "Multiple commercial two-wheelers parked on footpath blocking pedestrian walkways."
  }
]

def load_json(filename):
    """Load a pre-computed JSON file."""
    filepath = os.path.join(DATA_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail=f"Data file not found: {filename}")
    with open(filepath, 'r') as f:
        return json.load(f)

def get_cis_category(score):
    if score >= 80:
        return "critical"
    elif score >= 60:
        return "high"
    elif score >= 40:
        return "moderate"
    return "low"

# ============================================================
# MODEL SCHEMAS
# ============================================================
class WeatherRequest(BaseModel):
    mode: str

class IncidentReportRequest(BaseModel):
    hex_id: str
    violation_type: str
    vehicle_type: str
    description: Optional[str] = ""

class DispatchAlertRequest(BaseModel):
    hex_id: str
    location: str
    type: str
    vehicle: str
    severity: str
    description: str

class ClearRequest(BaseModel):
    hex_id: str

# ============================================================
# NEW REAL-TIME & WEATHER ENDPOINTS
# ============================================================

@app.get("/api/weather")
def get_weather():
    return {"weather": WEATHER_MODE}

@app.post("/api/weather")
def set_weather(req: WeatherRequest):
    global WEATHER_MODE
    if req.mode not in ["sunny", "rain", "vip"]:
        raise HTTPException(status_code=400, detail="Invalid weather mode")
    WEATHER_MODE = req.mode
    return {"status": "success", "weather": WEATHER_MODE}

@app.get("/api/dispatch/alerts")
def get_dispatch_alerts():
    return DISPATCH_ALERTS

@app.post("/api/dispatch/alerts")
def add_dispatch_alert(req: DispatchAlertRequest):
    global DISPATCH_ALERTS
    alert_id = f"alert-{len(DISPATCH_ALERTS) + 101}"
    new_alert = {
        "id": alert_id,
        "hex_id": req.hex_id,
        "location": req.location,
        "type": req.type,
        "vehicle": req.vehicle,
        "severity": req.severity,
        "timestamp": "Just Now",
        "description": req.description
    }
    # Avoid duplicate dispatches for the same cell
    if not any(a["hex_id"] == req.hex_id for a in DISPATCH_ALERTS):
        DISPATCH_ALERTS.insert(0, new_alert)
    return {"status": "success", "alert": new_alert}

@app.post("/api/incidents/report")
def report_incident(req: IncidentReportRequest):
    global CITIZEN_BUMPS, DISPATCH_ALERTS
    
    # Increment metrics in-memory
    hex_id = req.hex_id
    if hex_id not in CITIZEN_BUMPS:
        CITIZEN_BUMPS[hex_id] = {
            "violations": 10,
            "cis_score": 25.0,
            "type": req.violation_type,
            "vehicle": req.vehicle_type
        }
    else:
        CITIZEN_BUMPS[hex_id]["violations"] += 5
        CITIZEN_BUMPS[hex_id]["cis_score"] += 15.0
        CITIZEN_BUMPS[hex_id]["type"] = req.violation_type
        CITIZEN_BUMPS[hex_id]["vehicle"] = req.vehicle_type

    # Cap the bump score contribution at 100
    
    # Resolve location name for dispatch description
    location_name = "Unknown Bengaluru Street"
    police_station = "BTP HQ"
    
    try:
        heatmap = load_json('heatmap.json')
        for feat in heatmap.get("features", []):
            if feat.get("properties", {}).get("hex_id") == hex_id:
                location_name = feat["properties"].get("location_name", location_name)
                police_station = feat["properties"].get("police_station", police_station)
                break
    except Exception:
        pass
        
    # Recalculate if it triggers an automated warning dispatch
    current_cis = 40.0
    try:
        current_cis = next(
            (feat["properties"]["cis_score"] for feat in heatmap.get("features", []) if feat["properties"]["hex_id"] == hex_id), 
            40.0
        )
    except Exception:
        pass
        
    updated_cis = min(100.0, current_cis + CITIZEN_BUMPS[hex_id]["cis_score"])
    
    # If the score crosses the threshold, push a dispatch alert immediately!
    if updated_cis >= 80.0:
        new_alert = {
            "id": f"alert-{len(DISPATCH_ALERTS) + 101}",
            "hex_id": hex_id,
            "location": f"{location_name.split(',')[0]}, {police_station}",
            "type": req.violation_type,
            "vehicle": req.vehicle_type,
            "severity": "CRITICAL",
            "timestamp": "Just Now",
            "description": f"AUTOMATED ALERT: Public Eye citizen upload. {req.description or 'Double-parking reported.'}"
        }
        if not any(a["hex_id"] == hex_id for a in DISPATCH_ALERTS):
            DISPATCH_ALERTS.insert(0, new_alert)
            
    return {
        "status": "success", 
        "hex_id": hex_id, 
        "updated_cis": updated_cis,
        "dispatch_triggered": updated_cis >= 80.0
    }

@app.post("/api/incidents/clear")
def clear_incident(req: ClearRequest):
    global CITIZEN_BUMPS, DISPATCH_ALERTS
    hex_id = req.hex_id
    if hex_id in CITIZEN_BUMPS:
        del CITIZEN_BUMPS[hex_id]
    
    # Remove from dispatch list
    DISPATCH_ALERTS = [a for a in DISPATCH_ALERTS if a["hex_id"] != hex_id]
    return {"status": "success", "hex_id": hex_id, "active_alerts": len(DISPATCH_ALERTS)}


# ============================================================
# OVERRIDDEN GET ENDPOINTS (DYNAMIC DATA INJECTION)
# ============================================================

@app.get("/")
def root():
    return {"name": "ParkSense AI", "status": "running", "version": "1.0.0", "weather": WEATHER_MODE}


@app.get("/api/overview")
def get_overview():
    """Get city-wide overview statistics (weather modulated)."""
    data = load_json('overview.json')
    
    # Add citizen bumps sum
    bumps_violations = sum(b["violations"] for b in CITIZEN_BUMPS.values())
    data["total_violations"] += bumps_violations
    
    # Modulate violations based on weather
    if WEATHER_MODE == "rain":
        data["total_violations"] = int(data["total_violations"] * 1.25)
        data["critical_hotspots"] += 4
        data["high_priority_hotspots"] += 6
    elif WEATHER_MODE == "vip":
        data["total_violations"] = int(data["total_violations"] * 1.1)
        data["critical_hotspots"] += 2
        data["high_priority_hotspots"] += 3
        
    return data


@app.get("/api/heatmap")
def get_heatmap():
    """Get GeoJSON heatmap of all hex cells with weather/citizen dynamic adjustments."""
    data = load_json('heatmap.json')
    
    for feature in data.get("features", []):
        props = feature.get("properties", {})
        hid = props.get("hex_id")
        
        # Apply citizen bumps
        if hid in CITIZEN_BUMPS:
            props["total_violations"] += CITIZEN_BUMPS[hid]["violations"]
            props["cis_score"] = min(100.0, props["cis_score"] + CITIZEN_BUMPS[hid]["cis_score"])
            props["dominant_violation"] = CITIZEN_BUMPS[hid]["type"]
            props["dominant_vehicle"] = CITIZEN_BUMPS[hid]["vehicle"]
            
        # Apply weather multipliers
        if WEATHER_MODE == "rain":
            props["cis_score"] = min(100.0, props["cis_score"] * 1.25)
            props["total_violations"] = int(props["total_violations"] * 1.2)
        elif WEATHER_MODE == "vip":
            # VIP routes are heavily choked (boost scores globally by 35% on critical corridors)
            if props["cis_score"] >= 40.0:
                props["cis_score"] = min(100.0, props["cis_score"] * 1.35)
                props["total_violations"] = int(props["total_violations"] * 1.3)
                
        # Reevaluate category
        props["cis_category"] = get_cis_category(props["cis_score"])
        
    return data


@app.get("/api/heatmap/hourly/{hour}")
def get_hourly_heatmap(hour: int):
    """Get hex cell data for a specific hour of day."""
    if hour < 0 or hour > 23:
        raise HTTPException(status_code=400, detail="Hour must be 0-23")
    
    data = load_json(f'hourly/hour_{hour:02d}.json')
    for cell in data:
        hid = cell.get("hex_id")
        if hid in CITIZEN_BUMPS:
            cell["total_violations"] += CITIZEN_BUMPS[hid]["violations"]
            cell["cis_score"] = min(100.0, cell["cis_score"] + CITIZEN_BUMPS[hid]["cis_score"])
            
        if WEATHER_MODE == "rain":
            cell["cis_score"] = min(100.0, cell["cis_score"] * 1.25)
            cell["total_violations"] = int(cell["total_violations"] * 1.2)
        elif WEATHER_MODE == "vip":
            if cell["cis_score"] >= 40.0:
                cell["cis_score"] = min(100.0, cell["cis_score"] * 1.35)
                
    return data


@app.get("/api/hotspots")
def get_hotspots(top: int = Query(default=50, ge=1, le=100)):
    """Get top N hotspots ranked by CIS score, dynamic calculations applied."""
    hotspots = load_json('hotspots.json')
    
    for hs in hotspots:
        hid = hs.get("hex_id")
        if hid in CITIZEN_BUMPS:
            hs["total_violations"] += CITIZEN_BUMPS[hid]["violations"]
            hs["cis_score"] = min(100.0, hs["cis_score"] + CITIZEN_BUMPS[hid]["cis_score"])
            hs["dominant_violation"] = CITIZEN_BUMPS[hid]["type"]
            
        if WEATHER_MODE == "rain":
            hs["cis_score"] = min(100.0, hs["cis_score"] * 1.25)
            hs["total_violations"] = int(hs["total_violations"] * 1.2)
        elif WEATHER_MODE == "vip":
            if hs["cis_score"] >= 40.0:
                hs["cis_score"] = min(100.0, hs["cis_score"] * 1.35)
                hs["total_violations"] = int(hs["total_violations"] * 1.3)
                
    # Re-sort based on updated CIS score
    hotspots.sort(key=lambda x: x["cis_score"], reverse=True)
    return hotspots[:top]


@app.get("/api/hotspot/{hex_id}")
def get_hotspot_detail(hex_id: str):
    """Get detailed breakdown of a specific hotspot (with weather/incident logic)."""
    safe_name = hex_id.replace('/', '_')
    try:
        data = load_json(f'hotspot_details/{safe_name}.json')
        
        # Apply edits to deep-dive details
        if hex_id in CITIZEN_BUMPS:
            data["total_violations"] += CITIZEN_BUMPS[hex_id]["violations"]
            data["daily_avg"] = round(data["total_violations"] / 6.0, 1)
            
        if WEATHER_MODE == "rain":
            data["total_violations"] = int(data["total_violations"] * 1.2)
            data["daily_avg"] = round(data["total_violations"] / 6.0, 1)
            
        return data
    except HTTPException:
        raise HTTPException(status_code=404, detail=f"Hotspot {hex_id} not found")


@app.get("/api/forecast")
def get_forecast():
    """Get predicted hotspots for next period, injecting standard error confidence intervals."""
    data = load_json('forecast.json')
    
    # Inject simulated 95% Confidence Intervals
    for pred in data.get("predictions", []):
        pred_total = pred["predicted_total"]
        # Standard error estimation
        se = pred_total * 0.05
        pred["predicted_total_lower"] = max(0, int(pred_total - 1.96 * se))
        pred["predicted_total_upper"] = int(pred_total + 1.96 * se)
        
        # Adjust based on weather
        if WEATHER_MODE == "rain":
            pred["predicted_total"] = int(pred_total * 1.2)
            pred["predicted_total_lower"] = int(pred["predicted_total_lower"] * 1.2)
            pred["predicted_total_upper"] = int(pred["predicted_total_upper"] * 1.2)
            pred["cis_score"] = min(100.0, pred["cis_score"] * 1.2)
            
    return data


@app.get("/api/forecast/shap/{hex_id}")
def get_shap_explanation(hex_id: str):
    """Get SHAP explanation for a specific hotspot prediction."""
    safe_name = hex_id.replace('/', '_')
    try:
        return load_json(f'shap/{safe_name}.json')
    except HTTPException:
        raise HTTPException(status_code=404, detail=f"SHAP data for {hex_id} not found")


@app.get("/api/stations")
def get_stations():
    """Get analytics for all police stations."""
    return load_json('stations.json')


@app.get("/api/enforce")
def get_enforcement_routes(officers: int = Query(default=5, ge=1, le=20)):
    """Get optimized patrol routes for N officers."""
    try:
        from route_optimizer import optimize_routes
        # Read hex aggregates
        hex_agg = pd.read_csv(os.path.join(DATA_DIR, 'hex_aggregates.csv'))
        return optimize_routes(hex_agg, officers)
    except Exception as e:
        # Fallback to closest pre-computed option if dynamic optimization fails
        available = [3, 5, 8, 10, 15, 20]
        closest = min(available, key=lambda x: abs(x - officers))
        return load_json(f'enforce/officers_{closest}.json')


@app.get("/api/timelapse")
def get_timelapse():
    """Get 24-hour timelapse animation data."""
    data = load_json('timelapse.json')
    
    # Modulate timelapse scores based on weather mode
    if WEATHER_MODE != "sunny":
        multiplier = 1.25 if WEATHER_MODE == "rain" else 1.1
        for frame in data:
            frame["total_violations"] = int(frame["total_violations"] * multiplier)
            for hex_data in frame.get("hexes", []):
                if "count" in hex_data:
                    hex_data["count"] = int(hex_data["count"] * multiplier)
                if "severity" in hex_data:
                    hex_data["severity"] = min(100.0, hex_data["severity"] * multiplier)
                
    return data


@app.get("/api/model/metrics")
def get_model_metrics():
    """Get ML model evaluation metrics."""
    return load_json('model_metrics.json')


@app.get("/api/scenarios")
def get_scenarios():
    """Get pre-computed simulation scenarios."""
    return load_json('scenarios.json')


class SimulationRequest(BaseModel):
    target_hexes: List[str]
    n_officers: int = 5
    time_window: str = "all"


@app.post("/api/simulate")
def run_simulation(request: SimulationRequest):
    """Run a custom what-if simulation."""
    from simulator import simulate_enforcement
    
    hex_agg = pd.read_csv(os.path.join(DATA_DIR, 'hex_aggregates.csv'))
    
    result = simulate_enforcement(
        hex_agg,
        request.target_hexes,
        n_officers=request.n_officers,
        time_window=request.time_window,
    )
    
    return result


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
