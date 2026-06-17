"""
ParkSense AI -- What-If Scenario Simulator with Displacement/Diffusion Modeling
Simulates enforcement deployment and models violation displacement to adjacent areas.
"""

import pandas as pd
import numpy as np
import json
import os
import h3

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

# Calibrated from data_sent_to_scita success patterns
ENFORCEMENT_EFFECTIVENESS = 0.65  # 65% of violations suppressed
DISPLACEMENT_RATE = 0.25  # 25% of suppressed violations shift to neighbors
DISTANCE_DECAY = 0.5  # Exponential decay per ring distance


def load_data():
    """Load hex aggregates and heatmap data."""
    hex_agg = pd.read_csv(os.path.join(DATA_DIR, 'hex_aggregates.csv'))
    with open(os.path.join(DATA_DIR, 'heatmap.json'), 'r') as f:
        heatmap = json.load(f)
    return hex_agg, heatmap


def simulate_enforcement(hex_agg, target_hex_ids, n_officers=5, time_window='all'):
    """
    Simulate what happens when enforcement is deployed to target hex cells.
    
    Args:
        hex_agg: DataFrame with hex cell data
        target_hex_ids: list of H3 hex IDs to deploy enforcement
        n_officers: number of officers to deploy
        time_window: 'morning', 'afternoon', 'evening', 'night', or 'all'
    
    Returns:
        Simulation results with before/after CIS, displacement analysis
    """
    # Create working copy
    sim = hex_agg.copy()
    sim = sim.set_index('h3_res8')
    
    # Time window multiplier (enforcement is less effective during off-hours)
    time_multiplier = {
        'morning': 0.8,    # 6 AM - 12 PM
        'afternoon': 0.9,  # 12 PM - 6 PM
        'evening': 1.0,    # 6 PM - 12 AM (peak effectiveness during peak violations)
        'night': 0.7,      # 12 AM - 6 AM
        'all': 0.85,       # Full day average
    }.get(time_window, 0.85)
    
    # Track changes
    before_state = {}
    after_state = {}
    displacement_targets = {}
    
    total_suppressed = 0
    total_displaced = 0
    
    for hex_id in target_hex_ids:
        if hex_id not in sim.index:
            continue
        
        hex_data = sim.loc[hex_id]
        original_violations = hex_data['total_violations']
        original_cis = hex_data['cis_score']
        
        before_state[hex_id] = {
            'violations': int(original_violations),
            'cis_score': round(float(original_cis), 1),
        }
        
        # Apply enforcement effectiveness
        effective_rate = ENFORCEMENT_EFFECTIVENESS * time_multiplier
        # More officers = slightly higher effectiveness (diminishing returns)
        officer_boost = min(1.0, 0.7 + 0.3 * (n_officers / len(target_hex_ids)))
        effective_rate *= officer_boost
        
        suppressed = original_violations * effective_rate
        remaining = original_violations - suppressed
        total_suppressed += suppressed
        
        # Update target hex
        new_violations = max(0, remaining)
        violation_ratio = new_violations / max(original_violations, 1)
        new_cis = original_cis * (0.3 + 0.7 * violation_ratio)  # CIS doesn't drop linearly
        
        after_state[hex_id] = {
            'violations': int(new_violations),
            'cis_score': round(float(new_cis), 1),
            'reduction_pct': round((1 - violation_ratio) * 100, 1),
        }
        
        # Displacement rate varies dynamically by road width constraints (carriageway reduction).
        # Narrow, heavily blocked streets force drivers to relocate to neighboring areas (+ displacement).
        # Wide streets allow local absorption, reducing neighbor spillover.
        carriageway_val = float(hex_data.get('carriageway_reduction', 20.0))
        local_displacement_rate = 0.15 + (0.25 * (carriageway_val / 100.0))
        
        displaced = suppressed * local_displacement_rate
        total_displaced += displaced
        
        try:
            neighbors = list(h3.grid_ring(hex_id, 1))
        except Exception:
            neighbors = []
            
        n_neighbors = len(neighbors)
        if n_neighbors > 0:
            displaced_per_neighbor = displaced / n_neighbors * DISTANCE_DECAY
            
            for neighbor_id in neighbors:
                if neighbor_id not in displacement_targets:
                    displacement_targets[neighbor_id] = {
                        'hex_id': neighbor_id,
                        'displaced_violations': 0,
                        'sources': [],
                    }
                displacement_targets[neighbor_id]['displaced_violations'] += displaced_per_neighbor
                displacement_targets[neighbor_id]['sources'].append(hex_id)
        
        # Ring 2 displacement (smaller effect)
        try:
            ring2 = list(h3.grid_ring(hex_id, 2))
        except Exception:
            ring2 = []
            
        if ring2:
            displaced_r2 = displaced * local_displacement_rate * (DISTANCE_DECAY ** 2)
            displaced_per_r2 = displaced_r2 / len(ring2)
            
            for neighbor_id in ring2:
                if neighbor_id not in displacement_targets:
                    displacement_targets[neighbor_id] = {
                        'hex_id': neighbor_id,
                        'displaced_violations': 0,
                        'sources': [],
                    }
                displacement_targets[neighbor_id]['displaced_violations'] += displaced_per_r2
    
    # Compute displacement impact on neighbor CIS
    spillover_hexes = []
    for neighbor_id, disp_data in displacement_targets.items():
        if neighbor_id in [h for h in target_hex_ids]:
            continue  # Skip target hexes
            
        if neighbor_id in sim.index:
            original_n = sim.loc[neighbor_id]
            new_violations = original_n['total_violations'] + disp_data['displaced_violations']
            violation_increase_pct = (disp_data['displaced_violations'] / max(original_n['total_violations'], 1)) * 100
            
            spillover_hexes.append({
                'hex_id': neighbor_id,
                'original_violations': int(original_n['total_violations']),
                'displaced_violations_added': round(disp_data['displaced_violations'], 0),
                'new_total': round(new_violations, 0),
                'increase_pct': round(violation_increase_pct, 1),
                'original_cis': round(float(original_n['cis_score']), 1),
                'lat': round(float(original_n['lat_center']), 6),
                'lng': round(float(original_n['lng_center']), 6),
            })
    
    # Sort spillover by impact
    spillover_hexes.sort(key=lambda x: x['displaced_violations_added'], reverse=True)
    
    # Summary metrics
    total_before_cis = sum(v['cis_score'] for v in before_state.values())
    total_after_cis = sum(v['cis_score'] for v in after_state.values())
    cis_reduction = ((total_before_cis - total_after_cis) / max(total_before_cis, 1)) * 100
    
    net_suppressed = total_suppressed - total_displaced
    
    result = {
        'input': {
            'target_hexes': target_hex_ids,
            'n_officers': n_officers,
            'time_window': time_window,
        },
        'before': before_state,
        'after': after_state,
        'displacement': {
            'total_suppressed': round(total_suppressed, 0),
            'total_displaced': round(total_displaced, 0),
            'net_reduction': round(net_suppressed, 0),
            'displacement_rate': DISPLACEMENT_RATE,
            'spillover_hexes': spillover_hexes[:20],  # Top 20 affected
        },
        'summary': {
            'cis_reduction_pct': round(cis_reduction, 1),
            'violation_reduction_pct': round((net_suppressed / max(total_suppressed / ENFORCEMENT_EFFECTIVENESS, 1)) * 100, 1),
            'cost_effectiveness': round(cis_reduction / max(n_officers, 1), 2),
            'spillover_warning': len([s for s in spillover_hexes if s['increase_pct'] > 10]),
        },
    }
    
    return result


