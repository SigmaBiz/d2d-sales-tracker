/**
 * Hail Data Flow Service
 * Implements the complete data pipeline:
 * 1. Real-Time Detection → Immediate Alerts
 * 2. Historical Archive → Territory Planning (24-48hr)
 * 3. Validation → Algorithm Tuning (Weekly)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HailReport, MRMSService } from './mrmsService';
import { HailAlertService } from './hailAlertService';
import { MRMSProxyService } from './mrmsProxyService';
import { NCEPMRMSService } from './tier1NCEPService';
import { IEMArchiveService } from './tier2IEMService';
import { StormEventsService } from './tier3StormEventsService';

export interface DataFlowStage {
  stage: 'realtime' | 'historical' | 'validation';
  timestamp: Date;
  status: 'pending' | 'processing' | 'complete' | 'error';
  data?: any;
  error?: string;
}

export class HailDataFlowService {
  private static FLOW_STATE_KEY = '@hail_data_flow_state';
  private static VALIDATION_KEY = '@hail_validation_data';
  
  /**
   * STAGE 1: Real-Time Detection
   * TIER 1: NCEP MRMS Real-Time → Immediate Alerts
   * Runs every 2-5 minutes during active weather
   */
  static async processRealtimeStage(): Promise<void> {
    console.log('[DataFlow] Stage 1: NCEP MRMS Real-time detection starting...');
    
    try {
      // Update flow state
      await this.updateFlowState('realtime', 'processing');
      
      // TIER 1: Fetch real-time NCEP MRMS data
      let reports = await NCEPMRMSService.checkForNewStorms();
      
      // Fallback to existing service if needed
      if (reports.length === 0) {
        reports = await MRMSService.fetchCurrentHailData();
      }
      
      if (reports.length > 0) {
        console.log(`[DataFlow] Detected ${reports.length} active hail reports`);
        
        // Group into storm events
        const storm = await MRMSService.groupIntoStormEvents(reports);
        await MRMSService.saveStormEvent(storm);
        
        // Trigger immediate alerts for canvassing
        await HailAlertService.checkNow();
        
        // Mark reports for historical processing
        await this.markForHistoricalProcessing(reports);
      }
      
      await this.updateFlowState('realtime', 'complete', { 
        reportCount: reports.length,
        lastCheck: new Date()
      });
      
    } catch (error) {
      console.error('[DataFlow] Real-time stage error:', error);
      await this.updateFlowState('realtime', 'error', null, error.message);
    }
  }
  
  /**
   * STAGE 2: Historical Archive Processing
   * Runs 24-48 hours after storm detection
   */
  static async processHistoricalStage(): Promise<void> {
    console.log('[DataFlow] Stage 2: Historical processing starting...');
    
    try {
      await this.updateFlowState('historical', 'processing');
      
      // Get storms from 24-48 hours ago
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - 2); // 48 hours ago
      
      // TIER 2: Fetch enhanced historical data from IEM Archives
      let historicalData = await IEMArchiveService.fetchHistoricalStorm(targetDate);
      
      // Fallback to proxy if IEM fails
      if (historicalData.length === 0) {
        historicalData = await MRMSProxyService.fetchHistoricalMRMS(targetDate);
      }
      
      if (historicalData.length > 0) {
        console.log(`[DataFlow] Processing ${historicalData.length} historical reports`);
        
        // Enhance with additional data sources
        const enhancedReports = await this.enhanceWithHistoricalContext(historicalData);
        
        // Update existing storm events with refined data
        await this.updateStormsWithHistoricalData(enhancedReports);
        
        // Generate territory planning insights
        const insights = await this.generateTerritoryInsights(enhancedReports);
        
        await this.updateFlowState('historical', 'complete', { 
          reportsProcessed: enhancedReports.length,
          insights: insights
        });
      }
      
    } catch (error) {
      console.error('[DataFlow] Historical stage error:', error);
      await this.updateFlowState('historical', 'error', null, error.message);
    }
  }
  
  /**
   * STAGE 3: Validation & Algorithm Tuning
   * Runs weekly to improve accuracy
   */
  static async processValidationStage(): Promise<void> {
    console.log('[DataFlow] Stage 3: Validation starting...');
    
    try {
      await this.updateFlowState('validation', 'processing');
      
      // TIER 3: Use Storm Events Database for validation
      const metrics = await StormEventsService.performValidation();
      
      // The tier 3 service handles all validation internally
      console.log(`[DataFlow] Validation complete - F1 Score: ${(metrics.f1Score * 100).toFixed(1)}%`);
      
      console.log(`[DataFlow] Validation metrics:`, metrics);
      
      // Update confidence algorithm weights
      await this.tuneAlgorithm(metrics);
      
      // Store validation results
      await this.storeValidationResults(metrics);
      
      await this.updateFlowState('validation', 'complete', metrics);
      
    } catch (error) {
      console.error('[DataFlow] Validation stage error:', error);
      await this.updateFlowState('validation', 'error', null, error.message);
    }
  }
  
  /**
   * Initialize automated data flow
   */
  static async initializeDataFlow(): Promise<void> {
    console.log('[DataFlow] Initializing automated data flow...');
    
    // Schedule real-time checks (every 5 minutes)
    setInterval(() => {
      this.processRealtimeStage();
    }, 5 * 60 * 1000);
    
    // Schedule historical processing (daily at 2 AM)
    const scheduleHistorical = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(2, 0, 0, 0);
      
      const msUntilRun = tomorrow.getTime() - now.getTime();
      
      setTimeout(() => {
        this.processHistoricalStage();
        scheduleHistorical(); // Reschedule for next day
      }, msUntilRun);
    };
    scheduleHistorical();
    
    // Schedule weekly validation (Sundays at 3 AM)
    const scheduleValidation = () => {
      const now = new Date();
      const nextSunday = new Date(now);
      nextSunday.setDate(now.getDate() + (7 - now.getDay()));
      nextSunday.setHours(3, 0, 0, 0);
      
      const msUntilRun = nextSunday.getTime() - now.getTime();
      
      setTimeout(() => {
        this.processValidationStage();
        scheduleValidation(); // Reschedule for next week
      }, msUntilRun);
    };
    scheduleValidation();
    
    // Run initial check
    this.processRealtimeStage();
  }
  
  /**
   * Mark reports for later historical processing
   */
  private static async markForHistoricalProcessing(reports: HailReport[]): Promise<void> {
    const pendingKey = '@pending_historical_processing';
    const existing = await AsyncStorage.getItem(pendingKey);
    const pending = existing ? JSON.parse(existing) : [];
    
    const newPending = reports.map(r => ({
      reportId: r.id,
      timestamp: r.timestamp,
      scheduledProcessing: new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours
    }));
    
    pending.push(...newPending);
    await AsyncStorage.setItem(pendingKey, JSON.stringify(pending));
  }
  
  /**
   * Enhance reports with historical context
   */
  private static async enhanceWithHistoricalContext(reports: HailReport[]): Promise<HailReport[]> {
    // Add historical patterns, previous storms at location, etc.
    return reports.map(report => ({
      ...report,
      historicalContext: {
        previousStorms: [], // Would fetch from database
        averageHailSize: 1.25,
        stormFrequency: 'moderate',
        lastMajorEvent: '2023-05-15'
      }
    }));
  }
  
  /**
   * Update storms with refined historical data
   */
  private static async updateStormsWithHistoricalData(reports: HailReport[]): Promise<void> {
    const storms = await MRMSService.getActiveStorms();
    
    // Match reports to storms and update
    for (const storm of storms) {
      const matchingReports = reports.filter(r => 
        r.timestamp >= storm.startTime &&
        (!storm.endTime || r.timestamp <= storm.endTime)
      );
      
      if (matchingReports.length > 0) {
        // Update storm with refined data
        storm.reports = matchingReports;
        storm.peakSize = Math.max(...matchingReports.map(r => r.size));
        await MRMSService.saveStormEvent(storm);
      }
    }
  }
  
  /**
   * Generate territory planning insights
   */
  private static async generateTerritoryInsights(reports: HailReport[]): Promise<any> {
    // Group by area and calculate insights
    const insights = {
      hotspots: [], // Areas with most damage
      optimalRoutes: [], // Best canvassing routes
      priorityZones: [], // High-value targets
      competitorActivity: [] // Areas being worked
    };
    
    // Simple hotspot detection
    const gridSize = 0.05; // ~5km grid
    const grid = new Map();
    
    reports.forEach(report => {
      const gridKey = `${Math.floor(report.latitude / gridSize)},${Math.floor(report.longitude / gridSize)}`;
      const cell = grid.get(gridKey) || { count: 0, totalSize: 0, reports: [] };
      cell.count++;
      cell.totalSize += report.size;
      cell.reports.push(report);
      grid.set(gridKey, cell);
    });
    
    // Find top hotspots
    const cells = Array.from(grid.entries());
    cells.sort((a, b) => b[1].count - a[1].count);
    
    insights.hotspots = cells.slice(0, 5).map(([key, cell]) => ({
      location: key,
      reportCount: cell.count,
      averageSize: cell.totalSize / cell.count
    }));
    
    return insights;
  }
  
  /**
   * Get stored predictions for validation
   */
  private static async getStoredPredictions(since: Date): Promise<HailReport[]> {
    const storms = await MRMSService.getActiveStorms();
    const predictions: HailReport[] = [];
    
    storms.forEach(storm => {
      if (storm.startTime >= since) {
        predictions.push(...storm.reports);
      }
    });
    
    return predictions;
  }
  
  /**
   * Calculate accuracy metrics
   */
  private static async calculateAccuracyMetrics(predictions: HailReport[], groundTruth: any[]): Promise<any> {
    const metrics = {
      totalPredictions: predictions.length,
      totalActual: groundTruth.length,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      sizeAccuracy: 0,
      locationAccuracy: 0
    };
    
    // Simple matching algorithm (would be more sophisticated in production)
    predictions.forEach(pred => {
      const match = groundTruth.find(actual => 
        Math.abs(actual.lat - pred.latitude) < 0.05 &&
        Math.abs(actual.lon - pred.longitude) < 0.05 &&
        Math.abs(new Date(actual.date).getTime() - pred.timestamp.getTime()) < 3600000
      );
      
      if (match) {
        metrics.truePositives++;
        metrics.sizeAccuracy += 1 - Math.abs(match.size - pred.size) / match.size;
      } else {
        metrics.falsePositives++;
      }
    });
    
    metrics.falseNegatives = groundTruth.length - metrics.truePositives;
    metrics.precision = metrics.truePositives / (metrics.truePositives + metrics.falsePositives);
    metrics.recall = metrics.truePositives / (metrics.truePositives + metrics.falseNegatives);
    metrics.f1Score = 2 * (metrics.precision * metrics.recall) / (metrics.precision + metrics.recall);
    
    return metrics;
  }
  
  /**
   * Tune algorithm based on validation results
   */
  private static async tuneAlgorithm(metrics: any): Promise<void> {
    // Adjust confidence scoring weights based on performance
    const currentWeights = {
      meshWeight: 0.7,
      densityWeight: 0.1,
      recencyWeight: 0.1,
      socialWeight: 0.1
    };
    
    // Simple tuning logic (would use ML in production)
    if (metrics.precision < 0.7) {
      // Too many false positives, increase threshold
      currentWeights.meshWeight = Math.min(0.8, currentWeights.meshWeight + 0.05);
    } else if (metrics.recall < 0.7) {
      // Missing too many actual events, decrease threshold
      currentWeights.meshWeight = Math.max(0.6, currentWeights.meshWeight - 0.05);
    }
    
    // Store updated weights
    await AsyncStorage.setItem('@confidence_weights', JSON.stringify(currentWeights));
  }
  
  /**
   * Store validation results for tracking
   */
  private static async storeValidationResults(metrics: any): Promise<void> {
    const history = await AsyncStorage.getItem(this.VALIDATION_KEY);
    const validations = history ? JSON.parse(history) : [];
    
    validations.push({
      timestamp: new Date(),
      metrics: metrics
    });
    
    // Keep last 12 weeks
    if (validations.length > 12) {
      validations.shift();
    }
    
    await AsyncStorage.setItem(this.VALIDATION_KEY, JSON.stringify(validations));
  }
  
  /**
   * Update flow state
   */
  private static async updateFlowState(
    stage: 'realtime' | 'historical' | 'validation',
    status: 'pending' | 'processing' | 'complete' | 'error',
    data?: any,
    error?: string
  ): Promise<void> {
    const state = await this.getFlowState();
    
    state[stage] = {
      stage,
      timestamp: new Date(),
      status,
      data,
      error
    };
    
    await AsyncStorage.setItem(this.FLOW_STATE_KEY, JSON.stringify(state));
  }
  
  /**
   * Get current flow state
   */
  static async getFlowState(): Promise<Record<string, DataFlowStage>> {
    const state = await AsyncStorage.getItem(this.FLOW_STATE_KEY);
    return state ? JSON.parse(state) : {
      realtime: { stage: 'realtime', status: 'pending', timestamp: new Date() },
      historical: { stage: 'historical', status: 'pending', timestamp: new Date() },
      validation: { stage: 'validation', status: 'pending', timestamp: new Date() }
    };
  }
}