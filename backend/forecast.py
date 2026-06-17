"""
ParkSense AI — LightGBM Forecast Engine + SHAP Explainability
Predicts future parking violation hotspots using historical patterns.
Generates SHAP explanations for each predicted hotspot.
"""

import pandas as pd
import numpy as np
import json
import os
import warnings
warnings.filterwarnings('ignore')

from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    mean_absolute_error, mean_squared_error, r2_score,
    precision_score, recall_score, f1_score, confusion_matrix
)
import lightgbm as lgb

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')


def load_ml_data():
    """Load the cleaned ML-ready data."""
    print("[FORECAST] Loading ML data...")
    df = pd.read_csv(os.path.join(DATA_DIR, 'cleaned_for_ml.csv'))
    print(f"  Loaded {len(df):,} records")
    return df


def prepare_features(df):
    """Create aggregated features at H3 hex × hour-of-week level."""
    print("[FORECAST] Preparing features...")

    # Aggregate: count violations per hex × hour × day_of_week
    agg = df.groupby(['h3_res8', 'hour', 'day_of_week']).agg(
        violation_count=('severity_score', 'count'),
        avg_severity=('severity_score', 'mean'),
        avg_lane_blockage=('lane_blockage_pct', 'mean'),
        avg_vehicle_size=('vehicle_size_factor', 'mean'),
        road_multiplier=('road_multiplier', 'max'),
    ).reset_index()

    # Add historical average per hex (overall)
    hex_avg = df.groupby('h3_res8')['severity_score'].agg(['count', 'mean']).reset_index()
    hex_avg.columns = ['h3_res8', 'hex_total_count', 'hex_avg_severity']
    agg = agg.merge(hex_avg, on='h3_res8', how='left')

    # Add junction flag
    junction_hexes = df[df['junction_name'] != 'No Junction']['h3_res8'].unique()
    agg['is_junction'] = agg['h3_res8'].isin(junction_hexes).astype(int)

    # Add month distribution features
    month_dist = df.groupby(['h3_res8', 'month']).size().unstack(fill_value=0)
    month_dist.columns = [f'month_{int(c)}_count' for c in month_dist.columns]
    month_dist = month_dist.reset_index()
    agg = agg.merge(month_dist, on='h3_res8', how='left')
    for col in agg.columns:
        if col.startswith('month_'):
            agg[col] = agg[col].fillna(0)

    # Cyclical encoding for hour and day_of_week
    agg['hour_sin'] = np.sin(2 * np.pi * agg['hour'] / 24)
    agg['hour_cos'] = np.cos(2 * np.pi * agg['hour'] / 24)
    agg['dow_sin'] = np.sin(2 * np.pi * agg['day_of_week'] / 7)
    agg['dow_cos'] = np.cos(2 * np.pi * agg['day_of_week'] / 7)

    # Is weekend
    agg['is_weekend'] = (agg['day_of_week'] >= 5).astype(int)

    # Is peak hour (based on our data analysis: 4-6 AM, 9-11 PM)
    agg['is_peak'] = agg['hour'].apply(
        lambda h: 1 if h in [4, 5, 6, 21, 22, 23, 0] else 0
    )

    print(f"  Feature matrix: {agg.shape}")
    return agg


def train_model(agg):
    """Train LightGBM model and generate evaluation metrics."""
    print("[FORECAST] Training LightGBM model...")

    feature_cols = [
        'hour', 'day_of_week', 'avg_severity', 'avg_lane_blockage',
        'avg_vehicle_size', 'road_multiplier', 'hex_total_count',
        'hex_avg_severity', 'is_junction', 'hour_sin', 'hour_cos',
        'dow_sin', 'dow_cos', 'is_weekend', 'is_peak',
    ]

    # Add month columns
    month_cols = [c for c in agg.columns if c.startswith('month_')]
    feature_cols.extend(month_cols)

    X = agg[feature_cols].fillna(0)
    y = agg['violation_count']

    # Spatial validation split to prevent location characteristics leakage
    unique_hexes = agg['h3_res8'].unique()
    train_hexes, test_hexes = train_test_split(
        unique_hexes, test_size=0.2, random_state=42
    )
    train_mask = agg['h3_res8'].isin(train_hexes)
    test_mask = agg['h3_res8'].isin(test_hexes)

    X_train = X[train_mask]
    y_train = y[train_mask]
    X_test = X[test_mask]
    y_test = y[test_mask]

    # LightGBM parameters
    params = {
        'objective': 'regression',
        'metric': 'mae',
        'boosting_type': 'gbdt',
        'num_leaves': 63,
        'learning_rate': 0.05,
        'feature_fraction': 0.8,
        'bagging_fraction': 0.8,
        'bagging_freq': 5,
        'verbose': -1,
        'n_estimators': 300,
        'random_state': 42,
    }

    model = lgb.LGBMRegressor(**params)
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
    )

    # Predictions
    y_pred = model.predict(X_test)
    y_pred = np.maximum(y_pred, 0)  # No negative predictions

    # Regression metrics
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    r2 = r2_score(y_test, y_pred)

    # Classification metrics (is it a hotspot? threshold = median)
    threshold = y.median()
    y_test_cls = (y_test > threshold).astype(int)
    y_pred_cls = (y_pred > threshold).astype(int)

    precision = precision_score(y_test_cls, y_pred_cls, zero_division=0)
    recall = recall_score(y_test_cls, y_pred_cls, zero_division=0)
    f1 = f1_score(y_test_cls, y_pred_cls, zero_division=0)
    cm = confusion_matrix(y_test_cls, y_pred_cls).tolist()

    # Feature importance
    importance = dict(zip(feature_cols, model.feature_importances_.tolist()))
    importance = dict(sorted(importance.items(), key=lambda x: x[1], reverse=True))

    metrics = {
        'regression': {
            'mae': round(mae, 4),
            'rmse': round(rmse, 4),
            'r2_score': round(r2, 4),
        },
        'classification': {
            'threshold': round(float(threshold), 2),
            'precision': round(precision, 4),
            'recall': round(recall, 4),
            'f1_score': round(f1, 4),
            'confusion_matrix': cm,
        },
        'feature_importance': importance,
        'training_samples': len(X_train),
        'test_samples': len(X_test),
        'total_features': len(feature_cols),
        'model_type': 'LightGBM Regressor',
        'n_estimators': 300,
    }

    print(f"  MAE: {mae:.4f}, RMSE: {rmse:.4f}, R²: {r2:.4f}")
    print(f"  Precision: {precision:.4f}, Recall: {recall:.4f}, F1: {f1:.4f}")

    return model, X, y, agg, feature_cols, metrics, X_test, y_test, y_pred


