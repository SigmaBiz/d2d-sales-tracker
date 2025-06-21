/**
 * Integrated Hail Intelligence System
 * Orchestrates all three tiers of the hail data pipeline
 */

import { NCEPMRMSService } from './tier1NCEPService';
import { IEMArchiveService } from './tier2IEMService';
import { StormEventsService } from './tier3StormEventsService';
import { HailDataFlowService } from './hailDataFlowService';
import { HailAlertService } from './hailAlertService';
import { MRMSService } from './mrmsService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRealtimeServerUrl } from '../config/api.config';

export interface HailIntelligenceConfig {
  enableRealTime: boolean;
  enableHistorical: boolean;
  enableValidation: boolean;
  serviceArea: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  alertThreshold: number;  // Minimum MESH value in mm
}

export class IntegratedHailIntelligence {
  private static config: HailIntelligenceConfig = {
    enableRealTime: true,
    enableHistorical: true,
    enableValidation: true,
    serviceArea: {
      north: 35.7,    // North of Edmond
      south: 35.1,    // South of Norman
      east: -97.1,    // East of Midwest City
      west: -97.8     // West of Yukon
    },
    alertThreshold: 25  // 1 inch hail
  };

  /**
   * Initialize the complete 3-tier system
   */
  static async initialize(config?: Partial<HailIntelligenceConfig>): Promise<void> {
    console.log('=== Initializing 3-Tier Hail Intelligence System ===');
    
    // Merge config
    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Save config
    await AsyncStorage.setItem('@hail_intelligence_config', JSON.stringify(this.config));

    // Initialize each tier
    if (this.config.enableRealTime) {
      await this.initializeTier1();
    }

    if (this.config.enableHistorical) {
      await this.initializeTier2();
    }

    if (this.config.enableValidation) {
      await this.initializeTier3();
    }

    // Start the integrated data flow
    await HailDataFlowService.initializeDataFlow();

    console.log('=== Hail Intelligence System Ready ===');
  }

  /**
   * TIER 1: Real-Time Storm Detection
   */
  private static async initializeTier1(): Promise<void> {
    console.log('[TIER 1] Initializing NCEP MRMS Real-Time...');
    
    // Start real-time monitoring
    await NCEPMRMSService.startRealTimeMonitoring();
    
    // Set up quick deploy bounds
    await NCEPMRMSService.enableQuickDeploy(this.config.serviceArea);
    
    // Configure alerts
    await HailAlertService.initialize();
    
    console.log('[TIER 1] Real-time detection active - 2 minute updates');
  }

  /**
   * TIER 2: Historical Data Validation
   */
  private static async initializeTier2(): Promise<void> {
    console.log('[TIER 2] Initializing IEM Archive access...');
    
    // Pre-fetch recent historical data
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    try {
      const historicalData = await IEMArchiveService.fetchHistoricalStorm(yesterday);
      console.log(`[TIER 2] Loaded ${historicalData.length} historical reports from yesterday`);
    } catch (error) {
      console.log('[TIER 2] No historical data for yesterday');
    }
    
    // Load September 24, 2024 if requested
    try {
      const sept24 = new Date('2024-09-24');
      const sept24Data = await IEMArchiveService.fetchHistoricalStorm(sept24);
      if (sept24Data.length > 0) {
        console.log(`[TIER 2] September 24, 2024 data available: ${sept24Data.length} reports`);
      }
    } catch (error) {
      console.log('[TIER 2] September 24, 2024 data not available');
    }
    
    console.log('[TIER 2] Historical archive access ready');
  }

  /**
   * TIER 3: Ground Truth Validation
   */
  private static async initializeTier3(): Promise<void> {
    console.log('[TIER 3] Initializing Storm Events validation...');
    
    // Start weekly validation
    await StormEventsService.startWeeklyValidation();
    
    // Load accuracy dashboard
    const dashboard = await StormEventsService.getAccuracyDashboard();
    console.log(`[TIER 3] Current accuracy: ${dashboard.message}`);
    
    console.log('[TIER 3] Weekly validation scheduled');
  }

  /**
   * Get current system status
   */
  static async getSystemStatus(): Promise<any> {
    const flowState = await HailDataFlowService.getFlowState();
    const config = await AsyncStorage.getItem('@hail_intelligence_config');
    const accuracy = await StormEventsService.getAccuracyDashboard();
    
    // Check real-time server health
    let realtimeServerStatus = 'offline';
    let realtimeMonitoring = false;
    try {
      const serverUrl = getRealtimeServerUrl('/health');
      const response = await fetch(serverUrl);
      if (response.ok) {
        const health = await response.json();
        realtimeServerStatus = health.status === 'ok' ? 'online' : 'error';
        realtimeMonitoring = health.monitoring || false;
      }
    } catch (error) {
      console.log('[Intelligence] Real-time server unreachable');
    }
    
    return {
      config: config ? JSON.parse(config) : this.config,
      tiers: {
        realTime: {
          enabled: this.config.enableRealTime,
          status: realtimeMonitoring ? 'active' : flowState.realtime?.status || 'inactive',
          lastUpdate: flowState.realtime?.timestamp,
          serverStatus: realtimeServerStatus,
          monitoring: realtimeMonitoring
        },
        historical: {
          enabled: this.config.enableHistorical,
          status: flowState.historical?.status || 'inactive',
          lastUpdate: flowState.historical?.timestamp
        },
        validation: {
          enabled: this.config.enableValidation,
          status: flowState.validation?.status || 'inactive',
          lastUpdate: flowState.validation?.timestamp,
          accuracy: accuracy.currentMetrics
        }
      }
    };
  }

