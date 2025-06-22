# Production 502 Issue - Comprehensive Development Log

## Context Summary
The D2D Sales Tracker's Tier 2 Historical Data system is experiencing 502 Bad Gateway errors in production on Render.com despite working perfectly locally. This violates our core mission of providing reliable hail tracking data for field canvassers.

## The Issue
- **Environment**: Render.com free tier (512MB RAM limit)
- **Symptom**: All `/api/mesh/:date` endpoints return 502 errors
- **Expected**: Should return 426+ hail reports for Sept 24, 2024
- **Actual**: Server times out and returns 502 Bad Gateway

## Root Cause Analysis

### What We Know Works ✅
1. **Health endpoint**: Returns successfully, shows ~60MB memory usage
2. **ecCodes installed**: Version 2.28.0 confirmed working
3. **AWK command**: Works fine on Linux (tested via debug endpoint)
4. **File access**: Can download GRIB2 files from IEM Archive
5. **Temp directory**: Exists and is writable
6. **Local testing**: Same code processes 426 reports in 10 seconds locally

### What Fails ❌
1. **Main endpoint**: `/api/mesh/2024-09-24` returns 502
2. **Test endpoint**: `/api/test/process/2024-09-24` also returns 502
3. **Likely culprit**: `grib_get_data` command on full GRIB2 file

### Diagnostic Results
```json
{
  "ecCodesCheck": { "status": "ok", "version": "ecCodes Version 2.28.0" },
  "awkTest": { "status": "ok", "output": "lat lon value" },
  "downloadCheck": { "status": "ok", "contentLength": "459898" },
  "tempDirCheck": { "status": "ok", "exists": true }
}
```

## Timeline of Attempts

### 1. Initial Implementation (server-dynamic.js)
- **Issue**: Exceeded 512MB memory processing 24.5M data points
- **Status**: Process killed by Render

### 2. Streaming Optimization (server-dynamic-optimized.js)
- **Approach**: Stream processing with Node.js
- **Result**: Reduced memory but still processing too much data

### 3. Line-based Pre-filtering (server-dynamic-precise.js)
- **Discovery**: OKC data is in lines 13.4M-14M
- **Local**: Works perfectly (70MB memory, 10 seconds)
- **Production**: 502 timeout errors

### 4. sed → awk Migration
- **Issue**: sed with large line numbers incompatible on Linux
- **Fix**: Changed to `awk 'NR==1 || (NR>=13400000 && NR<=14000000)'`
- **Result**: AWK works but still getting 502 errors

### 5. Geographic Filtering Fallback (server-dynamic-fallback.js)
- **Approach**: Use ecCodes native geographic filtering
- **Status**: Just deployed, testing pending

## Current Architecture

```
Client App → Render Server → IEM Archive
                ↓
          Download GRIB2.gz
                ↓
            Extract .gz
                ↓
        Process with ecCodes
                ↓
         Filter OKC data
                ↓
          Return JSON
```

## The Core Problem
The `grib_get_data` command appears to timeout when processing the full CONUS grid (24.5M points) even with pre-filtering commands. This suggests:
1. The command might load all data into memory before piping
2. Render's container has stricter resource limits than documented
3. The process takes too long and hits a timeout

## Solutions Attempted

### Solution 1: Line-based Extraction (Current)
```bash
grib_get_data file.grib2 | awk 'NR==1 || (NR>=13400000 && NR<=14000000)'
```
- **Pros**: Very efficient, works locally
- **Cons**: Still times out in production

### Solution 2: Geographic Filtering (Fallback)
```bash
# Using grib_filter with rules file
if (latitude >= 35.1 && latitude <= 35.7 && 
    longitude >= 262.2 && longitude <= 262.9) {
  print "[lat] [latitude] [lon] [longitude] [value] [parameterName]";
}
```
- **Pros**: Uses ecCodes native filtering
- **Cons**: Untested in production

### Solution 3: Chunked Processing
```javascript
// Process in 1M line chunks
for (let i = 13000000; i < 15000000; i += 1000000) {
  // Extract chunk and process
}
```
- **Pros**: Limits memory per operation
- **Cons**: Multiple operations, slower

