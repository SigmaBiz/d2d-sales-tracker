/**
 * Test utility to demonstrate Tier 1 vs Tier 2 visual differentiation
 * This creates test storms without permanently saving them to storage
 */

import { StormEvent } from '../services/mrmsService';

export const createTestStorms = (): StormEvent[] => {
  const now = new Date();
  
  // Tier 1 Real-time storm (severe - will auto-populate)
  const tier1Storm: StormEvent = {
    id: `test_tier1_${Date.now()}`,
    name: 'Live Storm - Edmond',
    startTime: new Date(now.getTime() - 30 * 60 * 1000), // 30 min ago
    endTime: undefined,
    maxSize: 2.5, // Severe storm
    reports: [
      {
        id: 'test_t1_1',
        latitude: 35.6528,
        longitude: -97.4781,
        size: 2.5,
        timestamp: new Date(now.getTime() - 20 * 60 * 1000),
        confidence: 75,
        confidenceFactors: {
          sizeScore: 40,
          temporalScore: 20,
          spatialScore: 15,
          multiRadarScore: 0
        },
        source: 'MRMS',
        city: 'Edmond'
      },
      {
        id: 'test_t1_2',
        latitude: 35.6628,
        longitude: -97.4681,
        size: 2.0,
        timestamp: new Date(now.getTime() - 15 * 60 * 1000),
        confidence: 70,
        confidenceFactors: {
          sizeScore: 35,
          temporalScore: 20,
          spatialScore: 15,
          multiRadarScore: 0
        },
        source: 'MRMS',
        city: 'Edmond'
      }
    ],
    source: 'MRMS',
    enabled: true
  };

  // Mark as auto-populated since it's ≥2 inches
  (tier1Storm as any).autoPopulated = true;
  (tier1Storm as any).autoPopulatedAt = now;

  // Tier 2 Historical storm (moderate)
  const tier2Storm: StormEvent = {
    id: `test_tier2_${Date.now() + 1}`,
    name: 'Historical Storm - Moore',
    startTime: new Date('2024-09-24T18:00:00'),
    endTime: new Date('2024-09-24T20:00:00'),
    maxSize: 1.75,
    reports: [
      {
        id: 'test_t2_1',
        latitude: 35.3395,
        longitude: -97.4867,
        size: 1.75,
        timestamp: new Date('2024-09-24T19:00:00'),
        confidence: 85,
        confidenceFactors: {
          sizeScore: 40,
          temporalScore: 25,
          spatialScore: 20,
          multiRadarScore: 0
        },
        source: 'IEM',
        city: 'Moore'
      },
      {
        id: 'test_t2_2',
        latitude: 35.3295,
        longitude: -97.4767,
        size: 1.5,
        timestamp: new Date('2024-09-24T19:15:00'),
        confidence: 80,
        confidenceFactors: {
          sizeScore: 35,
          temporalScore: 25,
          spatialScore: 20,
          multiRadarScore: 0
        },
        source: 'IEM',
        city: 'Moore'
      }
    ],
    source: 'IEM',
    enabled: true,
  };

  // Tier 1 Real-time storm (small - won't auto-populate)
  const tier1SmallStorm: StormEvent = {
    id: `test_tier1_small_${Date.now() + 2}`,
    name: 'Live Storm - Norman',
    startTime: new Date(now.getTime() - 10 * 60 * 1000), // 10 min ago
    endTime: undefined,
    maxSize: 1.25,
    reports: [
      {
        id: 'test_t1_3',
        latitude: 35.2226,
        longitude: -97.4395,
        size: 1.25,
        timestamp: new Date(now.getTime() - 5 * 60 * 1000),
        confidence: 65,
        confidenceFactors: {
          sizeScore: 30,
          temporalScore: 20,
          spatialScore: 15,
          multiRadarScore: 0
        },
        source: 'MRMS',
        city: 'Norman'
      }
    ],
    source: 'MRMS',
    enabled: false, // Start disabled to show difference
  };

  // Add missing properties to all storms
  [tier1Storm, tier2Storm, tier1SmallStorm].forEach(storm => {
    if (!storm.center && storm.reports.length > 0) {
      storm.center = {
        lat: storm.reports[0].latitude,
        lon: storm.reports[0].longitude
      };
    }
    if (storm.isActive === undefined) {
      storm.isActive = !storm.endTime;
    }
    if (storm.confidence === undefined && storm.reports.length > 0) {
      storm.confidence = Math.round(
        storm.reports.reduce((sum, r) => sum + r.confidence, 0) / storm.reports.length
      );
    }
  });

  return [tier1Storm, tier2Storm, tier1SmallStorm];
};

/**
 * Creates a visual differentiation test scenario
 * Shows T1/T2 badges, LIVE/HISTORICAL indicators, and AUTO badge
 */
export const testVisualDifferentiation = () => {
  console.log('=== Testing Storm Visual Differentiation ===');
  console.log('Creating 3 test storms:');
  console.log('1. Tier 1 (LIVE) - Severe storm in Edmond (2.5") - Will show T1, LIVE, and AUTO badges');
  console.log('2. Tier 2 (HISTORICAL) - Moore storm from Sept 24 (1.75") - Will show T2 and HISTORICAL');
  console.log('3. Tier 1 (LIVE) - Small storm in Norman (1.25") - Will show T1 and LIVE only');
  
  const testStorms = createTestStorms();
  
  console.log('\nStorm details:');
  testStorms.forEach(storm => {
    console.log(`- ${storm.name}: ${storm.maxSize}" hail, Source: ${storm.source}, Enabled: ${storm.enabled}`);
  });
  
  return testStorms;
};