  /**
   * Storm Tracker - Real-time MESH overlay
   */
  static async getStormTracker(): Promise<any> {
    const storms = await MRMSService.getActiveStorms();
    const realTimeAlerts = await AsyncStorage.getItem('@tier1_latest_alerts');
    const progressions = await NCEPMRMSService.getAllStormProgressions();
    
    return {
      activeStorms: storms,
      latestAlerts: realTimeAlerts ? JSON.parse(realTimeAlerts) : null,
      progressions: progressions,
      meshOverlay: storms.map(storm => ({
        id: storm.id,
        reports: storm.reports,
        intensity: storm.maxSize,
        progression: storm.reports.map(r => ({
          time: r.timestamp,
          lat: r.latitude,
          lon: r.longitude,
          size: r.size
        })),
        timeline: progressions[storm.id] || null
      }))
    };
  }

  /**
   * Historical Storm Library - Searchable database
   */
  static async searchHistoricalStorms(params: {
    date?: Date;
    dateRange?: { start: Date; end: Date };
    location?: { lat: number; lon: number; radius: number };
  }): Promise<any> {
    if (params.date) {
      // Single date search
      return await IEMArchiveService.fetchHistoricalStorm(params.date);
    } else if (params.dateRange) {
      // Date range search
      return await IEMArchiveService.getStormLibrary(
        params.dateRange.start,
        params.dateRange.end,
        this.config.serviceArea
      );
    } else if (params.location) {
      // Location-based search
      return await IEMArchiveService.getAddressHailHistory(
        params.location.lat,
        params.location.lon,
        params.location.radius
      );
    }
    
    return [];
  }

  /**
   * Territory Heat Map - Cumulative damage probability
   */
  static async generateTerritoryHeatMap(months: number = 12): Promise<any> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    
    return await IEMArchiveService.generateTerritoryHeatMap(
      this.config.serviceArea,
      { start: startDate, end: endDate }
    );
  }

  /**
   * Customer Presentation Mode
   */
  static async getCustomerPresentation(address: {
    latitude: number;
    longitude: number;
  }): Promise<any> {
    // Get historical hail at this address
    const history = await IEMArchiveService.getAddressHailHistory(
      address.latitude,
      address.longitude,
      1  // 1 mile radius
    );

    // Get territory reliability
    const reliability = await StormEventsService.getTerritoryReliability();
    const areaKey = `${Math.floor(address.latitude)},${Math.floor(address.longitude)}`;
    const areaReliability = reliability.get(areaKey) || 1.0;

    return {
      address,
      hailHistory: history,
      riskLevel: history.length > 2 ? 'high' : history.length > 0 ? 'moderate' : 'low',
      lastEvent: history[0]?.date || null,
      maxHailSize: Math.max(...history.map((h: any) => h.maxSize), 0),
      predictionReliability: areaReliability,
      recommendation: history.length > 0 ? 
        'Your property has experienced hail damage in the past. A roof inspection is recommended.' :
        'No significant hail events recorded at your property in our database.'
    };
  }

  /**
   * Accuracy Dashboard
   */
  static async getAccuracyDashboard(): Promise<any> {
    return await StormEventsService.getAccuracyDashboard();
  }

  /**
   * Performance Analytics
   */
  static async getPerformanceAnalytics(): Promise<any> {
    const dashboard = await StormEventsService.getAccuracyDashboard();
    const reliability = await StormEventsService.getTerritoryReliability();
    
    // Calculate area performance
    const areaPerformance: any[] = [];
    reliability.forEach((score, area) => {
      const [lat, lon] = area.split(',').map(Number);
      areaPerformance.push({
        area: { lat, lon },
        reliability: score,
        rating: score > 1.05 ? 'excellent' : score > 0.95 ? 'good' : 'needs improvement'
      });
    });

    return {
      overall: dashboard,
      byArea: areaPerformance,
      recommendations: this.generatePerformanceRecommendations(dashboard, areaPerformance)
    };
  }

  /**
   * Generate performance recommendations
   */
  private static generatePerformanceRecommendations(dashboard: any, areaPerformance: any[]): string[] {
    const recommendations: string[] = [];

    // Overall accuracy recommendations
    if (dashboard.currentMetrics.precision < 0.7) {
      recommendations.push('Consider increasing alert thresholds to reduce false positives');
    }
    if (dashboard.currentMetrics.recall < 0.7) {
      recommendations.push('Lower detection thresholds to catch more actual hail events');
    }

    // Area-specific recommendations
    const poorAreas = areaPerformance.filter(a => a.rating === 'needs improvement');
    if (poorAreas.length > 0) {
      recommendations.push(`Focus canvassing efforts on high-reliability areas for better conversion rates`);
    }

    // Trend-based recommendations
    if (dashboard.trend === 'improving') {
      recommendations.push('Keep current settings - accuracy is improving!');
    } else if (dashboard.trend === 'declining') {
      recommendations.push('Review recent algorithm changes - accuracy has declined');
    }

    return recommendations;
  }

  /**
   * Shutdown the system
   */
  static async shutdown(): Promise<void> {
    console.log('=== Shutting down Hail Intelligence System ===');
    
    NCEPMRMSService.stopRealTimeMonitoring();
    StormEventsService.stopWeeklyValidation();
    
    await AsyncStorage.setItem('@hail_intelligence_status', 'inactive');
    
    console.log('=== System shutdown complete ===');
  }
}