## Next Steps for Success

### If Fallback Server Works:
1. **Verify Data Quality**
   ```bash
   curl https://d2d-dynamic-server.onrender.com/api/mesh/2024-09-24
   # Should return 400+ reports for Sept 24
   ```

2. **Test Multiple Dates**
   - 2024-09-24 (known storm, 426 reports)
   - 2025-03-29 (test date)
   - 2025-05-17 (test date)

3. **Monitor Performance**
   - Check memory usage stays under 100MB
   - Verify response times under 30 seconds
   - Ensure cache is working

4. **Update Documentation**
   - Mark this approach as production-ready
   - Document the geographic filtering method
   - Update deployment guides

### If Fallback Server Fails:

#### Option A: Upgrade Render Tier
- **Cost**: $7/month for 1GB RAM
- **Pros**: Original approach would work
- **Implementation**: Just upgrade and use server-dynamic-precise.js

#### Option B: Pre-process on External Service
1. **AWS Lambda Function**
   - Process GRIB2 files daily
   - Store results in S3
   - Render server just serves cached data

2. **GitHub Actions**
   - Daily workflow to process files
   - Commit results to repo
   - Zero infrastructure cost

#### Option C: Client-side Filtering
- Download full dataset to client
- Process in WebWorker
- Not recommended due to size

## Code Locations

### Servers
- `/mrms-proxy-server/server-dynamic-precise.js` - Line-based extraction (current)
- `/mrms-proxy-server/server-dynamic-fallback.js` - Geographic filtering (deploying)
- `/mrms-proxy-server/server-dynamic-optimized.js` - Streaming approach
- `/mrms-proxy-server/server-dynamic.js` - Original (memory issues)

### Configuration
- `/mrms-proxy-server/package.json` - Start script configuration
- `/mrms-proxy-server/Dockerfile.dynamic` - Container definition
- `/mrms-proxy-server/.env` - Environment variables

### Client Integration
- `/src/services/tier2Service.ts` - Tier 2 client service
- `/src/config/api.config.ts` - API endpoints

## Testing Commands

### Local Testing
```bash
cd mrms-proxy-server
node server-dynamic-fallback.js
# In another terminal:
curl http://localhost:3002/api/mesh/2024-09-24
```

### Production Testing
```bash
# Health check
curl https://d2d-dynamic-server.onrender.com/health

# Diagnostic endpoint
curl https://d2d-dynamic-server.onrender.com/api/test/grib2/2024-09-24

# Main endpoint
curl https://d2d-dynamic-server.onrender.com/api/mesh/2024-09-24
```

## Critical Requirements
Per our development protocol:
- **NO MOCK DATA** - Must return real NOAA data or fail explicitly
- **Field-First Design** - Must work reliably for canvassers
- **Primary Feature** - Hail tracking is core functionality

## For Future Agents

### Understanding the Problem
1. The issue is NOT with AWK or sed commands
2. The issue is NOT with ecCodes installation
3. The issue IS with processing 24.5M data points on limited resources
4. The timeout happens during `grib_get_data` execution

### What Has Been Tried
- ✅ Memory optimization
- ✅ Line-based pre-filtering
- ✅ sed → awk migration
- ✅ Diagnostic endpoints
- 🔄 Geographic filtering (in progress)

### What Hasn't Been Tried
- Using `grib_get -p` for specific parameters only
- Binary format output from ecCodes
- CDO (Climate Data Operators) as alternative
- Pre-computing daily and caching

### Key Insight
The line-based extraction (13.4M-14M) is the most efficient approach and works perfectly locally. The production issue is likely a timeout or resource limit specific to Render's container environment, not our code.

## Success Criteria
The production server must:
1. Return 426+ hail reports for Sept 24, 2024
2. Process requests in under 30 seconds
3. Use less than 512MB RAM
4. Work for any date in the last 12 months

## Current Status
- **Deployment**: Fallback server with geographic filtering is deploying
- **Next Test**: Once deployed, test if geographic filtering avoids the timeout
- **Context**: 85% - Critical production issue blocking core functionality