def generate_preset_scenarios(hex_agg):
    """Generate a set of pre-computed simulation scenarios."""
    print("[SIMULATOR] Generating preset scenarios...")
    
    scenarios = {}
    
    # Scenario 1: Deploy to top 5 critical hotspots
    top5 = hex_agg.nlargest(5, 'cis_score')['h3_res8'].tolist()
    scenarios['top5_critical'] = {
        'name': 'Top 5 Critical Hotspots',
        'description': 'Deploy enforcement to the 5 highest CIS-scored locations',
        'result': simulate_enforcement(hex_agg, top5, n_officers=5, time_window='all'),
    }
    print(f"  Scenario 1 (Top 5): CIS reduction = {scenarios['top5_critical']['result']['summary']['cis_reduction_pct']}%")
    
    # Scenario 2: Deploy to top 10
    top10 = hex_agg.nlargest(10, 'cis_score')['h3_res8'].tolist()
    scenarios['top10_critical'] = {
        'name': 'Top 10 Hotspots',
        'description': 'Deploy enforcement to the 10 highest CIS-scored locations',
        'result': simulate_enforcement(hex_agg, top10, n_officers=10, time_window='all'),
    }
    print(f"  Scenario 2 (Top 10): CIS reduction = {scenarios['top10_critical']['result']['summary']['cis_reduction_pct']}%")
    
    # Scenario 3: All junctions
    junction_hexes = hex_agg[hex_agg['is_junction'] == True].nlargest(15, 'cis_score')['h3_res8'].tolist()
    if len(junction_hexes) > 0:
        scenarios['all_junctions'] = {
            'name': 'Cover All Major Junctions',
            'description': 'Focus enforcement on BTP junction locations',
            'result': simulate_enforcement(hex_agg, junction_hexes, n_officers=15, time_window='evening'),
        }
        print(f"  Scenario 3 (Junctions): CIS reduction = {scenarios['all_junctions']['result']['summary']['cis_reduction_pct']}%")
    
    # Scenario 4: Weekend evening operation
    scenarios['weekend_evening'] = {
        'name': 'Weekend Evening Operation',
        'description': 'Deploy during peak weekend evening hours to top hotspots',
        'result': simulate_enforcement(hex_agg, top5, n_officers=8, time_window='evening'),
    }
    print(f"  Scenario 4 (Weekend Eve): CIS reduction = {scenarios['weekend_evening']['result']['summary']['cis_reduction_pct']}%")
    
    # Scenario 5: Upparpet focus (highest violation station)
    upparpet_hexes = hex_agg[hex_agg['police_station'] == 'Upparpet'].nlargest(5, 'cis_score')['h3_res8'].tolist()
    if len(upparpet_hexes) > 0:
        scenarios['upparpet_focus'] = {
            'name': 'Upparpet Focused Operation',
            'description': 'Concentrated enforcement in the highest-violation area',
            'result': simulate_enforcement(hex_agg, upparpet_hexes, n_officers=5, time_window='all'),
        }
        print(f"  Scenario 5 (Upparpet): CIS reduction = {scenarios['upparpet_focus']['result']['summary']['cis_reduction_pct']}%")
    
    return scenarios


def save_json(data, filepath):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'w') as f:
        json.dump(data, f, default=str)


def main():
    print("=" * 60)
    print("ParkSense AI -- What-If Simulator")
    print("=" * 60)
    
    hex_agg, _ = load_data()
    scenarios = generate_preset_scenarios(hex_agg)
    
    save_json(scenarios, os.path.join(DATA_DIR, 'scenarios.json'))
    print(f"\n[OK] Saved {len(scenarios)} preset scenarios")
    print("[OK] Simulator ready!")


if __name__ == '__main__':
    main()
