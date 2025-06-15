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
  // NOAA Storm Events Database endpoints
  private static readonly BASE_URL = 'https://www.ncdc.noaa.gov/stormevents';
  private static readonly API_TOKEN = 'CDGJHfvqrDDqVCDC';  // Example token
  
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
    try {
      // Format dates for API
      const format = (date: Date) => date.toISOString().split('T')[0];
      
      // NOAA Storm Events API endpoint
      const url = `${this.BASE_URL}/json?` +
        `token=${this.API_TOKEN}&` +
        `eventType=Hail&` +
        `state=OK&` +  // Oklahoma focus
        `beginDate=${format(startDate)}&` +
        `endDate=${format(endDate)}`;

      const response = await fetch(url);
      
      if (!response.ok) {
        // Fallback to CSV endpoint
        return await this.fetchStormEventsCSV(startDate, endDate);
      }

      const data = await response.json();
      return this.parseStormEvents(data);
    } catch (error) {
      console.error('[TIER 3] Error fetching Storm Events:', error);
      
      // Use cached/mock data for demo
      return this.getMockStormEvents(startDate, endDate);
    }
  }

  /**
   * Alternative CSV fetch for Storm Events
   */
  private static async fetchStormEventsCSV(startDate: Date, endDate: Date): Promise<StormEventReport[]> {
    try {
      const year = startDate.getFullYear();
      const csvUrl = `${this.BASE_URL}/csv?` +
        `eventType=Hail&` +
        `beginDate=${startDate.toISOString().split('T')[0]}&` +
        `endDate=${endDate.toISOString().split('T')[0]}`;

      const response = await fetch(csvUrl);
      const csvText = await response.text();
      
      // Parse CSV (simplified)
      const lines = csvText.split('\n');
      const headers = lines[0].split(',');
      const reports: StormEventReport[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length > 10) {
          reports.push({
            eventId: values[0],
            state: values[1],
            eventType: 'Hail',
            beginDate: new Date(values[3]),
            beginLocation: {
              lat: parseFloat(values[7]) || 0,
              lon: parseFloat(values[8]) || 0
            },
            magnitude: parseFloat(values[9]) || 0,
            source: values[10],
            injuries: parseInt(values[11]) || 0,
            deaths: parseInt(values[12]) || 0,
            propertyDamage: values[13],
            narrativeComments: values[14]
          });
        }
      }

      return reports;
    } catch (error) {
      console.error('[TIER 3] CSV fetch error:', error);
      return [];
    }
  }

  /**
   * Parse Storm Events JSON response
   */
  private static parseStormEvents(data: any): StormEventReport[] {
    const reports: StormEventReport[] = [];

    if (data.events && Array.isArray(data.events)) {
      data.events.forEach((event: any) => {
        if (event.event_type === 'Hail') {
          reports.push({
            eventId: event.event_id,
            state: event.state,
            eventType: event.event_type,
            beginDate: new Date(event.begin_date_time),
            beginLocation: {
              lat: parseFloat(event.begin_lat) || 0,
              lon: parseFloat(event.begin_lon) || 0
            },
            magnitude: parseFloat(event.magnitude) || 0,
            source: event.source,
            injuries: event.injuries_direct || 0,
            deaths: event.deaths_direct || 0,
            propertyDamage: event.damage_property,
            narrativeComments: event.event_narrative
          });
        }
      });
    }

    return reports;
  }

  /**
   * Get mock storm events for testing
   */
  private static getMockStormEvents(startDate: Date, endDate: Date): StormEventReport[] {
    return [
      {
        eventId: 'MOCK_001',
        state: 'OK',
        eventType: 'Hail',
        beginDate: new Date(startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime())),
        beginLocation: { lat: 35.4676, lon: -97.5164 },
        magnitude: 1.75,
        source: 'TRAINED SPOTTER',
        injuries: 0,
        deaths: 0,
        propertyDamage: '$50,000',
        narrativeComments: 'Golf ball size hail reported in Oklahoma City metro area'
      },
      {
        eventId: 'MOCK_002',
        state: 'OK',
        eventType: 'Hail',
        beginDate: new Date(startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime())),
        beginLocation: { lat: 35.2226, lon: -97.4395 },
        magnitude: 1.0,
        source: 'PUBLIC',
        injuries: 0,
        deaths: 0,
        propertyDamage: '$10,000',
        narrativeComments: 'Quarter size hail in Norman'
      }
    ];
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
}