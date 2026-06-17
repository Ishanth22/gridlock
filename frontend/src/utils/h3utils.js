import { cellToBoundary } from 'h3-js';

/**
 * Convert H3 hex cell ID to a GeoJSON polygon for MapLibre rendering.
 */
export function h3ToGeoJSON(hexId) {
  const boundary = cellToBoundary(hexId, true); // [lng, lat] format
  // Close the polygon
  const coords = [...boundary, boundary[0]];
  return {
    type: 'Polygon',
    coordinates: [coords],
  };
}

/**
 * Convert an array of hex cells to a GeoJSON FeatureCollection.
 */
export function hexesToFeatureCollection(hexes, getProperties = () => ({})) {
  const features = hexes.map((hex) => ({
    type: 'Feature',
    geometry: h3ToGeoJSON(hex.hex_id || hex.h3_res8),
    properties: {
      hex_id: hex.hex_id || hex.h3_res8,
      ...getProperties(hex),
    },
  }));

  return {
    type: 'FeatureCollection',
    features,
  };
}
