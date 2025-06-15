/**
 * Confidence Scoring Algorithm
 * Multi-factor analysis for hail damage probability
 */

import { HailReport } from './mrmsService';

export interface ConfidenceFactors {
  meshScore: number;           // 0-70% based on MESH value
  socialScore: number;         // 0-20% based on social media
  recencyScore: number;        // 0-10% based on time since storm
  densityScore: number;        // 0-10% based on report density
  totalScore: number;          // 0-100% combined score
}

export interface SocialMediaData {
  platform: 'twitter' | 'facebook' | 'instagram';
  mentions: number;
  verifiedAccounts: number;
  damageReports: number;
  timestamp: Date;
}

export class ConfidenceScoring {
  /**
   * Calculate comprehensive confidence score for a hail report
   */
  static calculateConfidence(
    report: HailReport,
    nearbyReports: HailReport[],
    socialData?: SocialMediaData[]
  ): ConfidenceFactors {
    const meshScore = this.calculateMESHScore(report.size);
    const socialScore = this.calculateSocialScore(report, socialData || []);
    const recencyScore = this.calculateRecencyScore(report.timestamp);
    const densityScore = this.calculateDensityScore(report, nearbyReports);
    
    // Weighted total (may exceed 100% for extreme events)
    const totalScore = Math.min(
      meshScore + socialScore + recencyScore + densityScore,
      100
    );
    
    return {
      meshScore,
      socialScore,
      recencyScore,
      densityScore,
      totalScore
    };
  }

  /**
   * MESH Base Score (0-70%)
   * Based on NOAA's correlation data between MESH and actual damage
   */
  private static calculateMESHScore(sizeInches: number): number {
    // Based on NOAA research:
    // <1" = 10-20% damage probability
    // 1-1.5" = 30-40% damage probability  
    // 1.5-2" = 50-60% damage probability
    // 2-2.5" = 65-70% damage probability
    // >2.5" = 70% damage probability
    
    if (sizeInches >= 2.5) return 70;
    if (sizeInches >= 2.0) return 65;
    if (sizeInches >= 1.5) return 55;
    if (sizeInches >= 1.0) return 35;
    if (sizeInches >= 0.75) return 20;
    return 10;
  }

  /**
   * Social Media Score (0-20%)
   * Analyzes social media activity to validate reports
   */
  private static calculateSocialScore(
    report: HailReport,
    socialData: SocialMediaData[]
  ): number {
    if (socialData.length === 0) return 0;
    
    let score = 0;
    const relevantPosts = socialData.filter(post => {
      const timeDiff = Math.abs(post.timestamp.getTime() - report.timestamp.getTime());
      return timeDiff < 2 * 60 * 60 * 1000; // Within 2 hours
    });
    
    // Mention volume (0-10%)
    const totalMentions = relevantPosts.reduce((sum, post) => sum + post.mentions, 0);
    if (totalMentions >= 100) score += 10;
    else if (totalMentions >= 50) score += 7;
    else if (totalMentions >= 20) score += 5;
    else if (totalMentions >= 10) score += 3;
    else if (totalMentions > 0) score += 1;
    
    // Verified accounts (0-5%)
    const verifiedMentions = relevantPosts.reduce((sum, post) => sum + post.verifiedAccounts, 0);
    if (verifiedMentions >= 5) score += 5;
    else if (verifiedMentions >= 3) score += 4;
    else if (verifiedMentions >= 1) score += 2;
    
    // Damage reports (0-5%)
    const damageReports = relevantPosts.reduce((sum, post) => sum + post.damageReports, 0);
    if (damageReports >= 10) score += 5;
    else if (damageReports >= 5) score += 4;
    else if (damageReports >= 2) score += 3;
    else if (damageReports >= 1) score += 2;
    
    return Math.min(score, 20);
  }

  /**
   * Recency Score (0-10%)
   * Fresh storms have higher confidence
   */
  private static calculateRecencyScore(timestamp: Date): number {
    const now = new Date();
    const ageInDays = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60 * 24);
    
