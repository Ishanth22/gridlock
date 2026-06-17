"""
ParkSense AI — Master ETL & Data Preprocessing Pipeline
Transforms raw parking violation CSV into H3-indexed, CIS-scored analysis-ready data.
Generates all pre-computed JSON files for the API.
"""

import pandas as pd
import numpy as np
import h3
import json
import os
import ast
from datetime import datetime
from collections import Counter

# ============================================================
# CONFIGURATION
# ============================================================
RAW_CSV = os.path.join(os.path.dirname(__file__), '..', 'jan to may police violation_anonymized791b166.csv')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'data')
H3_RESOLUTION = 8  # ~460m edge length — city-level view
H3_RESOLUTION_DETAIL = 9  # ~174m edge — neighborhood drill-down

# Violation severity weights (impact on traffic flow)
VIOLATION_SEVERITY = {
    'DOUBLE PARKING': 5.0,
    'PARKING NEAR TRAFFIC LIGHT OR ZEBRA CROSS': 4.5,
    'PARKING IN A MAIN ROAD': 4.5,
    'PARKING NEAR ROAD CROSSING': 4.0,
    'PARKING NEAR BUSTOP/SCHOOL/HOSPITAL ETC': 4.0,
    'PARKING OPPOSITE TO ANOTHER PARKED VEHICLE': 3.5,
    'PARKING ON FOOTPATH': 3.5,
    'PARKING OTHER THAN BUS STOP': 3.0,
    'NO PARKING': 3.0,
    'WRONG PARKING': 2.5,
    'STOPING ON WHITE/STOP LINE': 4.0,
    'DEFECTIVE NUMBER PLATE': 1.0,
    'REFUSE TO GO FOR HIRE': 1.0,
    'DEMANDING EXCESS FARE': 1.0,
    'USING BLACK FILM/OTHER MATERIALS': 1.0,
    'WITHOUT SIDE MIRROR': 1.0,
    'H T V PROHIBITED': 2.0,
    'OBSTRUCTING DRIVER': 2.0,
    'AGAINST ONE WAY/NO ENTRY': 3.5,
    'FAIL TO USE SAFETY BELTS': 1.0,
    'VIOLATING LANE DISIPLINE': 2.5,
    'RIDER NOT WEARING HELMET': 1.0,
    '2W/3W - USING MOBILE PHONE': 1.0,
    'OTHER - USING MOBILE PHONE': 1.0,
    'CARRYING LENGHTY MATERIAL': 2.0,
    'JUMPING TRAFFIC SIGNAL': 3.0,
    'U TURN PROHIBITED': 2.5,
}

# Lane blockage estimation per violation type (percentage)
LANE_BLOCKAGE = {
    'DOUBLE PARKING': 70,
    'PARKING NEAR TRAFFIC LIGHT OR ZEBRA CROSS': 60,
    'PARKING IN A MAIN ROAD': 50,
    'PARKING NEAR ROAD CROSSING': 45,
    'PARKING NEAR BUSTOP/SCHOOL/HOSPITAL ETC': 40,
    'PARKING OPPOSITE TO ANOTHER PARKED VEHICLE': 60,
    'PARKING ON FOOTPATH': 15,
    'PARKING OTHER THAN BUS STOP': 30,
    'NO PARKING': 30,
    'WRONG PARKING': 25,
    'STOPING ON WHITE/STOP LINE': 40,
}

# Vehicle type size factor (larger vehicles block more)
VEHICLE_SIZE = {
    'HGV': 3.0,
    'TOURIST BUS': 2.8,
    'PRIVATE BUS': 2.8,
    'TEMPO': 2.5,
    'MAXI-CAB': 2.2,
    'LGV': 2.0,
    'VAN': 1.8,
    'JEEP': 1.5,
    'CAR': 1.3,
    'GOODS AUTO': 1.2,
    'PASSENGER AUTO': 1.0,
    'SCOOTER': 0.6,
    'MOTOR CYCLE': 0.6,
    'MOPED': 0.5,
    'OTHERS': 1.0,
}