def generate_shap_explanations(model, X, agg, feature_cols, top_n=100):
    """Generate SHAP explanations for top predicted hotspots."""
    print("[FORECAST] Generating SHAP explanations...")

    try:
        import shap

        # Use TreeExplainer for LightGBM (fast)
        explainer = shap.TreeExplainer(model)
        shap_values = explainer.shap_values(X)

        # Global SHAP summary (mean absolute SHAP per feature)
        global_importance = {}
        for i, feat in enumerate(feature_cols):
            global_importance[feat] = round(float(np.abs(shap_values[:, i]).mean()), 4)
        global_importance = dict(sorted(global_importance.items(), key=lambda x: x[1], reverse=True))

        # Per-hex SHAP explanations for top hotspots
        hex_agg_df = pd.read_csv(os.path.join(DATA_DIR, 'hex_aggregates.csv'))
        top_hexes = hex_agg_df.nlargest(top_n, 'cis_score')['h3_res8'].tolist()

        per_hex_shap = {}
        for hex_id in top_hexes:
            hex_mask = agg['h3_res8'] == hex_id
            if hex_mask.sum() == 0:
                continue

            hex_indices = hex_mask[hex_mask].index.tolist()
            # Average SHAP across all hour-dow combinations for this hex
            hex_shap_values = shap_values[hex_indices]
            avg_shap = np.mean(hex_shap_values, axis=0)

            explanation = {}
            for i, feat in enumerate(feature_cols):
                explanation[feat] = round(float(avg_shap[i]), 4)

            # Sort by absolute impact
            explanation = dict(sorted(explanation.items(), key=lambda x: abs(x[1]), reverse=True))

            # Generate human-readable explanations for top factors
            readable = []
            for feat, val in list(explanation.items())[:5]:
                direction = "increases" if val > 0 else "decreases"
                readable.append({
                    'feature': feat,
                    'shap_value': val,
                    'direction': direction,
                    'description': _feature_description(feat, val),
                })

            per_hex_shap[hex_id] = {
                'hex_id': hex_id,
                'shap_values': explanation,
                'top_factors': readable,
            }

        print(f"  Generated SHAP for {len(per_hex_shap)} hotspots")
        return global_importance, per_hex_shap

    except Exception as e:
        print(f"  SHAP generation failed: {e}")
        return {}, {}


def _feature_description(feature: str, value: float) -> str:
    """Generate human-readable description for a SHAP feature contribution."""
    direction = "higher" if value > 0 else "lower"

    descriptions = {
        'hex_total_count': f"Historical violation volume at this location pushes prediction {direction}",
        'hour': f"Time of day contributes to {direction} predicted violations",
        'day_of_week': f"Day of week pattern makes violations {direction}",
        'avg_severity': f"Average violation severity drives prediction {direction}",
        'is_junction': f"Proximity to BTP junction makes this area {direction} risk",
        'is_peak': f"Peak hour timing pushes violations {direction}",
        'is_weekend': f"Weekend pattern contributes to {direction} violations",
        'road_multiplier': f"Road type/hierarchy makes congestion impact {direction}",
        'hex_avg_severity': f"Historical severity pattern at location drives prediction {direction}",
        'avg_lane_blockage': f"Lane blockage severity contributes to {direction} violations",
        'avg_vehicle_size': f"Vehicle size mix pushes prediction {direction}",
        'hour_sin': f"Cyclical hour pattern contributes to {direction} violations",
        'hour_cos': f"Cyclical hour pattern contributes to {direction} violations",
        'dow_sin': f"Weekly cyclical pattern drives prediction {direction}",
        'dow_cos': f"Weekly cyclical pattern drives prediction {direction}",
    }

    for key, desc in descriptions.items():
        if feature == key:
            return desc

    if feature.startswith('month_'):
        return f"Monthly seasonal pattern contributes to {direction} violations"

    return f"This feature contributes to {direction} predicted violations"


