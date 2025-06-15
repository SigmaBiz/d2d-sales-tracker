/**
 * Hail Contour Service
 * Creates smooth contour polygons from gridded MRMS data
 * Similar to professional services like HailTrace
 */

import { HailReport } from './mrmsService';

export interface GridPoint {
  lat: number;
  lon: number;
  value: number; // hail size in inches
}

export interface ContourLevel {
  level: number; // hail size threshold (e.g., 0.75, 1.0, 1.5, 2.0)
  color: string;
  polygons: number[][][]; // Array of polygons, each polygon is array of [lon, lat] points
}

export class HailContourService {
  private static readonly GRID_RESOLUTION = 0.01; // ~1km in degrees
  private static readonly CONTOUR_LEVELS = [0.75, 1.0, 1.5, 2.0, 2.5, 3.0];
  
  /**
   * Convert point-based hail reports to gridded data
   */
  static createGrid(reports: HailReport[], bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }): GridPoint[][] {
    // Calculate grid dimensions
    const latSteps = Math.ceil((bounds.north - bounds.south) / this.GRID_RESOLUTION);
    const lonSteps = Math.ceil((bounds.east - bounds.west) / this.GRID_RESOLUTION);
    
    // Initialize grid with zeros
    const grid: GridPoint[][] = [];
    
    for (let i = 0; i < latSteps; i++) {
      grid[i] = [];
      for (let j = 0; j < lonSteps; j++) {
        const lat = bounds.south + (i * this.GRID_RESOLUTION);
        const lon = bounds.west + (j * this.GRID_RESOLUTION);
        grid[i][j] = { lat, lon, value: 0 };
      }
    }
    
    // Interpolate hail values using Inverse Distance Weighting (IDW)
    reports.forEach(report => {
      const latIndex = Math.floor((report.latitude - bounds.south) / this.GRID_RESOLUTION);
      const lonIndex = Math.floor((report.longitude - bounds.west) / this.GRID_RESOLUTION);
      
      // Apply influence to nearby grid cells
      const influenceRadius = 10; // grid cells
      
      for (let di = -influenceRadius; di <= influenceRadius; di++) {
        for (let dj = -influenceRadius; dj <= influenceRadius; dj++) {
          const i = latIndex + di;
          const j = lonIndex + dj;
          
          if (i >= 0 && i < latSteps && j >= 0 && j < lonSteps) {
            const distance = Math.sqrt(di * di + dj * dj);
            if (distance <= influenceRadius) {
              // IDW formula: weight = 1 / (distance^2)
              const weight = distance === 0 ? 1 : 1 / (distance * distance);
              const influence = report.size * weight;
              
              // Take maximum value at each grid point
              grid[i][j].value = Math.max(grid[i][j].value, influence);
            }
          }
        }
      }
    });
    
    return grid;
  }
  
  /**
   * Generate contour polygons from gridded data
   * Using marching squares algorithm
   */
  static generateContours(grid: GridPoint[][]): ContourLevel[] {
    const contours: ContourLevel[] = [];
    
    this.CONTOUR_LEVELS.forEach(level => {
      const polygons = this.marchingSquares(grid, level);
      
      contours.push({
        level,
        color: this.getContourColor(level),
        polygons
      });
    });
    
    return contours;
  }
  
  /**
   * Simplified marching squares algorithm
   * In production, use a library like d3-contour
   */
  private static marchingSquares(grid: GridPoint[][], threshold: number): number[][][] {
    const polygons: number[][][] = [];
    const rows = grid.length;
    const cols = grid[0].length;
    
    // For each cell in the grid
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        // Get the 4 corners of the cell
        const tl = grid[i][j].value >= threshold ? 1 : 0;
        const tr = grid[i][j + 1].value >= threshold ? 1 : 0;
        const br = grid[i + 1][j + 1].value >= threshold ? 1 : 0;
        const bl = grid[i + 1][j].value >= threshold ? 1 : 0;
        
        // Calculate case number (0-15)
        const caseNum = tl * 8 + tr * 4 + br * 2 + bl * 1;
        
        // Generate line segments based on case
        const segments = this.getSegments(caseNum, grid[i][j], grid[i][j + 1], 
                                         grid[i + 1][j + 1], grid[i + 1][j], threshold);
        
        if (segments.length > 0) {
          // In a real implementation, connect segments into polygons
          polygons.push(segments);
        }
      }
    }
    
    // Connect line segments into closed polygons
    return this.connectSegments(polygons);
  }
  
  /**
   * Get line segments for marching squares case
   */
  private static getSegments(caseNum: number, tl: GridPoint, tr: GridPoint, 
                           br: GridPoint, bl: GridPoint, threshold: number): number[][] {
    // This is a simplified version - real implementation needs all 16 cases
    const segments: number[][] = [];
    
    switch (caseNum) {
      case 0: // No contour
      case 15: // Full contour
        break;
      case 1: // Bottom left corner
        segments.push(
          [bl.lon, (bl.lat + tl.lat) / 2],
          [(bl.lon + br.lon) / 2, bl.lat]
        );
        break;
      // ... implement other cases
    }
    
    return segments;
  }
  
  /**
   * Connect line segments into polygons
   */
  private static connectSegments(segments: number[][][]): number[][][] {
    // Simplified - in reality, need to trace and connect segments
    return segments;
  }
  
  /**
   * Get color for contour level
   */
  private static getContourColor(level: number): string {
    if (level >= 3.0) return 'rgba(139, 0, 0, 0.6)';      // Dark red
    if (level >= 2.5) return 'rgba(255, 0, 0, 0.6)';      // Red
    if (level >= 2.0) return 'rgba(255, 69, 0, 0.6)';     // Red-orange
    if (level >= 1.5) return 'rgba(255, 140, 0, 0.6)';    // Orange
    if (level >= 1.0) return 'rgba(255, 215, 0, 0.6)';    // Gold
    return 'rgba(173, 255, 47, 0.6)';                     // Green-yellow
  }
  
  /**
   * Generate GeoJSON for Leaflet
   */
  static contoursToGeoJSON(contours: ContourLevel[]): any {
    return {
      type: 'FeatureCollection',
      features: contours.flatMap(contour => 
        contour.polygons.map(polygon => ({
          type: 'Feature',
          properties: {
            level: contour.level,
            color: contour.color
          },
          geometry: {
            type: 'Polygon',
            coordinates: [polygon]
          }
        }))
      )
    };
  }
}