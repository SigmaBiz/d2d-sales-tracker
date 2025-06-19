/**
 * MRMS Contour Service
 * Generates smooth contour polygons from MRMS grid data
 * Creates professional hail maps like HailTrace
 */

import { contours } from 'd3-contour';
import { HailReport } from './mrmsService';

export interface MRMSGridData {
  values: number[][]; // 2D array of hail sizes
  width: number;      // Grid width
  height: number;     // Grid height
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export class MRMSContourService {
  // Contour thresholds matching standard hail categories
  private static readonly CONTOUR_THRESHOLDS = [
    0.75,  // Penny size
    1.00,  // Quarter size
    1.25,  // Half dollar size
    1.50,  // Walnut size
    1.75,  // Golf ball size
    2.00,  // Hen egg size
    2.50,  // Tennis ball size
    3.00,  // Baseball size
    4.00   // Softball size
  ];

  // Professional color scheme for hail sizes
  private static readonly CONTOUR_COLORS = {
    0.75: 'rgba(144, 238, 144, 0.6)',  // Light green
    1.00: 'rgba(255, 255, 0, 0.6)',    // Yellow
    1.25: 'rgba(255, 215, 0, 0.6)',    // Gold
    1.50: 'rgba(255, 140, 0, 0.6)',    // Dark orange
    1.75: 'rgba(255, 69, 0, 0.6)',     // Orange red
    2.00: 'rgba(255, 0, 0, 0.6)',      // Red
    2.50: 'rgba(220, 20, 60, 0.6)',    // Crimson
    3.00: 'rgba(139, 0, 0, 0.6)',      // Dark red
    4.00: 'rgba(128, 0, 128, 0.6)'     // Purple
  };

  /**
   * Fetch and process MRMS grid data
   * Real implementation would fetch actual GRIB2 files
   */
  static async fetchMRMSGrid(): Promise<MRMSGridData | null> {
    try {
      // In production, this would fetch actual MRMS GRIB2 data
      // For now, we'll interpolate from point data
      const reports = await this.getMRMSPointData();
      return this.interpolateToGrid(reports);
    } catch (error) {
      console.error('Error fetching MRMS grid:', error);
      return null;
    }
  }

  /**
   * Get MRMS point data (placeholder for actual implementation)
   */
  private static async getMRMSPointData(): Promise<HailReport[]> {
    // This would be replaced with actual MRMS data fetching
    const { MRMSService } = await import('./mrmsService');
    return await MRMSService.fetchCurrentHailData();
  }

  /**
   * Interpolate point data to regular grid using IDW
   */
  private static interpolateToGrid(reports: HailReport[]): MRMSGridData {
    console.log(`Interpolating ${reports.length} reports to grid`);
    
    // Oklahoma bounds
    const bounds = {
      north: 37.0,
      south: 33.6,
      east: -94.4,
      west: -103.0
    };

    // Create grid at ~2km resolution
    const resolution = 0.02; // degrees
    const width = Math.ceil((bounds.east - bounds.west) / resolution);
    const height = Math.ceil((bounds.north - bounds.south) / resolution);

    // Initialize grid
    const values: number[][] = Array(height).fill(0).map(() => Array(width).fill(0));

    // Interpolate using Inverse Distance Weighting
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const lat = bounds.north - (y * resolution);
        const lon = bounds.west + (x * resolution);

        let weightedSum = 0;
        let totalWeight = 0;

        reports.forEach(report => {
          const distance = Math.sqrt(
            Math.pow(lat - report.latitude, 2) + 
            Math.pow(lon - report.longitude, 2)
          );

          // Skip if too far (more than ~50km)
          if (distance > 0.5) return;

          // IDW: weight = 1 / distance^2
          const weight = distance === 0 ? 1000 : 1 / (distance * distance);
          weightedSum += report.size * weight;
          totalWeight += weight;
        });

        values[y][x] = totalWeight > 0 ? weightedSum / totalWeight : 0;
      }
    }

    // Log interpolation results
    const maxInterpolatedValue = Math.max(...values.flat());
    const minInterpolatedValue = Math.min(...values.flat().filter(v => v > 0));
    console.log(`Interpolation complete: min = ${minInterpolatedValue.toFixed(2)}, max = ${maxInterpolatedValue.toFixed(2)}`);
    
    // Apply Gaussian smoothing for professional appearance
    // Reduced sigma from 2 to 1 to preserve peak hail values
    const smoothed = this.gaussianSmooth(values, 1);
    
    const maxSmoothedValue = Math.max(...smoothed.flat());
    const minSmoothedValue = Math.min(...smoothed.flat().filter(v => v > 0));
    console.log(`After smoothing: min = ${minSmoothedValue.toFixed(2)}, max = ${maxSmoothedValue.toFixed(2)}`);
    
    // Count how many grid cells have values > 2.0
    const above2Count = smoothed.flat().filter(v => v >= 2.0).length;
    const above15Count = smoothed.flat().filter(v => v >= 1.5).length;
    console.log(`Grid cells: ${above2Count} cells >= 2.0", ${above15Count} cells >= 1.5"`);

