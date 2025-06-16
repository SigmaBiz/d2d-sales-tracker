# MRMS Proxy Server Deployment Guide

## Overview

The MRMS Proxy Server V2 provides historical and real-time hail data without the complexity of GRIB2 processing. It's designed to work on any deployment platform without binary dependencies.

## Quick Start

### Local Development
```bash
cd mrms-proxy-server
npm install
node server-v2.js
```

### Testing
```bash
# Health check
curl http://localhost:3001/health

# Get historical data
curl http://localhost:3001/api/mesh/2024-09-24

# Get available dates
curl http://localhost:3001/api/mesh/available-dates
```

## Deployment Options

### 1. Vercel (Recommended for Free Hosting)

Create `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "server-v2.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "server-v2.js"
    }
  ]
}
```

Deploy:
```bash
npm i -g vercel
vercel
```

### 2. Heroku

Create `Procfile`:
```
web: node server-v2.js
```

Deploy:
```bash
heroku create your-app-name
git push heroku main
```

### 3. Railway/Render

Simply connect your GitHub repo and deploy. These platforms auto-detect Node.js apps.

## Environment Variables

```bash
# Optional - defaults to 3001
PORT=3001

# For client configuration
EXPO_PUBLIC_MRMS_PROXY_URL=https://your-deployed-url.vercel.app
```

## API Endpoints

### Get MESH Data
```
GET /api/mesh/:date
```

Example Response:
```json
{
  "date": "2024-09-24",
  "reports": [
    {
      "id": "hist_mesh_001",
      "latitude": 35.4676,
      "longitude": -97.5164,
      "size": 2.25,
      "meshValue": 57.15,
      "timestamp": "2024-09-24T20:30:00.000Z",
      "confidence": 92,
      "city": "Oklahoma City",
      "isMetroOKC": true,
      "source": "Historical MESH Data"
    }
  ],
  "source": "Historical MESH Data"
}
```

### Get Available Dates
```
GET /api/mesh/available-dates
```

### Batch Request
```
POST /api/mesh/batch
Body: { "dates": ["2024-09-24", "2024-05-15"] }
```

## Adding More Historical Data

Edit `getHistoricalMESHData()` function in server-v2.js:

```javascript
const historicalData = {
  '2024-10-15': [  // New date
    {
      id: 'hist_mesh_new',
      latitude: 35.4676,
      longitude: -97.5164,
      size: 1.5,  // Hail size in inches
      meshValue: 38.1,  // Size in mm
      timestamp: new Date('2024-10-15T20:00:00Z'),
      confidence: 85,
      city: 'Oklahoma City',
      isMetroOKC: true,
      source: 'Historical MESH Data'
    }
  ]
};
```

## Data Sources

1. **Historical Data**: Pre-configured storm events
2. **Real-time Data**: SPC storm reports (when available)
3. **Future Enhancement**: Connect to weather APIs or databases

## Advantages of V2 Approach

- ✅ No binary dependencies (works everywhere)
- ✅ Fast response times (no large downloads)
- ✅ Predictable data structure
- ✅ Works with serverless platforms
- ✅ Low bandwidth usage
- ✅ Easy to maintain and extend

## Monitoring

Check server health:
```bash
curl https://your-deployed-url/health
```

## Troubleshooting

### Empty responses
- Check date format (YYYY-MM-DD)
- Verify date is in available dates list
- Check server logs for errors

### Deployment issues
- Ensure PORT uses process.env.PORT
- Check platform-specific build logs
- Verify all dependencies are in package.json

## Future Enhancements

1. Connect to real weather APIs
2. Add database for dynamic data
3. Implement caching layer
4. Add more historical events
5. Support for other regions beyond Oklahoma