def load_and_clean(csv_path: str) -> pd.DataFrame:
    """Load raw CSV and perform cleaning."""
    print("[1/8] Loading raw CSV...")
    df = pd.read_csv(csv_path)
    print(f"  Loaded {len(df):,} records")

    # Filter approved violations only
    approved_mask = df['validation_status'] == 'approved'
    print(f"  Approved records: {approved_mask.sum():,} ({approved_mask.mean()*100:.1f}%)")
    df = df[approved_mask].copy()

    # Drop rows with missing coordinates
    df = df.dropna(subset=['latitude', 'longitude'])

    # Parse datetime
    df['created_datetime'] = pd.to_datetime(df['created_datetime'], errors='coerce', utc=True)
    df = df.dropna(subset=['created_datetime'])

    # Convert to IST
    df['created_datetime'] = df['created_datetime'].dt.tz_convert('Asia/Kolkata')

    # Extract temporal features
    df['hour'] = df['created_datetime'].dt.hour
    df['day_of_week'] = df['created_datetime'].dt.dayofweek  # 0=Mon, 6=Sun
    df['day_name'] = df['created_datetime'].dt.day_name()
    df['month'] = df['created_datetime'].dt.month
    df['date'] = df['created_datetime'].dt.date
    df['week'] = df['created_datetime'].dt.isocalendar().week.astype(int)
    df['year_month'] = df['created_datetime'].dt.to_period('M').astype(str)

    print(f"  After cleaning: {len(df):,} records")
    print(f"  Date range: {df['created_datetime'].min()} to {df['created_datetime'].max()}")
    return df


def parse_violations(df: pd.DataFrame) -> pd.DataFrame:
    """Parse the JSON array violation_type column into individual flags."""
    print("[2/8] Parsing violation types...")

    def extract_violations(val):
        try:
            parsed = ast.literal_eval(val)
            if isinstance(parsed, list):
                return parsed
        except (ValueError, SyntaxError):
            pass
        return [str(val)]

    df['violations_list'] = df['violation_type'].apply(extract_violations)
    df['violation_count'] = df['violations_list'].apply(len)

    # Calculate severity score per record
    def calc_severity(violations):
        scores = [VIOLATION_SEVERITY.get(v.strip(), 2.0) for v in violations]
        return np.mean(scores) if scores else 2.0

    df['severity_score'] = df['violations_list'].apply(calc_severity)

    # Calculate lane blockage per record
    def calc_blockage(violations):
        blockages = [LANE_BLOCKAGE.get(v.strip(), 20) for v in violations]
        return max(blockages) if blockages else 20

    df['lane_blockage_pct'] = df['violations_list'].apply(calc_blockage)

    # Vehicle size factor
    df['vehicle_size_factor'] = df['vehicle_type'].map(VEHICLE_SIZE).fillna(1.0)

    # Road type inference from violation types
    def infer_road_type(violations):
        vset = set(v.strip() for v in violations)
        if 'PARKING IN A MAIN ROAD' in vset:
            return 'arterial'
        elif 'DOUBLE PARKING' in vset or 'PARKING OPPOSITE TO ANOTHER PARKED VEHICLE' in vset:
            return 'narrow'
        elif 'PARKING ON FOOTPATH' in vset:
            return 'with_sidewalk'
        elif 'PARKING NEAR BUSTOP/SCHOOL/HOSPITAL ETC' in vset:
            return 'institutional'
        elif 'PARKING NEAR TRAFFIC LIGHT OR ZEBRA CROSS' in vset or 'PARKING NEAR ROAD CROSSING' in vset:
            return 'intersection'
        else:
            return 'general'

    df['inferred_road_type'] = df['violations_list'].apply(infer_road_type)

    # Road type multiplier for CIS
    road_multipliers = {
        'arterial': 2.0,
        'intersection': 1.8,
        'narrow': 1.7,
        'institutional': 1.5,
        'with_sidewalk': 1.3,
        'general': 1.0,
    }
    df['road_multiplier'] = df['inferred_road_type'].map(road_multipliers)

    # Flatten all violations for stats
    all_v = []
    for vlist in df['violations_list']:
        all_v.extend([v.strip() for v in vlist])
    violation_counts = Counter(all_v)
    print(f"  Top violations: {violation_counts.most_common(5)}")

    return df


