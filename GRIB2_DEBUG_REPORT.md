# GRIB2 Processing Debug Report

## Executive Summary

The d2d-sales-tracker MRMS proxy server was designed to process NOAA MRMS GRIB2 files from Iowa Environmental Mesonet (IEM). The implementation encountered significant system-level challenges that require architectural changes.

## System-Level Issues Identified

### 1. Data Source Architecture

**Issue**: IEM archives contain complete MRMS data (all products) in massive ZIP files
- File sizes: 5.7GB per hour
- Contains hundreds of products when we only need MESH
- Download time: 10+ minutes per file
- Storage requirements: Prohibitive for mobile/cloud deployment

**Root Cause**: IEM doesn't provide product-specific endpoints for historical data

### 2. GRIB2 Processing Dependencies

**Issue**: GRIB2 is a binary meteorological format requiring specialized tools
- `wgrib2` is the standard tool but requires system installation
- No reliable pure JavaScript GRIB2 parsers available
- Binary dependencies incompatible with serverless deployment

**Solution Attempted**: 
- Tried `grib2json` npm package - requires Java runtime
- Tried `grib` npm package - outdated and unmaintained
- Pure JS parsing would require implementing complex binary format specs

### 3. Real-time vs Historical Data

**Discovery**: NCEP provides small, product-specific GRIB2 files for real-time data
- URL: `https://mrms.ncep.noaa.gov/data/2D/MESH/`
- File sizes: 40-80KB (compressed)
- Update frequency: Every 2 minutes
- Retention: Only last 7 days

**Limitation**: Historical data only available through IEM's massive archives

## Deployment Constraints Analysis

### Local Development
- ✅ Can install wgrib2
- ❌ 5.7GB downloads impractical
- ❌ Processing time too long for API responses

### Cloud Hosting (Vercel/Heroku)
- ❌ No binary dependencies (wgrib2)
- ❌ Function timeout limits (10-30 seconds)
- ❌ Memory limits for large files
- ❌ Bandwidth costs for GB downloads

### Dedicated Server
- ✅ Can install wgrib2
- ✅ Can cache processed data
- ❌ High bandwidth costs
- ❌ Complex infrastructure management

## Recommended Solutions

### 1. Hybrid Approach (Implemented in server-v2.js)
- Use NCEP for real-time data (last 7 days)
- Pre-process and cache historical storm data
- Provide curated dataset for known significant events
- Avoid GRIB2 processing entirely in production

### 2. Alternative Data Sources
- **SPC Storm Reports**: CSV format, verified hail reports
- **NWS API**: JSON format, historical severe weather data
- **Pre-processed datasets**: Academic or commercial providers

### 3. Architecture Recommendations

#### For Production Deployment:
```javascript
// Recommended data flow
1. Real-time (< 7 days): NCEP API → JSON transformation → Client
2. Historical: Pre-processed database → API → Client
3. Batch processing: Separate offline system → Database updates
```

#### For GRIB2 Processing (if required):
```bash
# Server-side batch processor (separate from API)
1. Download GRIB2 files during off-peak hours
2. Process with wgrib2 to extract MESH
3. Store processed data in database
4. Serve via simple JSON API
```

## Implementation Status

### Working:
- ✅ Mock data for known storm dates
- ✅ API structure and endpoints
- ✅ Client integration
- ✅ Alternative approach without GRIB2 (server-v2.js)

### Not Working:
- ❌ Direct GRIB2 processing in Node.js
- ❌ Real-time IEM archive processing
- ❌ Automated historical data ingestion

### Recommended Next Steps:

1. **Immediate**: Use server-v2.js for MVP
   - Provides historical data for demonstration
   - Avoids GRIB2 complexity
   - Works on any deployment platform

2. **Short-term**: Implement SPC data integration
   - Reliable CSV format
   - Verified storm reports
   - No binary dependencies

3. **Long-term**: Build dedicated data pipeline
   - Separate batch processing system
   - Pre-process GRIB2 files offline
   - Serve processed data via API

## Technical Details

### GRIB2 Format Complexity
- Binary format with multiple compression schemes
- Requires coordinate system transformations
- Complex metadata headers
- Grid-to-point interpolation needed

### IEM Archive Structure
```
https://mrms.agron.iastate.edu/YYYY/MM/DD/YYYYMMDDHH.zip
├── Multiple products (100+)
├── Each product ~50MB uncompressed
├── MESH files: ~10-20MB each
└── Total size: 5.7GB compressed
```

### NCEP Real-time Structure
```
https://mrms.ncep.noaa.gov/data/2D/MESH/
├── Individual GRIB2 files
├── 40-80KB compressed
├── 2-minute updates
└── 7-day retention
```

## Conclusion

The primary issue is not code-related but architectural. The data sources available (massive archives vs tiny real-time files) don't align with the application's needs (historical API queries). The recommended solution avoids these system-level constraints by using pre-processed data and alternative sources.

For production deployment, use the simplified server-v2.js approach that provides the required functionality without the complexity of GRIB2 processing or large file downloads.