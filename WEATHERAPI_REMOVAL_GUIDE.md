# WeatherAPI Removal Guide

## Overview
This guide explains how to remove WeatherAPI dependency and rely solely on NOAA MRMS and IEM Archives for hail data.

## Why Remove WeatherAPI?

| Aspect | WeatherAPI | NOAA MRMS |
|--------|------------|-----------|
| **Data Quality** | Consumer-grade | Scientific-grade |
| **Coverage** | Major cities only | Complete coverage |
| **Update Frequency** | Irregular | Every 2-5 minutes |
| **Hail Detection** | Basic alerts | Precise MESH values |
| **Cost** | $65/month | FREE forever |
| **Reliability** | Third-party dependency | Government maintained |

## Prerequisites

Before removing WeatherAPI, ensure:

1. ✅ **CORS Proxy Deployed**
   - Your MRMS proxy is deployed and accessible
   - Test URL: `https://your-proxy.vercel.app/api/mrms?type=realtime`
   - Should return JSON, not HTML

2. ✅ **IEM Access Working**
   - Proxy handles IEM archive requests
   - Historical data loads successfully

3. ✅ **Fallback Strategy**
   - TIER 1: NCEP MRMS (real-time)
   - TIER 2: IEM Archives (recent history)
   - TIER 3: Mock data (dev only)

## Step-by-Step Removal

### 1. Update Environment Variables

```bash
# Remove from .env
- EXPO_PUBLIC_WEATHER_API_KEY=your_key_here

# Keep only
EXPO_PUBLIC_MRMS_PROXY_URL=https://your-proxy.vercel.app
```

### 2. Replace MRMS Service

```bash
# Backup current service
cp src/services/mrmsService.ts src/services/mrmsService.backup.ts

# Replace with new version
mv src/services/mrmsServiceNoWeatherAPI.ts src/services/mrmsService.ts
```

### 3. Remove WeatherAPI Files

```bash
# Delete WeatherAPI service
rm src/services/weatherApiService.ts

# Delete test utility
rm src/utils/testWeatherApi.ts
```

### 4. Update Data Source Indicator

In `src/screens/RealMapScreen.tsx`, update the data source logic:

```typescript
// OLD
const getDataSourceInfo = () => {
  if (dataSource === 'Mock') {
    return { text: 'Mock Data', color: '#f59e0b' };
  } else if (dataSource === 'MRMS') {
    return { text: 'MRMS Data', color: '#10b981' };
  } else {
    return { text: 'Live Data', color: '#10b981' };
  }
};

// NEW
const getDataSourceInfo = () => {
  switch (dataSource) {
    case 'MRMS':
      return { text: 'NOAA MRMS', color: '#10b981' };
    case 'IEM':
      return { text: 'IEM Archive', color: '#3b82f6' };
    case 'Mock':
      return { text: 'Mock Data', color: '#f59e0b' };
    default:
      return { text: 'Checking...', color: '#6b7280' };
  }
};
```

### 5. Clean Up Imports

Search and remove all WeatherAPI imports:

```bash
# Find all files importing WeatherAPI
grep -r "weatherApiService" src/

# Remove imports from:
# - src/services/mrmsService.ts (already done in new version)
# - Any other files that import it
```

### 6. Update Documentation

Remove WeatherAPI references from:
- README.md
- DEVELOPMENT_LOG.md
- .env.example
- Any setup guides

## Testing After Removal

### 1. Verify Real-Time Data
```javascript
// Test TIER 1
const reports = await NCEPMRMSService.checkForNewStorms();
console.log('NCEP Reports:', reports.length);
```

### 2. Verify Historical Data
```javascript
// Test TIER 2
const historical = await IEMArchiveService.fetchHistoricalStorm(new Date('2024-09-24'));
console.log('IEM Reports:', historical.length);
```

### 3. Check Data Flow
- Open app
- Go to Settings → Data Flow Monitor
- Trigger "Run Now" for each tier
- Verify no WeatherAPI calls in console

### 4. Monitor Logs
Look for these success indicators:
- `[MRMS] Found X reports from NCEP MRMS`
- `[MRMS] Found X reports from IEM`
- NO logs mentioning "WeatherAPI"

## Rollback Plan

If issues occur, rollback by:

1. Restore backup:
```bash
mv src/services/mrmsService.backup.ts src/services/mrmsService.ts
```

2. Re-add WeatherAPI key to .env

3. Restart Expo:
```bash
npx expo start --clear
```

## Benefits After Removal

1. **Better Data Quality**
   - Scientific-grade MESH values
   - Precise hail size measurements
   - Complete geographic coverage

2. **Faster Updates**
   - 2-minute intervals vs irregular
   - No API rate limits
   - Direct government data

3. **Cost Savings**
   - $0/month vs $65/month
   - No usage limits
   - No billing surprises

4. **Improved Reliability**
   - No third-party dependencies
   - Government infrastructure
   - Multiple fallback sources

## Next Steps

After successful removal:

1. **Optimize Proxy**
   - Add caching for repeated requests
   - Implement request batching
   - Add monitoring/logging

2. **Enhance Data Processing**
   - Implement GRIB2 parsing on server
   - Add data compression
   - Create data pipelines

3. **Add Advanced Features**
   - Storm tracking algorithms
   - Predictive modeling
   - Historical analysis tools

## Support

If you encounter issues:
1. Check proxy logs on Vercel
2. Verify CORS headers are correct
3. Test endpoints with curl/Postman
4. Review browser console for errors