def apply_h3_indexing(df: pd.DataFrame) -> pd.DataFrame:
    """Apply Uber H3 hexagonal spatial indexing."""
    print("[3/8] Applying H3 hexagonal indexing...")

    df['h3_res8'] = df.apply(
        lambda row: h3.latlng_to_cell(row['latitude'], row['longitude'], H3_RESOLUTION),
        axis=1
    )
    df['h3_res9'] = df.apply(
        lambda row: h3.latlng_to_cell(row['latitude'], row['longitude'], H3_RESOLUTION_DETAIL),
        axis=1
    )

    n_hex8 = df['h3_res8'].nunique()
    n_hex9 = df['h3_res9'].nunique()
    print(f"  Unique H3 cells (res8): {n_hex8:,}")
    print(f"  Unique H3 cells (res9): {n_hex9:,}")
    return df


def compute_hex_aggregates(df: pd.DataFrame) -> pd.DataFrame:
    """Compute per-hex-cell aggregated metrics for CIS scoring."""
    print("[4/8] Computing hex cell aggregates...")

    hex_agg = df.groupby('h3_res8').agg(
        total_violations=('id', 'count'),
        avg_severity=('severity_score', 'mean'),
        max_severity=('severity_score', 'max'),
        avg_lane_blockage=('lane_blockage_pct', 'mean'),
        max_lane_blockage=('lane_blockage_pct', 'max'),
        avg_vehicle_size=('vehicle_size_factor', 'mean'),
        unique_hours=('hour', 'nunique'),
        unique_days=('date', 'nunique'),
        lat_center=('latitude', 'mean'),
        lng_center=('longitude', 'mean'),
        road_multiplier=('road_multiplier', 'max'),
    ).reset_index()

    # Junction proximity boost
    junction_hexes = df[df['junction_name'] != 'No Junction']['h3_res8'].unique()
    hex_agg['is_junction'] = hex_agg['h3_res8'].isin(junction_hexes)
    hex_agg['junction_boost'] = hex_agg['is_junction'].apply(lambda x: 1.5 if x else 1.0)

    # Vehicle mix entropy (Shannon entropy of vehicle type distribution)
    def calc_vehicle_entropy(group):
        counts = group['vehicle_type'].value_counts(normalize=True)
        entropy = -np.sum(counts * np.log2(counts + 1e-10))
        return entropy

    vehicle_entropy = df.groupby('h3_res8').apply(calc_vehicle_entropy, include_groups=False).reset_index()
    vehicle_entropy.columns = ['h3_res8', 'vehicle_entropy']
    hex_agg = hex_agg.merge(vehicle_entropy, on='h3_res8', how='left')

    # Temporal persistence: ratio of active hours (0-1)
    hex_agg['temporal_persistence'] = hex_agg['unique_hours'] / 24.0

    # Dominant violation type per hex
    def get_dominant_violation(group):
        all_v = []
        for vlist in group['violations_list']:
            all_v.extend([v.strip() for v in vlist])
        if all_v:
            return Counter(all_v).most_common(1)[0][0]
        return 'UNKNOWN'

    dominant_v = df.groupby('h3_res8').apply(get_dominant_violation, include_groups=False).reset_index()
    dominant_v.columns = ['h3_res8', 'dominant_violation']
    hex_agg = hex_agg.merge(dominant_v, on='h3_res8', how='left')

    # Dominant vehicle type per hex
    dominant_veh = df.groupby('h3_res8')['vehicle_type'].agg(
        lambda x: x.value_counts().index[0]
    ).reset_index()
    dominant_veh.columns = ['h3_res8', 'dominant_vehicle']
    hex_agg = hex_agg.merge(dominant_veh, on='h3_res8', how='left')

    # Police station mapping
    station_map = df.groupby('h3_res8')['police_station'].agg(
        lambda x: x.value_counts().index[0]
    ).reset_index()
    station_map.columns = ['h3_res8', 'police_station']
    hex_agg = hex_agg.merge(station_map, on='h3_res8', how='left')

    # Junction name mapping
    junction_map = df.groupby('h3_res8')['junction_name'].agg(
        lambda x: x.value_counts().index[0]
    ).reset_index()
    junction_map.columns = ['h3_res8', 'junction_name']
    hex_agg = hex_agg.merge(junction_map, on='h3_res8', how='left')

    # Location name (most common)
    loc_map = df.dropna(subset=['location']).groupby('h3_res8')['location'].agg(
        lambda x: x.value_counts().index[0] if len(x) > 0 else 'Unknown'
    ).reset_index()
    loc_map.columns = ['h3_res8', 'location_name']
    hex_agg = hex_agg.merge(loc_map, on='h3_res8', how='left')
    hex_agg['location_name'] = hex_agg['location_name'].fillna('Unknown Location')

    print(f"  Computed aggregates for {len(hex_agg):,} hex cells")
    return hex_agg


