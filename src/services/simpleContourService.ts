/**
 * Simple Contour Service
 * Creates basic polygon contours from hail reports
 * Simpler alternative to d3-contour for testing
 */

import { HailReport } from './mrmsService';

export class SimpleContourService {
  /**
   * Generate simple contour polygons from hail reports
   * Groups reports by size ranges and creates storm-path-like polygons
   */
  static generateSimpleContours(reports: HailReport[]): any {
    if (!reports || reports.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }
    
    console.log(`SimpleContourService: Processing ${reports.length} hail reports`);

    // Group reports by size ranges
    const sizeRanges = [
      { min: 3.0, max: 999, color: 'rgba(139, 0, 0, 0.5)', label: '3"+ (Baseball+)' },
      { min: 2.0, max: 3.0, color: 'rgba(255, 0, 0, 0.5)', label: '2-3" (Egg-Baseball)' },
      { min: 1.5, max: 2.0, color: 'rgba(255, 140, 0, 0.5)', label: '1.5-2" (Walnut-Egg)' },
      { min: 1.0, max: 1.5, color: 'rgba(255, 215, 0, 0.5)', label: '1-1.5" (Quarter-Walnut)' },
      { min: 0.5, max: 1.0, color: 'rgba(173, 255, 47, 0.5)', label: '0.5-1" (Penny-Quarter)' }
    ];

    const features: any[] = [];

    // Create a polygon for each size range that has reports
    sizeRanges.forEach(range => {
      const rangeReports = reports.filter(r => r.size >= range.min && r.size < range.max);
      
      if (rangeReports.length >= 3) { // Need at least 3 points for a polygon
        // Create a convex hull around the points
        const hull = this.convexHull(rangeReports.map(r => [r.longitude, r.latitude]));
        
        if (hull.length >= 3) {
          // Expand the hull slightly for better coverage
          const expandedHull = this.expandPolygon(hull, 0.05); // ~5km expansion
          
          features.push({
            type: 'Feature',
            properties: {
              level: range.min,
              color: range.color,
              description: range.label
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
              description: range.label
            },
            geometry: {
              type: 'Polygon',
              coordinates: [circle]
            }
          });
        });
      }
    });

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

    // Sort points by x-coordinate
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    // Build lower hull
    const lower: number[][] = [];
    for (const p of points) {
      while (lower.length >= 2 && this.cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }

    // Build upper hull
    const upper: number[][] = [];
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      while (upper.length >= 2 && this.cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }

    // Remove last point of each half because it's repeated
    lower.pop();
    upper.pop();

    // Concatenate and close the polygon
    const hull = lower.concat(upper);
    hull.push(hull[0]); // Close the polygon
    
    return hull;
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
    const len = points.length - 1; // Exclude closing point
    
    for (let i = 0; i < len; i++) {
      x += points[i][0];
      y += points[i][1];
    }
    
    return [x / len, y / len];
  }

  /**
   * Create a circle as polygon points
   */
  private static createCircle(centerLon: number, centerLat: number, radius: number): number[][] {
    const points: number[][] = [];
    const segments = 16; // Number of segments
    
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * 2 * Math.PI;
      const lon = centerLon + radius * Math.cos(angle);
      const lat = centerLat + radius * Math.sin(angle);
      points.push([lon, lat]);
    }
    
    return points;
  }
}