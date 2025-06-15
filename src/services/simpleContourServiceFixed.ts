/**
 * Fixed Simple Contour Service
 * Creates basic polygon contours from hail reports with proper GeoJSON formatting
 */

import { HailReport } from './mrmsService';

export class SimpleContourServiceFixed {
  /**
   * Generate simple contour polygons from hail reports
   * Groups reports by size ranges and creates convex hulls
   */
  static generateSimpleContours(reports: HailReport[]): any {
    if (!reports || reports.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }

    console.log(`Generating contours for ${reports.length} reports`);

    // Group reports by size ranges
    const sizeRanges = [
      { min: 3.0, max: 999, color: '#8B0000', label: '3"+ (Baseball+)' },
      { min: 2.0, max: 3.0, color: '#FF0000', label: '2-3" (Egg-Baseball)' },
      { min: 1.5, max: 2.0, color: '#FF8C00', label: '1.5-2" (Walnut-Egg)' },
      { min: 1.0, max: 1.5, color: '#FFD700', label: '1-1.5" (Quarter-Walnut)' },
      { min: 0.5, max: 1.0, color: '#ADFF2F', label: '0.5-1" (Penny-Quarter)' }
    ];

    const features: any[] = [];

    // Create a polygon for each size range that has reports
    sizeRanges.forEach(range => {
      const rangeReports = reports.filter(r => r.size >= range.min && r.size < range.max);
      
      console.log(`Size range ${range.label}: ${rangeReports.length} reports`);

      if (rangeReports.length >= 3) {
        // Create a convex hull around the points
        const points = rangeReports.map(r => [r.longitude, r.latitude]);
        const hull = this.convexHull(points);
        
        if (hull.length >= 3) {
          // Expand the hull slightly for better coverage
          const expandedHull = this.expandPolygon(hull, 0.05); // ~5km expansion
          
          // Ensure polygon is closed
          if (expandedHull[0][0] !== expandedHull[expandedHull.length - 1][0] ||
              expandedHull[0][1] !== expandedHull[expandedHull.length - 1][1]) {
            expandedHull.push([...expandedHull[0]]);
          }
          
          features.push({
            type: 'Feature',
            properties: {
              level: range.min,
              color: range.color,
              description: range.label,
              reportCount: rangeReports.length
            },
            geometry: {
              type: 'Polygon',
              coordinates: [expandedHull]
            }
          });
        }
      } else if (rangeReports.length > 0) {
        // For fewer points, create circles around each point
        rangeReports.forEach(report => {
          const circle = this.createCircle(report.longitude, report.latitude, 0.05); // ~5km radius
          
          features.push({
            type: 'Feature',
            properties: {
              level: range.min,
              color: range.color,
              description: range.label,
              reportCount: 1
            },
            geometry: {
              type: 'Polygon',
              coordinates: [circle]
            }
          });
        });
      }
    });

    // Sort features by level (largest hail first) so smaller zones render on top
    features.sort((a, b) => b.properties.level - a.properties.level);

    console.log(`Generated ${features.length} contour features`);

    return {
      type: 'FeatureCollection',
      features: features
    };
  }

  /**
   * Create a convex hull from a set of points
   * Uses Graham scan algorithm
   */
  private static convexHull(points: number[][]): number[][] {
    if (points.length < 3) return points;

    // Remove duplicate points
    const uniquePoints = points.filter((point, index, self) =>
      index === self.findIndex(p => p[0] === point[0] && p[1] === point[1])
    );

    if (uniquePoints.length < 3) return uniquePoints;

    // Sort points by x-coordinate, then y-coordinate
    uniquePoints.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    // Build lower hull
    const lower: number[][] = [];
    for (const p of uniquePoints) {
      while (lower.length >= 2 && this.cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }

    // Build upper hull
    const upper: number[][] = [];
    for (let i = uniquePoints.length - 1; i >= 0; i--) {
      const p = uniquePoints[i];
      while (upper.length >= 2 && this.cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }

    // Remove last point of each half because it's repeated
    lower.pop();
    upper.pop();

    // Concatenate (don't close yet - Leaflet expects open polygons)
    return lower.concat(upper);
  }

  /**
   * Cross product of vectors OA and OB where O is the origin
   */
  private static cross(o: number[], a: number[], b: number[]): number {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  }

  /**
   * Expand a polygon by a given distance
   */
  private static expandPolygon(points: number[][], distance: number): number[][] {
    const centroid = this.calculateCentroid(points);
    
    return points.map(point => {
      const dx = point[0] - centroid[0];
      const dy = point[1] - centroid[1];
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length === 0) return point;
      
      // Expand outward from centroid
      return [
        point[0] + (dx / length) * distance,
        point[1] + (dy / length) * distance
      ];
    });
  }

  /**
   * Calculate centroid of a polygon
   */
  private static calculateCentroid(points: number[][]): number[] {
    let x = 0, y = 0;
    const len = points.length;
    
    for (let i = 0; i < len; i++) {
      x += points[i][0];
      y += points[i][1];
    }
    
    return [x / len, y / len];
  }

  /**
   * Create a circle as polygon points
   * Creates a proper GeoJSON polygon (counterclockwise for exterior ring)
   */
  private static createCircle(centerLon: number, centerLat: number, radius: number): number[][] {
    const points: number[][] = [];
    const segments = 32; // More segments for smoother circle
    
    // Create points in counterclockwise order
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * 2 * Math.PI;
      const lon = centerLon + radius * Math.cos(angle);
      const lat = centerLat + radius * Math.sin(angle);
      points.push([lon, lat]);
    }
    
    return points;
  }

  /**
   * Validate that the generated GeoJSON is correct
   */
  static validateGeoJSON(geojson: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!geojson) {
      errors.push('GeoJSON is null or undefined');
      return { valid: false, errors };
    }

    if (geojson.type !== 'FeatureCollection') {
      errors.push(`Invalid type: ${geojson.type}, expected FeatureCollection`);
    }

    if (!Array.isArray(geojson.features)) {
      errors.push('features is not an array');
      return { valid: false, errors };
    }

    geojson.features.forEach((feature: any, index: number) => {
      if (feature.type !== 'Feature') {
        errors.push(`Feature ${index}: Invalid type ${feature.type}`);
      }

      if (!feature.geometry) {
        errors.push(`Feature ${index}: Missing geometry`);
      } else {
        if (feature.geometry.type !== 'Polygon') {
          errors.push(`Feature ${index}: Invalid geometry type ${feature.geometry.type}`);
        }

        if (!feature.geometry.coordinates || !Array.isArray(feature.geometry.coordinates)) {
          errors.push(`Feature ${index}: Missing or invalid coordinates`);
        } else if (feature.geometry.coordinates.length === 0) {
          errors.push(`Feature ${index}: Empty coordinates array`);
        } else if (!Array.isArray(feature.geometry.coordinates[0])) {
          errors.push(`Feature ${index}: Invalid polygon structure`);
        }
      }

      if (!feature.properties) {
        errors.push(`Feature ${index}: Missing properties`);
      }
    });

    return { valid: errors.length === 0, errors };
  }
}