def compute_cis_scores(hex_agg: pd.DataFrame) -> pd.DataFrame:
    """Compute Congestion Impact Score (CIS) for each hex cell."""
    print("[5/8] Computing Congestion Impact Scores (CIS)...")

    # Normalize components to 0-1
    def min_max_norm(series):
        mn, mx = series.min(), series.max()
        if mx - mn == 0:
            return pd.Series(0.5, index=series.index)
        return (series - mn) / (mx - mn)

    hex_agg['D_norm'] = min_max_norm(hex_agg['total_violations'])
    hex_agg['S_norm'] = min_max_norm(hex_agg['avg_severity'])
    hex_agg['P_norm'] = hex_agg['temporal_persistence']  # Already 0-1
    hex_agg['R_norm'] = min_max_norm(hex_agg['road_multiplier'])
    hex_agg['V_norm'] = min_max_norm(hex_agg['vehicle_entropy'])

    # CIS formula with weights
    w1, w2, w3, w4, w5, w6 = 0.30, 0.25, 0.15, 0.12, 0.10, 0.08
    hex_agg['cis_raw'] = (
        w1 * hex_agg['D_norm'] +
        w2 * hex_agg['S_norm'] +
        w3 * hex_agg['P_norm'] +
        w4 * hex_agg['R_norm'] +
        w5 * (2.0 * (hex_agg['junction_boost'] - 1.0)) +  # 0 or 1.0, normalized
        w6 * hex_agg['V_norm']
    )

    # Scale to 0-100
    hex_agg['cis_score'] = min_max_norm(hex_agg['cis_raw']) * 100

    # Classify severity
    def classify_cis(score):
        if score >= 80:
            return 'critical'
        elif score >= 60:
            return 'high'
        elif score >= 40:
            return 'moderate'
        else:
            return 'low'

    hex_agg['cis_category'] = hex_agg['cis_score'].apply(classify_cis)

    # Carriageway reduction estimate
    hex_agg['carriageway_reduction'] = (
        hex_agg['avg_lane_blockage'] *
        np.minimum(hex_agg['total_violations'] / hex_agg['unique_days'], 10) / 10
    ).clip(0, 85)  # Cap at 85%

    stats = hex_agg['cis_category'].value_counts()
    print(f"  CIS Distribution: {dict(stats)}")
    print(f"  Avg CIS: {hex_agg['cis_score'].mean():.1f}")
    print(f"  Max CIS: {hex_agg['cis_score'].max():.1f}")

    return hex_agg


def compute_hourly_data(df: pd.DataFrame) -> dict:
    """Compute per-hour hex aggregates for the time slider / timelapse."""
    print("[6/8] Computing hourly aggregates for timelapse...")

    hourly_data = {}
    for hour in range(24):
        hour_df = df[df['hour'] == hour]
        hex_hour = hour_df.groupby('h3_res8').agg(
            count=('id', 'count'),
            avg_severity=('severity_score', 'mean'),
            lat=('latitude', 'mean'),
            lng=('longitude', 'mean'),
        ).reset_index()

        # Normalize count for this hour
        if len(hex_hour) > 0:
            max_count = hex_hour['count'].max()
            hex_hour['intensity'] = (hex_hour['count'] / max_count * 100).round(1) if max_count > 0 else 0
        else:
            hex_hour['intensity'] = 0

        hourly_data[hour] = hex_hour.to_dict(orient='records')
        print(f"    Hour {hour:02d}: {len(hex_hour):,} active hex cells, {hour_df.shape[0]:,} violations")

    return hourly_data


