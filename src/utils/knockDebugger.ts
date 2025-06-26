/**
 * Knock Creation Debugger
 * Logs the entire process from map click to knock save
 */

export class KnockDebugger {
  private static logs: string[] = [];
  private static startTime: number = 0;
  
  static startSession() {
    this.logs = [];
    this.startTime = Date.now();
    this.log('🚀 DEBUG SESSION STARTED');
  }
  
  static log(message: string, data?: any) {
    const timestamp = Date.now() - this.startTime;
    const logEntry = `[${timestamp}ms] ${message}`;
    
    // Console log with color
    console.log(`%c${logEntry}`, 'color: #10b981; font-weight: bold');
    if (data) {
      console.log('📊 Data:', data);
    }
    
    // Store for later export
    this.logs.push(logEntry);
    if (data) {
      this.logs.push(`  Data: ${JSON.stringify(data, null, 2)}`);
    }
  }
  
  static error(message: string, error: any) {
    const timestamp = Date.now() - this.startTime;
    const logEntry = `[${timestamp}ms] ❌ ERROR: ${message}`;
    
    console.error(logEntry, error);
    this.logs.push(logEntry);
    this.logs.push(`  Error: ${error?.message || error}`);
  }
  
  static getLogs(): string[] {
    return [...this.logs];
  }
  
  static exportLogs(): string {
    return this.logs.join('\n');
  }
  
  static clear() {
    this.logs = [];
  }
}

// Helper to log location matching details
export function logLocationMatch(
  newLat: number, 
  newLng: number, 
  existingKnock: any, 
  distance: number, 
  threshold: number
) {
  KnockDebugger.log('📍 Location Match Check', {
    newLocation: { lat: newLat, lng: newLng },
    existingLocation: { 
      lat: existingKnock.latitude, 
      lng: existingKnock.longitude,
      address: existingKnock.address 
    },
    distance: `${distance} degrees (${(distance * 111000).toFixed(1)}m)`,
    threshold: `${threshold} degrees (${(threshold * 111000).toFixed(1)}m)`,
    willMatch: distance < threshold
  });
}