    return { values: smoothed, width, height, bounds };
  }

  /**
   * Apply Gaussian smoothing to grid
   */
  private static gaussianSmooth(grid: number[][], sigma: number): number[][] {
    const height = grid.length;
    const width = grid[0].length;
    const smoothed: number[][] = Array(height).fill(0).map(() => Array(width).fill(0));

    // Create Gaussian kernel
    const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
    const kernel: number[][] = [];
    const center = Math.floor(kernelSize / 2);
    let sum = 0;

    for (let y = 0; y < kernelSize; y++) {
      kernel[y] = [];
      for (let x = 0; x < kernelSize; x++) {
        const distance = Math.sqrt(
          Math.pow(x - center, 2) + Math.pow(y - center, 2)
        );
        kernel[y][x] = Math.exp(-(distance * distance) / (2 * sigma * sigma));
        sum += kernel[y][x];
      }
    }

    // Normalize kernel
    for (let y = 0; y < kernelSize; y++) {
      for (let x = 0; x < kernelSize; x++) {
        kernel[y][x] /= sum;
      }
    }

    // Apply convolution
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = 0;
        
        for (let ky = 0; ky < kernelSize; ky++) {
          for (let kx = 0; kx < kernelSize; kx++) {
            const gridY = y + ky - center;
            const gridX = x + kx - center;
            
            if (gridY >= 0 && gridY < height && gridX >= 0 && gridX < width) {
              value += grid[gridY][gridX] * kernel[ky][kx];
            }
          }
        }
        
        smoothed[y][x] = value;
      }
    }

    return smoothed;
  }

  /**
   * Generate contour GeoJSON from grid data
   */
  static generateContours(gridData: MRMSGridData): any {
    const { values, width, height, bounds } = gridData;
    console.log(`Generating contours from grid: ${width}x${height}`);

    // Flatten grid for d3-contour
    const flatValues = values.flat();
    
    // Find max value in grid for debugging
    const maxValue = Math.max(...flatValues);
    console.log(`Max value in grid: ${maxValue}`);
    
    if (maxValue === 0) {
      console.warn('Grid contains only zeros - no contours will be generated');
      return {
        type: 'FeatureCollection',
        features: []
      };
    }

    // Create contour generator
    const contourGenerator = contours()
      .size([width, height])
      .thresholds(this.CONTOUR_THRESHOLDS);

    // Generate contours
    const contourFeatures = contourGenerator(flatValues);
    console.log(`Generated ${contourFeatures.length} contour features`);
    
    // Debug: Log which thresholds actually have contours
    contourFeatures.forEach((feature: any) => {
      console.log(`Contour threshold ${feature.value}: ${feature.coordinates.length} polygons`);
    });

    // Convert to GeoJSON with proper coordinates
    const features = contourFeatures.map((feature: any, index: number) => {
      const threshold = feature.value as number;
      const color = (this.CONTOUR_COLORS as any)[threshold] || 'rgba(128, 128, 128, 0.5)';

      // Log first feature's raw coordinates for debugging
      if (index === 0 && feature.coordinates.length > 0) {
        console.log('First contour feature raw coordinates sample:', feature.coordinates[0][0]?.slice(0, 3));
      }

      // Transform grid coordinates to lat/lon
      // d3-contour returns MultiPolygon geometry where each polygon is an array of rings
      const coordinates = feature.coordinates.map((polygon: any[]) => {
        // Check if polygon is already an array of rings or just a single ring
        const rings = Array.isArray(polygon[0]) && Array.isArray(polygon[0][0]) ? polygon : [polygon];
        
        return rings.map((ring: any[]) =>
          ring.map((point: any[]) => {
            const [x, y] = point;
            const lon = bounds.west + (x / width) * (bounds.east - bounds.west);
            const lat = bounds.north - (y / height) * (bounds.north - bounds.south);
            return [lon, lat];
          })
        );
      });

      // Log first transformed coordinate for debugging
      if (index === 0 && coordinates.length > 0 && coordinates[0].length > 0) {
        console.log('First contour transformed coordinates sample:', coordinates[0][0]?.slice(0, 3));
        console.log('Transform params - bounds:', bounds, 'width:', width, 'height:', height);
      }

      return {
        type: 'Feature',
        properties: {
          level: threshold,
          color: color,
          description: this.getSizeDescription(threshold)
        },
        geometry: {
          type: 'MultiPolygon',
          coordinates: coordinates
        }
      };
    });

    return {
      type: 'FeatureCollection',
      features: features
    };
  }

  /**
   * Get human-readable size description
   */
  private static getSizeDescription(size: number): string {
    if (size >= 4.00) return '4.0"+ (Softball+)';
    if (size >= 3.00) return '3.0"+ (Baseball+)';
    if (size >= 2.50) return '2.5"+ (Tennis ball+)';
    if (size >= 2.00) return '2.0-2.5" (Egg to Tennis ball)';
    if (size >= 1.75) return '1.75-2.0" (Golf ball to Egg)';
    if (size >= 1.50) return '1.5-1.75" (Walnut to Golf ball)';
    if (size >= 1.25) return '1.25-1.5" (Half dollar to Walnut)';
    if (size >= 1.00) return '1.0-1.25" (Quarter to Half dollar)';
    if (size >= 0.75) return '0.75-1.0" (Penny to Quarter)';
    return '0.5-0.75" (Dime to Penny)';
  }

  /**
   * Generate contours from hail reports (simplified version)
   */
  static async generateContoursFromReports(reports: HailReport[]): Promise<any> {
    const gridData = this.interpolateToGrid(reports);
    return this.generateContours(gridData);
  }
}