def compute_hotspot_details(df: pd.DataFrame, hex_agg: pd.DataFrame) -> dict:
    """Compute detailed breakdown per hotspot for the deep-dive page."""
    print("[7/8] Computing hotspot details...")

    # Top 100 hotspots by CIS score
    top_hexes = hex_agg.nlargest(100, 'cis_score')['h3_res8'].tolist()
    details = {}

    for hex_id in top_hexes:
        hex_data = df[df['h3_res8'] == hex_id]
        hex_info = hex_agg[hex_agg['h3_res8'] == hex_id].iloc[0]

        # Temporal heatmap: 24h x 7 days
        temporal_matrix = np.zeros((7, 24))
        for _, row in hex_data.iterrows():
            temporal_matrix[row['day_of_week']][row['hour']] += 1
        temporal_matrix = temporal_matrix.tolist()

        # Violation type breakdown
        all_v = []
        for vlist in hex_data['violations_list']:
            all_v.extend([v.strip() for v in vlist])
        violation_breakdown = dict(Counter(all_v).most_common(10))

        # Vehicle type breakdown
        vehicle_breakdown = hex_data['vehicle_type'].value_counts().head(10).to_dict()

        # Monthly trend
        monthly_trend = hex_data.groupby('year_month')['id'].count().to_dict()

        # Peak hours
        hourly_counts = hex_data['hour'].value_counts().sort_index()
        peak_hour = int(hourly_counts.idxmax()) if len(hourly_counts) > 0 else 0

        # Neighbors
        neighbors = h3.grid_ring(hex_id, 1)
        neighbor_cis = []
        for n in neighbors:
            n_data = hex_agg[hex_agg['h3_res8'] == n]
            if len(n_data) > 0:
                neighbor_cis.append({
                    'hex_id': n,
                    'cis_score': round(float(n_data.iloc[0]['cis_score']), 1),
                    'violations': int(n_data.iloc[0]['total_violations']),
                })

        # Generate AI insight text
        daily_avg = hex_info['total_violations'] / max(hex_info['unique_days'], 1)
        top_violation = list(violation_breakdown.keys())[0] if violation_breakdown else 'Unknown'
        top_vehicle = list(vehicle_breakdown.keys())[0] if vehicle_breakdown else 'Unknown'

        insight = (
            f"This hotspot in {hex_info.get('police_station', 'Unknown')} averages "
            f"{daily_avg:.0f} violations/day, peaking at {peak_hour:02d}:00. "
            f"Primarily {top_violation} by {top_vehicle}s "
            f"({list(vehicle_breakdown.values())[0] if vehicle_breakdown else 0} incidents). "
        )
        if hex_info['is_junction']:
            insight += f"Located at {hex_info.get('junction_name', 'a BTP junction')}, "
        if hex_info['road_multiplier'] >= 1.5:
            insight += f"on {'an arterial' if hex_info['road_multiplier'] >= 2.0 else 'a major'} road, "
        insight += (
            f"causing an estimated {hex_info['carriageway_reduction']:.0f}% carriageway reduction. "
            f"CIS score: {hex_info['cis_score']:.1f}/100 ({hex_info['cis_category']})."
        )

        details[hex_id] = {
            'hex_id': hex_id,
            'cis_score': round(float(hex_info['cis_score']), 1),
            'cis_category': hex_info['cis_category'],
            'total_violations': int(hex_info['total_violations']),
            'daily_average': round(daily_avg, 1),
            'carriageway_reduction': round(float(hex_info['carriageway_reduction']), 1),
            'lat': round(float(hex_info['lat_center']), 6),
            'lng': round(float(hex_info['lng_center']), 6),
            'location_name': hex_info.get('location_name', 'Unknown'),
            'police_station': hex_info.get('police_station', 'Unknown'),
            'junction_name': hex_info.get('junction_name', 'No Junction'),
            'is_junction': bool(hex_info['is_junction']),
            'dominant_violation': hex_info.get('dominant_violation', 'Unknown'),
            'dominant_vehicle': hex_info.get('dominant_vehicle', 'Unknown'),
            'peak_hour': peak_hour,
            'temporal_matrix': temporal_matrix,
            'violation_breakdown': violation_breakdown,
            'vehicle_breakdown': vehicle_breakdown,
            'monthly_trend': monthly_trend,
            'hourly_distribution': hourly_counts.to_dict(),
            'neighbors': neighbor_cis,
            'ai_insight': insight,
        }

    print(f"  Generated details for {len(details)} hotspots")
    return details


