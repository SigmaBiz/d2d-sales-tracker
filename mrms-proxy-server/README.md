# MRMS Proxy Server

This proxy server processes NOAA MRMS GRIB2 data from the Iowa Environmental Mesonet archive.

## Features
- Downloads ZIP files from IEM archive
- Extracts MESH (Maximum Expected Hail Size) data
- Filters for Oklahoma region
- Converts GRIB2 to JSON format
- Provides REST API for the mobile app

## Installation

1. Install dependencies:
```bash
cd mrms-proxy-server
npm install
```

2. (Optional) Install wgrib2 for real GRIB2 processing:
- Download from: https://www.cpc.ncep.noaa.gov/products/wesley/wgrib2/
- Follow installation instructions for your OS
- Ensure `wgrib2` is in your PATH

## Running the Server

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### Health Check
```
GET http://localhost:3001/health
```

### Get MESH Data
```
GET http://localhost:3001/api/mesh/2024-09-24
```

Returns:
```json
{
  "date": "2024-09-24",
  "reports": [
    {
      "id": "mesh_1234567890_0",
      "latitude": 35.4676,
      "longitude": -97.5164,
      "size": 2.25,
      "meshValue": 57.15,
      "timestamp": "2024-09-24T20:00:00Z",
      "confidence": 92,
      "city": "Oklahoma City",
      "isMetroOKC": true,
      "source": "IEM Archive MESH"
    }
  ],
  "source": "IEM Archive MESH"
}
```

## Notes
- Without wgrib2 installed, the server returns mock data for testing
- The server tries multiple hours (18-23 UTC) to find storm data
- Data is filtered to Oklahoma bounds only
- Temporary files are cleaned up automatically

## Deployment Options

### Local Development
Run alongside your React Native app on localhost

### Heroku
```bash
heroku create your-mrms-proxy
git push heroku main
```

### Vercel
Add vercel.json:
```json
{
  "version": 2,
  "builds": [
    { "src": "server.js", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "/server.js" }
  ]
}
```

### Docker
Create Dockerfile and deploy to any container service