/**
 * Test script to debug contour generation issue
 */

import { SimpleContourService } from '../services/simpleContourService';
import { HailReport } from '../services/mrmsService';

// Test data matching what we get from the server
const testReports: HailReport[] = [
  {
    id: "hist_mesh_001",
    latitude: 35.4676,
    longitude: -97.5164,
    size: 2.25,
    meshValue: 57.15,
    timestamp: new Date("2024-09-24T20:30:00.000Z"),
    confidence: 92,
    city: "Oklahoma City",
    isMetroOKC: true,
    source: "Historical MESH Data",
    description: "Significant hail event - OKC Metro"
  },
  {
    id: "hist_mesh_002",
    latitude: 35.3395,
    longitude: -97.4867,
    size: 1.75,
    meshValue: 44.45,
    timestamp: new Date("2024-09-24T20:45:00.000Z"),
    confidence: 88,
    city: "Moore",
    isMetroOKC: true,
    source: "Historical MESH Data"
  },
  {
    id: "hist_mesh_003",
    latitude: 35.2226,
    longitude: -97.4395,
    size: 1.5,
    meshValue: 38.1,
    timestamp: new Date("2024-09-24T21:00:00.000Z"),
    confidence: 85,
    city: "Norman",
    isMetroOKC: true,
    source: "Historical MESH Data"
  },
  {
    id: "hist_mesh_004",
    latitude: 35.4934,
    longitude: -97.2891,
    size: 1.25,
    meshValue: 31.75,
    timestamp: new Date("2024-09-24T21:15:00.000Z"),
    confidence: 82,
    city: "Midwest City",
    isMetroOKC: true,
    source: "Historical MESH Data"
  },
  {
    id: "hist_mesh_005",
    latitude: 35.6528,
    longitude: -97.4781,
    size: 1,
    meshValue: 25.4,
    timestamp: new Date("2024-09-24T21:30:00.000Z"),
    confidence: 80,
    city: "Edmond",
    isMetroOKC: true,
    source: "Historical MESH Data"
  }
];

export function testContourGeneration() {
  console.log('=== Testing Contour Generation ===');
  console.log('Test reports:', testReports.map(r => ({ size: r.size, city: r.city })));
  
  const contours = SimpleContourService.generateSimpleContours(testReports);
  
  console.log('\n=== Generated Contours ===');
  console.log('Total features:', contours.features.length);
  
  contours.features.forEach((feature: any, index: number) => {
    console.log(`\nFeature ${index}:`);
    console.log('  Description:', feature.properties.description);
    console.log('  Color:', feature.properties.color);
    console.log('  Level:', feature.properties.level);
    console.log('  Geometry type:', feature.geometry.type);
    console.log('  Coordinates:', feature.geometry.coordinates[0]?.length, 'points');
  });
  
  return contours;
}

// Run the test
if (typeof window !== 'undefined') {
  (window as any).testContourGeneration = testContourGeneration;
}