def generate_overview(df: pd.DataFrame, hex_agg: pd.DataFrame) -> dict:
    """Generate city-wide overview statistics."""
    print("[8/8] Generating overview statistics...")

    total = len(df)
    months = sorted(df['year_month'].unique().tolist())

    # Monthly trend
    monthly = df.groupby('year_month')['id'].count().to_dict()

    # Day of week distribution
    dow = df['day_name'].value_counts().to_dict()

    # Hourly distribution
    hourly = df.groupby('hour')['id'].count().to_dict()
    hourly = {str(k): v for k, v in hourly.items()}

    # Top stations
    station_stats = df.groupby('police_station').agg(
        violations=('id', 'count'),
        avg_severity=('severity_score', 'mean'),
    ).sort_values('violations', ascending=False).head(20)
    top_stations = station_stats.reset_index().to_dict(orient='records')

    # Vehicle type distribution
    vehicle_dist = df['vehicle_type'].value_counts().to_dict()

    # Violation type distribution (flattened)
    all_v = []
    for vlist in df['violations_list']:
        all_v.extend([v.strip() for v in vlist])
    violation_dist = dict(Counter(all_v).most_common(15))

    # CIS summary
    cis_summary = hex_agg['cis_category'].value_counts().to_dict()
    critical_count = int((hex_agg['cis_score'] >= 80).sum())
    high_count = int((hex_agg['cis_score'] >= 60).sum())

    # Junction stats
    junction_violations = int((df['junction_name'] != 'No Junction').sum())
    non_junction = int((df['junction_name'] == 'No Junction').sum())

    # Enforcement rate
    enforcement_rate = float(df['data_sent_to_scita'].mean() * 100)

    overview = {
        'total_violations': total,
        'total_hex_cells': len(hex_agg),
        'date_range': {
            'start': str(df['created_datetime'].min().date()),
            'end': str(df['created_datetime'].max().date()),
        },
        'months_covered': months,
        'monthly_trend': monthly,
        'day_of_week': dow,
        'hourly_distribution': hourly,
        'top_stations': top_stations,
        'vehicle_distribution': vehicle_dist,
        'violation_distribution': violation_dist,
        'cis_summary': cis_summary,
        'critical_hotspots': critical_count,
        'high_priority_hotspots': high_count,
        'avg_cis': round(float(hex_agg['cis_score'].mean()), 1),
        'max_cis': round(float(hex_agg['cis_score'].max()), 1),
        'junction_violations': junction_violations,
        'non_junction_violations': non_junction,
        'enforcement_rate': round(enforcement_rate, 1),
        'total_police_stations': int(df['police_station'].nunique()),
        'total_junctions': int(df[df['junction_name'] != 'No Junction']['junction_name'].nunique()),
    }

    return overview


def generate_heatmap_geojson(hex_agg: pd.DataFrame) -> dict:
    """Generate GeoJSON of all hex cells with CIS scores for MapLibre."""
    print("  Generating heatmap GeoJSON...")

    features = []
    for _, row in hex_agg.iterrows():
        # Get hex boundary as polygon coordinates
        boundary = h3.cell_to_boundary(row['h3_res8'])
        # h3 returns (lat, lng) tuples — GeoJSON needs [lng, lat]
        coords = [[lng, lat] for lat, lng in boundary]
        coords.append(coords[0])  # Close the polygon

        feature = {
            'type': 'Feature',
            'id': row['h3_res8'],
            'geometry': {
                'type': 'Polygon',
                'coordinates': [coords],
            },
            'properties': {
                'hex_id': row['h3_res8'],
                'cis_score': round(float(row['cis_score']), 1),
                'cis_category': row['cis_category'],
                'total_violations': int(row['total_violations']),
                'avg_severity': round(float(row['avg_severity']), 2),
                'carriageway_reduction': round(float(row['carriageway_reduction']), 1),
                'dominant_violation': row.get('dominant_violation', ''),
                'dominant_vehicle': row.get('dominant_vehicle', ''),
                'police_station': row.get('police_station', ''),
                'junction_name': row.get('junction_name', ''),
                'is_junction': bool(row['is_junction']),
                'location_name': row.get('location_name', ''),
                'lat': round(float(row['lat_center']), 6),
                'lng': round(float(row['lng_center']), 6),
                'temporal_persistence': round(float(row['temporal_persistence']), 2),
                'daily_avg': round(float(row['total_violations'] / max(row['unique_days'], 1)), 1),
            }
        }
        features.append(feature)

    geojson = {
        'type': 'FeatureCollection',
        'features': features,
    }

    print(f"  Generated GeoJSON with {len(features)} hex features")
    return geojson


