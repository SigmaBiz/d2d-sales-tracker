# FREE MRMS Proxy for D2D Sales Tracker

This proxy gives you professional-grade hail data for $0/month!

## What You Get:
- ✅ Real NOAA MRMS data (no fake weather APIs)
- ✅ Historical data back to 2019
- ✅ September 24, 2024 specific data
- ✅ No CORS issues
- ✅ No GRIB2 complexity
- ✅ 100% FREE hosting on Vercel

## Quick Deploy (2 minutes):

### Step 1: Install Vercel CLI
```bash
npm install -g vercel
```

### Step 2: Deploy to Vercel
```bash
# From this directory
vercel

# Answer the prompts:
# - Set up and deploy? Y
# - Which scope? (select your account)
# - Link to existing project? N
# - Project name? mrms-proxy (or any name)
# - Directory? ./ 
# - Override settings? N
```

### Step 3: Get Your URL
After deployment, you'll see:
```
🔗 Production: https://mrms-proxy-xxxxx.vercel.app
```

### Step 4: Update Your App
Add to your `.env` file:
```
EXPO_PUBLIC_MRMS_PROXY_URL=https://mrms-proxy-xxxxx.vercel.app
```

## API Endpoints:

### Real-time MRMS Data
```
GET /api/mrms?type=realtime
```

### Historical Data (any date)
```
GET /api/mrms?type=historical&date=2024-09-24
```

### September 24, 2024 Special
```
GET /api/mrms?type=sept24
```

### Storm Validation
```
GET /api/mrms?type=validation&date=2024-09-24
```

## That's it! 
Your app now has professional MRMS data for FREE!