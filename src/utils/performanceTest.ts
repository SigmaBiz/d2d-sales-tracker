import { generateTestKnocks } from '../config/optimization';

/**
 * Performance Testing Utilities
 * Run these tests to measure optimization improvements
 */

export class PerformanceTest {
  private static startTime: number;
  private static measurements: Map<string, number[]> = new Map();

  static start(label: string) {
    this.startTime = performance.now();
    console.log(`[PerfTest] Starting: ${label}`);
  }

  static end(label: string) {
    const duration = performance.now() - this.startTime;
    console.log(`[PerfTest] ${label}: ${duration.toFixed(2)}ms`);
    
    // Store measurement
    if (!this.measurements.has(label)) {
      this.measurements.set(label, []);
    }
    this.measurements.get(label)!.push(duration);
    
    return duration;
  }

  static async measureMapLoad() {
    console.log('[PerfTest] Measuring map load time...');
    // This would be called from WebMap component
  }

  static async measureKnockRender(count: number) {
    console.log(`[PerfTest] Measuring render time for ${count} knocks...`);
    const testKnocks = generateTestKnocks(count);
    
    this.start(`Render ${count} knocks`);
    // Return test data for component to render
    return testKnocks;
  }

  static getAverages() {
    const averages: Record<string, number> = {};
    
    this.measurements.forEach((durations, label) => {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      averages[label] = avg;
    });
    
    return averages;
  }

  static printReport() {
    console.log('\n=== Performance Test Report ===');
    const averages = this.getAverages();
    
    Object.entries(averages).forEach(([label, avg]) => {
      console.log(`${label}: ${avg.toFixed(2)}ms average`);
    });
    
    console.log('==============================\n');
  }

  static reset() {
    this.measurements.clear();
  }
}

// Memory monitoring
export class MemoryMonitor {
  private static baseline: number | null = null;
  private static readings: number[] = [];

  static start() {
    if ('memory' in performance) {
      this.baseline = (performance as any).memory.usedJSHeapSize;
      console.log(`[Memory] Baseline: ${(this.baseline / 1024 / 1024).toFixed(2)}MB`);
    }
  }

  static check(label: string) {
    if ('memory' in performance && this.baseline) {
      const current = (performance as any).memory.usedJSHeapSize;
      const diff = current - this.baseline;
      const diffMB = diff / 1024 / 1024;
      
      console.log(`[Memory] ${label}: ${(current / 1024 / 1024).toFixed(2)}MB (${diffMB > 0 ? '+' : ''}${diffMB.toFixed(2)}MB)`);
      
      this.readings.push(current);
      
      // Check for memory leak
      if (this.readings.length > 10) {
        const trend = this.checkTrend();
        if (trend > 0.5) {
          console.warn('[Memory] WARNING: Possible memory leak detected!');
        }
      }
    }
  }

  private static checkTrend(): number {
    // Simple linear regression to detect upward trend
    const n = this.readings.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = this.readings.reduce((a, b) => a + b, 0);
    const sumXY = this.readings.reduce((sum, y, x) => sum + x * y, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope / 1024 / 1024; // Convert to MB
  }

  static reset() {
    this.baseline = null;
    this.readings = [];
  }
}