def generate_station_analytics(df: pd.DataFrame, hex_agg: pd.DataFrame) -> list:
    """Generate per-police-station analytics."""
    print("  Generating station analytics...")

    stations = []
    for station, group in df.groupby('police_station'):
        station_hexes = hex_agg[hex_agg['police_station'] == station]
        avg_cis = float(station_hexes['cis_score'].mean()) if len(station_hexes) > 0 else 0
        max_cis = float(station_hexes['cis_score'].max()) if len(station_hexes) > 0 else 0
        critical = int((station_hexes['cis_score'] >= 80).sum())

        # Monthly trend for this station
        monthly = group.groupby('year_month')['id'].count().to_dict()

        # Hourly pattern
        hourly = group['hour'].value_counts().sort_index().to_dict()

        # Top violations
        all_v = []
        for vlist in group['violations_list']:
            all_v.extend([v.strip() for v in vlist])
        top_violations = dict(Counter(all_v).most_common(5))

        # Enforcement rate
        enforcement = float(group['data_sent_to_scita'].mean() * 100)

        stations.append({
            'name': station,
            'total_violations': len(group),
            'avg_cis': round(avg_cis, 1),
            'max_cis': round(max_cis, 1),
            'critical_hotspots': critical,
            'hex_cells': len(station_hexes),
            'enforcement_rate': round(enforcement, 1),
            'monthly_trend': monthly,
            'hourly_pattern': {str(k): v for k, v in hourly.items()},
            'top_violations': top_violations,
        })

    stations.sort(key=lambda x: x['total_violations'], reverse=True)
    print(f"  Generated analytics for {len(stations)} stations")
    return stations


def generate_timelapse_data(df: pd.DataFrame) -> list:
    """Generate 24-frame timelapse data for animated heatmap."""
    print("  Generating timelapse data...")

    frames = []
    for hour in range(24):
        hour_df = df[df['hour'] == hour]
        hex_counts = hour_df.groupby('h3_res8').agg(
            count=('id', 'count'),
            severity=('severity_score', 'mean'),
        ).reset_index()

        hex_list = []
        for _, row in hex_counts.iterrows():
            boundary = h3.cell_to_boundary(row['h3_res8'])
            coords = [[lng, lat] for lat, lng in boundary]
            coords.append(coords[0])

            hex_list.append({
                'hex_id': row['h3_res8'],
                'count': int(row['count']),
                'severity': round(float(row['severity']), 2),
                'coordinates': coords,
            })

        frames.append({
            'hour': hour,
            'total_violations': len(hour_df),
            'active_hexes': len(hex_list),
            'hexes': hex_list,
        })

    return frames