def generate_forecast_predictions(model, agg, feature_cols):
    """Generate next-period hotspot predictions per hex cell."""
    print("[FORECAST] Generating forecast predictions...")

    # Predict for all hex × hour-of-week combinations
    X_all = agg[feature_cols].fillna(0)
    agg['predicted_count'] = np.maximum(model.predict(X_all), 0)

    # Aggregate predictions per hex
    hex_forecast = agg.groupby('h3_res8').agg(
        predicted_total=('predicted_count', 'sum'),
        predicted_peak=('predicted_count', 'max'),
        peak_hour=('predicted_count', lambda x: agg.loc[x.idxmax(), 'hour'] if len(x) > 0 else 0),
        actual_total=('violation_count', 'sum'),
    ).reset_index()

    # Load hex_agg for additional info
    hex_agg_df = pd.read_csv(os.path.join(DATA_DIR, 'hex_aggregates.csv'))
    hex_forecast = hex_forecast.merge(
        hex_agg_df[['h3_res8', 'cis_score', 'lat_center', 'lng_center', 'police_station', 'location_name']],
        on='h3_res8', how='left'
    )

    # Trend: predicted vs actual
    hex_forecast['trend'] = np.where(
        hex_forecast['actual_total'] > 0,
        ((hex_forecast['predicted_total'] - hex_forecast['actual_total']) / hex_forecast['actual_total'] * 100).round(1),
        0
    )
    hex_forecast['trend_direction'] = np.where(hex_forecast['trend'] > 5, 'rising',
                                     np.where(hex_forecast['trend'] < -5, 'declining', 'stable'))

    # Emerging hotspots: currently moderate but predicted to rise
    hex_forecast['is_emerging'] = (
        (hex_forecast['cis_score'] < 60) &
        (hex_forecast['trend'] > 15)
    )

    forecast_data = hex_forecast.sort_values('predicted_total', ascending=False).head(100)
    forecast_data['predicted_total'] = forecast_data['predicted_total'].round(1)
    forecast_data['predicted_peak'] = forecast_data['predicted_peak'].round(1)
    forecast_data['lat'] = forecast_data['lat_center'].round(6)
    forecast_data['lng'] = forecast_data['lng_center'].round(6)

    result = forecast_data[[
        'h3_res8', 'predicted_total', 'predicted_peak', 'peak_hour',
        'actual_total', 'cis_score', 'trend', 'trend_direction',
        'is_emerging', 'lat', 'lng', 'police_station', 'location_name',
    ]].to_dict(orient='records')

    # Emerging hotspots list
    emerging = hex_forecast[hex_forecast['is_emerging']].sort_values('trend', ascending=False).head(20)
    emerging_list = emerging[[
        'h3_res8', 'predicted_total', 'actual_total', 'cis_score',
        'trend', 'lat_center', 'lng_center', 'police_station',
    ]].to_dict(orient='records')

    print(f"  Forecast: {len(result)} hexes, {len(emerging_list)} emerging hotspots")
    return result, emerging_list


def save_json(data, filepath):
    """Save data as JSON file."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'w') as f:
        json.dump(data, f, default=str)


def main():
    """Run the full forecast pipeline."""
    print("=" * 60)
    print("ParkSense AI — Forecast Engine")
    print("=" * 60)

    # Load data
    df = load_ml_data()

    # Prepare features
    agg = prepare_features(df)

    # Train model
    model, X, y, agg, feature_cols, metrics, X_test, y_test, y_pred = train_model(agg)

    # Generate SHAP
    global_shap, per_hex_shap = generate_shap_explanations(model, X, agg, feature_cols)
    metrics['shap_global_importance'] = global_shap

    # Generate actual vs predicted for scatter plot
    scatter_data = []
    for actual, predicted in zip(y_test.values[:500], y_pred[:500]):
        scatter_data.append({
            'actual': round(float(actual), 2),
            'predicted': round(float(predicted), 2),
        })
    metrics['scatter_data'] = scatter_data

    # Save metrics
    save_json(metrics, os.path.join(DATA_DIR, 'model_metrics.json'))
    print("  [OK] model_metrics.json")

    # Generate forecast
    forecast, emerging = generate_forecast_predictions(model, agg, feature_cols)
    save_json({
        'predictions': forecast,
        'emerging_hotspots': emerging,
    }, os.path.join(DATA_DIR, 'forecast.json'))
    print("  [OK] forecast.json")

    # Save per-hex SHAP
    for hex_id, shap_data in per_hex_shap.items():
        safe_name = hex_id.replace('/', '_')
        save_json(shap_data, os.path.join(DATA_DIR, 'shap', f'{safe_name}.json'))
    print(f"  [OK] shap/*.json ({len(per_hex_shap)} files)")

    print("\nFORECAST ENGINE COMPLETE!")


if __name__ == '__main__':
    main()
