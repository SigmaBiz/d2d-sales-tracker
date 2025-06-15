// Test contour data for debugging
export const testContourData = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        level: 1.0,
        color: "rgba(255, 215, 0, 0.5)",
        description: "Test Zone 1"
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-97.5164, 35.4676],
          [-97.5064, 35.4676],
          [-97.5064, 35.4776],
          [-97.5164, 35.4776],
          [-97.5164, 35.4676]
        ]]
      }
    },
    {
      type: "Feature", 
      properties: {
        level: 2.0,
        color: "rgba(255, 0, 0, 0.5)",
        description: "Test Zone 2"
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-97.5264, 35.4576],
          [-97.5164, 35.4576],
          [-97.5164, 35.4676],
          [-97.5264, 35.4676],
          [-97.5264, 35.4576]
        ]]
      }
    }
  ]
};

// Function to validate GeoJSON
export function validateGeoJSON(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!data) {
    errors.push("Data is null or undefined");
    return { valid: false, errors };
  }
  
  if (data.type !== "FeatureCollection") {
    errors.push(`Invalid type: ${data.type}, expected FeatureCollection`);
  }
  
  if (!Array.isArray(data.features)) {
    errors.push("features is not an array");
    return { valid: false, errors };
  }
  
  data.features.forEach((feature: any, index: number) => {
    if (feature.type !== "Feature") {
      errors.push(`Feature ${index}: Invalid type ${feature.type}`);
    }
    
    if (!feature.geometry) {
      errors.push(`Feature ${index}: Missing geometry`);
    } else {
      if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") {
        errors.push(`Feature ${index}: Invalid geometry type ${feature.geometry.type}`);
      }
      
      if (!feature.geometry.coordinates) {
        errors.push(`Feature ${index}: Missing coordinates`);
      } else if (feature.geometry.type === "Polygon") {
        if (!Array.isArray(feature.geometry.coordinates) || 
            !Array.isArray(feature.geometry.coordinates[0])) {
          errors.push(`Feature ${index}: Invalid polygon coordinates structure`);
        }
      }
    }
    
    if (!feature.properties) {
      errors.push(`Feature ${index}: Missing properties`);
    }
  });
  
  return { valid: errors.length === 0, errors };
}