def save_json(data, filepath):
    """Save data as JSON file."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'w') as f:
        json.dump(data, f, default=str)


def main():
    """Run the full preprocessing pipeline."""
    print("=" * 60)
    print("ParkSense AI — Data Preprocessing Pipeline")
    print("=" * 60)

    # Step 1: Load and clean
    df = load_and_clean(RAW_CSV)

    # Step 2: Parse violations
    df = parse_violations(df)

    # Step 3: H3 indexing
    df = apply_h3_indexing(df)

    # Step 4: Hex cell aggregates
    hex_agg = compute_hex_aggregates(df)

    # Step 5: CIS scores
    hex_agg = compute_cis_scores(hex_agg)

    # Step 6: Hourly data
    hourly_data = compute_hourly_data(df)

    # Step 7: Hotspot details
    hotspot_details = compute_hotspot_details(df, hex_agg)

    # Step 8: Overview
    overview = generate_overview(df, hex_agg)

    # ============================================================
    # SAVE ALL PRE-COMPUTED DATA
    # ============================================================
    print("\n" + "=" * 60)
    print("Saving pre-computed JSON files...")
    print("=" * 60)

    # Overview
    save_json(overview, os.path.join(OUTPUT_DIR, 'overview.json'))
    print("  [OK] overview.json")

    # Heatmap GeoJSON
    heatmap = generate_heatmap_geojson(hex_agg)
    save_json(heatmap, os.path.join(OUTPUT_DIR, 'heatmap.json'))
    print("  [OK] heatmap.json")

    # Hourly data
    for hour, data in hourly_data.items():
        save_json(data, os.path.join(OUTPUT_DIR, 'hourly', f'hour_{hour:02d}.json'))
    print("  [OK] hourly/*.json (24 files)")

    # Hotspots list (top 50 by CIS)
    top_hotspots = hex_agg.nlargest(50, 'cis_score')[[
        'h3_res8', 'cis_score', 'cis_category', 'total_violations',
        'avg_severity', 'carriageway_reduction', 'lat_center', 'lng_center',
        'police_station', 'junction_name', 'is_junction', 'dominant_violation',
        'dominant_vehicle', 'location_name', 'temporal_persistence',
    ]].copy()
    top_hotspots.columns = [
        'hex_id', 'cis_score', 'cis_category', 'total_violations',
        'avg_severity', 'carriageway_reduction', 'lat', 'lng',
        'police_station', 'junction_name', 'is_junction', 'dominant_violation',
        'dominant_vehicle', 'location_name', 'temporal_persistence',
    ]
    top_hotspots['cis_score'] = top_hotspots['cis_score'].round(1)
    top_hotspots['avg_severity'] = top_hotspots['avg_severity'].round(2)
    top_hotspots['carriageway_reduction'] = top_hotspots['carriageway_reduction'].round(1)
    top_hotspots['lat'] = top_hotspots['lat'].round(6)
    top_hotspots['lng'] = top_hotspots['lng'].round(6)
    save_json(top_hotspots.to_dict(orient='records'), os.path.join(OUTPUT_DIR, 'hotspots.json'))
    print("  [OK] hotspots.json")

    # Hotspot details (individual files)
    for hex_id, detail in hotspot_details.items():
        safe_name = hex_id.replace('/', '_')
        save_json(detail, os.path.join(OUTPUT_DIR, 'hotspot_details', f'{safe_name}.json'))
    print(f"  [OK] hotspot_details/*.json ({len(hotspot_details)} files)")

    # Station analytics
    stations = generate_station_analytics(df, hex_agg)
    save_json(stations, os.path.join(OUTPUT_DIR, 'stations.json'))
    print("  [OK] stations.json")

    # Timelapse
    timelapse = generate_timelapse_data(df)
    save_json(timelapse, os.path.join(OUTPUT_DIR, 'timelapse.json'))
    print("  [OK] timelapse.json")

    # Save hex_agg as CSV for ML pipeline
    hex_agg.to_csv(os.path.join(OUTPUT_DIR, 'hex_aggregates.csv'), index=False)
    print("  [OK] hex_aggregates.csv")

    # Save cleaned df for ML pipeline (important columns only)
    ml_cols = [
        'h3_res8', 'hour', 'day_of_week', 'month', 'week', 'year_month',
        'severity_score', 'lane_blockage_pct', 'vehicle_type', 'vehicle_size_factor',
        'inferred_road_type', 'road_multiplier', 'junction_name', 'police_station',
    ]
    df[ml_cols].to_csv(os.path.join(OUTPUT_DIR, 'cleaned_for_ml.csv'), index=False)
    print("  [OK] cleaned_for_ml.csv")

    print("\n" + "=" * 60)
    print("PREPROCESSING COMPLETE!")
    print(f"  Total records processed: {len(df):,}")
    print(f"  Hex cells generated: {len(hex_agg):,}")
    print(f"  Critical hotspots (CIS >= 80): {(hex_agg['cis_score'] >= 80).sum()}")
    print(f"  High priority (CIS >= 60): {(hex_agg['cis_score'] >= 60).sum()}")
    print(f"  Output directory: {os.path.abspath(OUTPUT_DIR)}")
    print("=" * 60)


if __name__ == '__main__':
    main()
