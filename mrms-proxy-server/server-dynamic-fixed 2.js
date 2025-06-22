/**
 * Extract MESH data for OKC Metro area only
 */
async function extractOKCMetroData(gribPath, date) {
  try {
    console.log('[DYNAMIC] Extracting OKC Metro data...');
    console.log('[DYNAMIC] Looking for data in bounds:', CONFIG.OKC_METRO_BOUNDS);
    
    // First, let's check the file exists
    const stats = await fs.stat(gribPath);
    console.log(`[DYNAMIC] Processing GRIB2 file: ${gribPath} (${stats.size} bytes)`);
    
    // Use grib_get_data to extract values
    const { stdout } = await execPromise(`grib_get_data ${gribPath}`, {
      maxBuffer: 300 * 1024 * 1024 // 300MB buffer
    });
    
    const reports = [];
    const lines = stdout.split('\n');
    let headerSkipped = false;
    let totalPoints = 0;
    let pointsInBounds = 0;
    let pointsWithHail = 0;
    
    console.log(`[DYNAMIC] Got ${lines.length} lines from grib_get_data`);
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Skip header line
      if (!headerSkipped) {
        if (trimmed.includes('Latitude') || trimmed.includes('lat')) {
          headerSkipped = true;
          console.log('[DYNAMIC] Found header, starting data processing...');
        }
        continue;
      }
      
      // Parse: latitude longitude value
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        totalPoints++;
        
        if (totalPoints % 1000000 === 0) {
          console.log(`[DYNAMIC] Processed ${totalPoints} points so far...`);
        }
        
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]) - 360; // Convert from 0-360 to -180-180
        const meshValue = parseFloat(parts[2]); // in mm
        
        // Skip invalid or zero values
        if (isNaN(lat) || isNaN(lon) || isNaN(meshValue) || meshValue <= 0) {
          continue;
        }
        
        // Check if in OKC Metro bounds
        if (lat >= CONFIG.OKC_METRO_BOUNDS.south && 
            lat <= CONFIG.OKC_METRO_BOUNDS.north &&
            lon >= CONFIG.OKC_METRO_BOUNDS.west && 
            lon <= CONFIG.OKC_METRO_BOUNDS.east) {
          
          pointsInBounds++;
          const sizeInches = meshValue / 25.4;
          
          // Only include significant hail
          if (sizeInches >= CONFIG.MIN_HAIL_SIZE) {
            pointsWithHail++;
            reports.push({
              id: `mesh_${date.getTime()}_${reports.length}`,
              latitude: lat,
              longitude: lon,
              size: Math.round(sizeInches * 100) / 100,
              timestamp: date.toISOString(),
              confidence: calculateConfidence(sizeInches),
              city: getCityName(lat, lon),
              source: 'IEM MRMS Archive',
              meshValue: meshValue
            });
          }
        }
      }
    }
    
    console.log(`[DYNAMIC] Processed ${totalPoints} total points`);
    console.log(`[DYNAMIC] Found ${pointsInBounds} points in OKC Metro bounds`);
    console.log(`[DYNAMIC] Found ${pointsWithHail} points with hail >= ${CONFIG.MIN_HAIL_SIZE}"`);
    console.log(`[DYNAMIC] Returning ${reports.length} hail reports`);
    return reports;
    
  } catch (error) {
    console.error('[DYNAMIC] Error extracting data:', error);
    console.error('[DYNAMIC] Error stack:', error.stack);
    return [];
  }
}