    if (ageInDays <= 1) return 10;      // Within 24 hours
    if (ageInDays <= 3) return 8;       // 1-3 days
    if (ageInDays <= 7) return 6;       // 3-7 days
    if (ageInDays <= 14) return 4;      // 1-2 weeks
    if (ageInDays <= 30) return 2;      // 2-4 weeks
    return 0;                            // Older than 30 days
  }

  /**
   * Density Score (0-10%)
   * Multiple reports in area increase confidence
   */
  private static calculateDensityScore(
    report: HailReport,
    nearbyReports: HailReport[]
  ): number {
    // Count reports within 5 miles and 30 minutes
    const relevantReports = nearbyReports.filter(nearby => {
      const distance = this.calculateDistance(
        report.latitude, report.longitude,
        nearby.latitude, nearby.longitude
      );
      const timeDiff = Math.abs(
        report.timestamp.getTime() - nearby.timestamp.getTime()
      );
      
      return distance <= 5 && timeDiff <= 30 * 60 * 1000;
    });
    
    const count = relevantReports.length;
    
    if (count >= 10) return 10;
    if (count >= 7) return 8;
    if (count >= 5) return 6;
    if (count >= 3) return 4;
    if (count >= 1) return 2;
    return 0;
  }

  /**
   * Calculate distance between two points in miles
   */
  private static calculateDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number
  ): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private static toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Get confidence level description
   */
  static getConfidenceLevel(score: number): {
    level: string;
    color: string;
    recommendation: string;
  } {
    if (score >= 85) return {
      level: 'Very High',
      color: '#dc2626',  // Red
      recommendation: 'Immediate canvassing recommended - high damage probability'
    };
    
    if (score >= 70) return {
      level: 'High',
      color: '#f97316',  // Orange
      recommendation: 'Priority area - likely significant damage'
    };
    
    if (score >= 55) return {
      level: 'Moderate',
      color: '#f59e0b',  // Yellow
      recommendation: 'Good potential - worth canvassing'
    };
    
    if (score >= 40) return {
      level: 'Low',
      color: '#84cc16',  // Light green
      recommendation: 'Possible damage - check if time permits'
    };
    
    return {
      level: 'Very Low',
      color: '#22c55e',  // Green
      recommendation: 'Unlikely damage - focus on higher confidence areas'
    };
  }

  /**
   * Calculate saturation score for an area
   * Helps avoid over-canvassed neighborhoods
   */
  static calculateSaturationScore(
    centerLat: number,
    centerLon: number,
    radiusMiles: number,
    competitorReports: Array<{lat: number, lon: number, timestamp: Date}>
  ): number {
    const recentReports = competitorReports.filter(report => {
      const daysSince = (Date.now() - report.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince <= 7; // Last 7 days
    });
    
    const nearbyCompetitors = recentReports.filter(report => {
      const distance = this.calculateDistance(
        centerLat, centerLon,
        report.lat, report.lon
      );
      return distance <= radiusMiles;
    });
    
    // Score based on competitor density
    const density = nearbyCompetitors.length / (Math.PI * radiusMiles * radiusMiles);
    
    if (density >= 1.0) return 90;    // Very saturated
    if (density >= 0.5) return 70;    // Saturated
    if (density >= 0.25) return 50;   // Moderate competition
    if (density >= 0.1) return 30;    // Light competition
    return 10;                         // Minimal competition
  }

  /**
   * Generate damage probability statement for homeowners
   */
  static generateDamageStatement(
    confidence: ConfidenceFactors,
    hailSize: number
  ): string {
    const level = this.getConfidenceLevel(confidence.totalScore);
    
    let statement = `Based on ${hailSize.toFixed(1)}" hail detected in your area, `;
    statement += `there is a ${level.level.toLowerCase()} probability (${confidence.totalScore}%) `;
    statement += `of roof damage to your property. `;
    
    if (confidence.socialScore > 10) {
      statement += `Multiple residents in your neighborhood have reported damage. `;
    }
    
    if (confidence.recencyScore >= 8) {
      statement += `This is a recent storm event with fresh damage. `;
    }
    
    if (confidence.densityScore >= 6) {
      statement += `High concentration of hail reports confirm significant impact in your area. `;
    }
    
    return statement;
  }
}