/**
 * TIER 3: Storm Events Database Service
 * Continuously improve accuracy through real-world validation
 * Data Flow: Weekly → Storm Events DB → Ground Reports → Algorithm Tuning
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HailReport } from './mrmsService';

export interface StormEventReport {
  eventId: string;
  state: string;
  eventType: string;
  beginDate: Date;
  beginLocation: { lat: number; lon: number };
  magnitude: number;  // Hail size in inches
  source: string;
  injuries: number;
  deaths: number;
  propertyDamage: string;
  narrativeComments: string;
}

export interface ValidationMetrics {
  precision: number;      // True positives / (True positives + False positives)
  recall: number;         // True positives / (True positives + False negatives)
  f1Score: number;        // 2 * (precision * recall) / (precision + recall)
  accuracyByArea: Map<string, number>;
  confidenceCalibration: number;
}

export class StormEventsService {
  
  // Sync frequency: Weekly
  private static readonly SYNC_INTERVAL = 7 * 24 * 60 * 60 * 1000;  // 1 week
  private static syncTimer: NodeJS.Timeout | null = null;

  /**
   * Start weekly validation sync
   */
  static async startWeeklyValidation(): Promise<void> {
    console.log('[TIER 3] Starting weekly Storm Events validation...');
    
    // Clear any existing timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    // Initial sync
    await this.performValidation();

    // Set up weekly sync
    this.syncTimer = setInterval(async () => {
      await this.performValidation();
    }, this.SYNC_INTERVAL);
  }

  /**
   * Stop weekly validation
   */
  static stopWeeklyValidation(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log('[TIER 3] Stopped weekly validation');
    }
  }

  /**
   * Perform validation against Storm Events Database
   */
  static async performValidation(): Promise<ValidationMetrics> {
    try {
      console.log('[TIER 3] Performing weekly validation...');

      // Get last week's predictions
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      // Fetch ground truth from Storm Events
      const groundTruth = await this.fetchStormEvents(startDate, endDate);
      
      // Get our predictions from that period
      const predictions = await this.getStoredPredictions(startDate, endDate);

      // Cross-reference and calculate metrics
      const metrics = await this.calculateValidationMetrics(predictions, groundTruth);

      // Update confidence algorithms based on results
      await this.tuneAlgorithms(metrics);

      // Store validation results
      await this.storeValidationResults(metrics);

      console.log('[TIER 3] Validation complete:', {
        precision: `${(metrics.precision * 100).toFixed(1)}%`,
        recall: `${(metrics.recall * 100).toFixed(1)}%`,
        f1Score: `${(metrics.f1Score * 100).toFixed(1)}%`
      });

      return metrics;
    } catch (error) {
      console.error('[TIER 3] Validation error:', error);
      throw error;
    }
  }

  /**
   * Fetch Storm Events from NOAA database
   */
  static async fetchStormEvents(startDate: Date, endDate: Date): Promise<StormEventReport[]> {
    const vercelUrl = process.env.EXPO_PUBLIC_VERCEL_URL || 'https://d2d-sales-tracker-tau.vercel.app';
    const results: StormEventReport[] = [];

    // SPC reports are per-day — iterate over each day in the range
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const url = `${vercelUrl}/api/spc/reports?date=${dateStr}&statewide=1`;

      try {
        console.log('[TIER 3] Fetching SPC reports for', dateStr);
        const response = await fetch(url);

        if (!response.ok) {
          console.log('[TIER 3] SPC reports error:', response.status, 'for', dateStr);
        } else {
          const data = await response.json();
          const reports: any[] = data.reports || [];
          console.log('[TIER 3] Got', reports.length, 'SPC reports for', dateStr);

          for (const r of reports) {
            results.push({
              eventId: r.id,
              state: 'OK',
              eventType: 'Hail',
              beginDate: new Date(r.timestamp),
              beginLocation: { lat: r.latitude, lon: r.longitude },
              magnitude: r.size,
              source: r.comments ? `SPC - ${r.comments.slice(0, 50)}` : 'SPC Storm Reports',
              injuries: 0,
              deaths: 0,
              propertyDamage: '$0',
              narrativeComments: r.comments || ''
            });
          }
        }
      } catch (err) {
        console.error('[TIER 3] Error fetching SPC reports for', dateStr, ':', err);
      }

      current.setDate(current.getDate() + 1);
    }

    console.log('[TIER 3] Total SPC reports fetched:', results.length);
    return results;
  }


  /**
   * Geocode location descriptions to coordinates
   * Many Storm Events only have location descriptions, not coordinates
   */
  static async geocodeLocation(location: string, state: string = 'OK'): Promise<{ lat: number; lon: number } | null> {
    try {
      // Clean up location string
      const cleanLocation = location
        .replace(/\d+\s*(N|S|E|W)\s+/gi, '') // Remove distance/direction
        .replace(/\s+/g, ' ')
        .trim();
      
      // Try geocoding with Nominatim
      const query = `${cleanLocation}, ${state}, USA`;
      const url = `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(query)}&` +
        `format=json&` +
        `limit=1`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'D2D-Sales-Tracker/1.0'
        }
      });
      
      if (!response.ok) {
        console.log('[TIER 3] Geocoding error:', response.status);
        return null;
      }
      
      const data = await response.json();
      
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon)
        };
      }
      
      return null;
    } catch (error) {
      console.error('[TIER 3] Geocoding error:', error);
      return null;
    }
  }


  /**
   * Get stored predictions for validation period
   */
  private static async getStoredPredictions(startDate: Date, endDate: Date): Promise<HailReport[]> {
    const predictions: HailReport[] = [];
    
    // Get all stored storms in date range
    const storageKeys = await AsyncStorage.getAllKeys();
    const stormKeys = storageKeys.filter(key => key.startsWith('@storm_'));

    for (const key of stormKeys) {
      try {
        const stormData = await AsyncStorage.getItem(key);
        if (stormData) {
          const storm = JSON.parse(stormData);
          const stormDate = new Date(storm.startTime);
          
          if (stormDate >= startDate && stormDate <= endDate) {
            predictions.push(...(storm.reports || []));
          }
        }
      } catch (error) {
        console.error(`[TIER 3] Error loading storm ${key}:`, error);
      }
    }

    return predictions;
  }

  /**
   * Calculate validation metrics
   */
  private static async calculateValidationMetrics(
    predictions: HailReport[],
    groundTruth: StormEventReport[]
  ): Promise<ValidationMetrics> {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    const accuracyByArea = new Map<string, number>();

    // Match predictions to ground truth
    predictions.forEach(pred => {
      const match = groundTruth.find(truth => {
        const distance = this.calculateDistance(
          pred.latitude, pred.longitude,
          truth.beginLocation.lat, truth.beginLocation.lon
        );
        const timeDiff = Math.abs(pred.timestamp.getTime() - truth.beginDate.getTime());
        
        // Match if within 10 miles and 1 hour
        return distance < 10 && timeDiff < 3600000;
      });

      if (match) {
        truePositives++;
        
        // Track accuracy by area
        const areaKey = `${Math.floor(pred.latitude)},${Math.floor(pred.longitude)}`;
        accuracyByArea.set(areaKey, (accuracyByArea.get(areaKey) || 0) + 1);
      } else {
        falsePositives++;
      }
    });

    // Check for missed events
    groundTruth.forEach(truth => {
      const match = predictions.find(pred => {
        const distance = this.calculateDistance(
          pred.latitude, pred.longitude,
          truth.beginLocation.lat, truth.beginLocation.lon
        );
        const timeDiff = Math.abs(pred.timestamp.getTime() - truth.beginDate.getTime());
        
        return distance < 10 && timeDiff < 3600000;
      });

      if (!match) {
        falseNegatives++;
      }
    });

    // Calculate metrics
    const precision = truePositives / (truePositives + falsePositives) || 0;
    const recall = truePositives / (truePositives + falseNegatives) || 0;
    const f1Score = 2 * (precision * recall) / (precision + recall) || 0;

    // Calculate confidence calibration
    const confidenceCalibration = await this.calculateConfidenceCalibration(predictions, groundTruth);

    return {
      precision,
      recall,
      f1Score,
      accuracyByArea,
      confidenceCalibration
    };
  }

  /**
   * Calculate distance between two points (miles)
   */
  private static calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /**
   * Calculate confidence calibration
   */
  private static async calculateConfidenceCalibration(
    predictions: HailReport[],
    groundTruth: StormEventReport[]
  ): Promise<number> {
    // Group predictions by confidence level
    const confidenceBuckets: { [key: string]: { predicted: number; actual: number } } = {};
    
    predictions.forEach(pred => {
      const bucket = Math.floor((pred.confidence || 0) / 10) * 10;
      if (!confidenceBuckets[bucket]) {
        confidenceBuckets[bucket] = { predicted: 0, actual: 0 };
      }
      confidenceBuckets[bucket].predicted++;
      
      // Check if this prediction was correct
      const match = groundTruth.find(truth => {
        const distance = this.calculateDistance(
          pred.latitude, pred.longitude,
          truth.beginLocation.lat, truth.beginLocation.lon
        );
        return distance < 10;
      });
      
      if (match) {
        confidenceBuckets[bucket].actual++;
      }
    });

    // Calculate calibration error
    let totalError = 0;
    let bucketCount = 0;
    
    Object.entries(confidenceBuckets).forEach(([confidence, data]) => {
      const expectedAccuracy = parseInt(confidence) / 100;
      const actualAccuracy = data.actual / data.predicted;
      totalError += Math.abs(expectedAccuracy - actualAccuracy);
      bucketCount++;
    });

    return 1 - (totalError / bucketCount);  // Higher is better
  }

  /**
   * Tune algorithms based on validation results
   */
  private static async tuneAlgorithms(metrics: ValidationMetrics): Promise<void> {
    console.log('[TIER 3] Tuning algorithms based on validation results...');

    // Get current algorithm weights
    const weightsKey = '@algorithm_weights';
    const currentWeights = await AsyncStorage.getItem(weightsKey);
    const weights = currentWeights ? JSON.parse(currentWeights) : {
      meshWeight: 0.6,
      densityWeight: 0.15,
      recencyWeight: 0.15,
      socialWeight: 0.1
    };

    // Adjust weights based on performance
    if (metrics.precision < 0.7) {
      // Too many false positives - increase threshold
      weights.meshWeight = Math.min(0.7, weights.meshWeight + 0.02);
      console.log('[TIER 3] Increased MESH weight to reduce false positives');
    } else if (metrics.recall < 0.7) {
      // Missing too many events - decrease threshold
      weights.meshWeight = Math.max(0.5, weights.meshWeight - 0.02);
      console.log('[TIER 3] Decreased MESH weight to catch more events');
    }

    // Adjust area-specific weights
    metrics.accuracyByArea.forEach((accuracy, area) => {
      const areaWeightKey = `@area_weight_${area}`;
      // Areas with better accuracy get higher confidence multipliers
      const multiplier = accuracy > 0.8 ? 1.1 : accuracy < 0.6 ? 0.9 : 1.0;
      AsyncStorage.setItem(areaWeightKey, multiplier.toString());
    });

    // Save updated weights
    await AsyncStorage.setItem(weightsKey, JSON.stringify(weights));
  }

  /**
   * Store validation results for tracking
   */
  private static async storeValidationResults(metrics: ValidationMetrics): Promise<void> {
    const historyKey = '@validation_history';
    const history = await AsyncStorage.getItem(historyKey);
    const validations = history ? JSON.parse(history) : [];

    validations.push({
      timestamp: new Date(),
      metrics: {
        precision: metrics.precision,
        recall: metrics.recall,
        f1Score: metrics.f1Score,
        confidenceCalibration: metrics.confidenceCalibration
      }
    });

    // Keep last 52 weeks (1 year)
    if (validations.length > 52) {
      validations.shift();
    }

    await AsyncStorage.setItem(historyKey, JSON.stringify(validations));
  }

  /**
   * Get accuracy dashboard data
   */
  static async getAccuracyDashboard(): Promise<any> {
    const historyKey = '@validation_history';
    const history = await AsyncStorage.getItem(historyKey);
    const validations = history ? JSON.parse(history) : [];

    // Calculate trends
    const recent = validations.slice(-4);  // Last 4 weeks
    const older = validations.slice(-8, -4);  // Previous 4 weeks

    const recentAvg = recent.reduce((sum: number, v: any) => sum + v.metrics.f1Score, 0) / recent.length || 0;
    const olderAvg = older.reduce((sum: number, v: any) => sum + v.metrics.f1Score, 0) / older.length || 0;

    return {
      currentMetrics: validations[validations.length - 1]?.metrics || {},
      trend: recentAvg > olderAvg ? 'improving' : recentAvg < olderAvg ? 'declining' : 'stable',
      percentChange: ((recentAvg - olderAvg) / olderAvg * 100).toFixed(1),
      history: validations,
      message: `Your predictions were ${(recentAvg * 100).toFixed(0)}% accurate this month`
    };
  }

  /**
   * Get territory reliability scoring
   */
  static async getTerritoryReliability(): Promise<Map<string, number>> {
    const reliability = new Map<string, number>();
    
    // Get all area weights
    const keys = await AsyncStorage.getAllKeys();
    const areaKeys = keys.filter(k => k.startsWith('@area_weight_'));
    
    for (const key of areaKeys) {
      const area = key.replace('@area_weight_', '');
      const weight = await AsyncStorage.getItem(key);
      reliability.set(area, parseFloat(weight || '1'));
    }

    return reliability;
  }
  
  /**
   * Convert Storm Events to HailReports for visualization
   */
  static async convertToHailReports(events: StormEventReport[]): Promise<HailReport[]> {
    console.log('[TIER 3] Converting', events.length, 'storm events to hail reports');
    const reports: HailReport[] = [];
    
    for (const event of events) {
      // Skip events without valid coordinates
      if (!event.beginLocation.lat || !event.beginLocation.lon) {
        // Try to geocode if we have location info in comments
        if (event.narrativeComments) {
          const coords = await this.geocodeLocation(event.narrativeComments, event.state);
          if (coords) {
            event.beginLocation = coords;
          } else {
            console.log('[TIER 3] Skipping event without coordinates:', event.eventId);
            continue;
          }
        } else {
          continue;
        }
      }
      
      const report = {
        id: `SE_${event.eventId}`,
        latitude: event.beginLocation.lat,
        longitude: event.beginLocation.lon,
        size: event.magnitude,
        timestamp: event.beginDate,
        confidence: 100, // Ground truth has 100% confidence
        city: event.narrativeComments.split(' ')[0] || 'Unknown',
        isMetroOKC: this.isInMetroOKC(event.beginLocation.lat, event.beginLocation.lon),
        source: `Storm Events - ${event.source}`,
        meshValue: event.magnitude * 25.4, // Convert inches to mm
        groundTruth: true // Mark as verified ground truth
      };
      
      console.log('[TIER 3] Created ground truth report:', report);
      reports.push(report);
    }
    
    return reports;
  }
  
  /**
   * Check if coordinates are in OKC Metro area
   */
  private static isInMetroOKC(lat: number, lon: number): boolean {
    // OKC Metro approximate bounds
    const bounds = {
      north: 35.7,
      south: 35.2,
      east: -97.1,
      west: -97.7
    };
    
    return lat >= bounds.south && lat <= bounds.north &&
           lon >= bounds.west && lon <= bounds.east;
  }
}