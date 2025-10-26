# Serverless Backend Deployment Guide
**D2D Hail Tracker - Vercel Pro + Cloudflare R2**

## Overview

This document guides you through deploying the serverless backend that processes GRIB2 hail data from NOAA MRMS archives.

**Architecture:**
- **Vercel Pro** ($20/month) - Serverless functions with Docker support for eccodes
- **Cloudflare R2** ($0/month) - S3-compatible permanent cache storage
- **SPC Pre-Filtering** - Only processes dates with 2+ inch hail (96% reduction)
- **On-Demand Processing** - Process when searched, cache forever

---

## Prerequisites

1. **Vercel Pro Account** ($20/month)
   - Sign up at https://vercel.com
   - Upgrade to Pro plan (required for Docker support)

2. **Cloudflare Account** (Free)
   - Sign up at https://cloudflare.com
   - R2 storage is free for <10GB

3. **GitHub Repository**
   - This repo must be pushed to GitHub
   - Vercel will deploy automatically from GitHub

---

## Step 1: Set Up Cloudflare R2

### 1.1 Create R2 Bucket

1. Log in to Cloudflare Dashboard
2. Go to **R2 Object Storage**
3. Click **Create bucket**
4. Name: `d2d-hail-data`
5. Location: **Automatic** (closest to your users)
6. Click **Create bucket**

### 1.2 Generate API Tokens

1. In R2 dashboard, click **Manage R2 API Tokens**
2. Click **Create API token**
3. Token name: `d2d-hail-tracker-vercel`
4. Permissions:
   - **Object Read & Write**
5. TTL: **Forever**
6. Click **Create API token**
7. **SAVE THESE VALUES** (you won't see them again):
   ```
   Access Key ID: <copy this>
   Secret Access Key: <copy this>
   Endpoint: https://<account-id>.r2.cloudflarestorage.com
   ```

### 1.3 Configure CORS (Optional, for direct browser access)

1. Click on `d2d-hail-data` bucket
2. Go to **Settings** → **CORS Policy**
3. Add CORS rule:
   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

---

## Step 2: Set Up Vercel

### 2.1 Create Vercel Account

1. Go to https://vercel.com/signup
2. Sign up with GitHub
3. Authorize Vercel to access your repositories

### 2.2 Upgrade to Pro

1. Go to **Dashboard** → **Settings** → **Billing**
2. Click **Upgrade to Pro**
3. Enter payment details
4. **Why Pro?** Docker container support for eccodes (GRIB2 decoder)

### 2.3 Import Project

1. Click **Add New...** → **Project**
2. Select your **d2d-sales-tracker** repository
3. Project name: `d2d-hail-tracker`
4. Framework Preset: **Other** (we're using custom API routes)
5. Root Directory: `.` (leave default)
6. **Don't click Deploy yet!** We need to set environment variables first

### 2.4 Configure Environment Variables

In the Vercel project settings, add these environment variables:

```bash
# Cloudflare R2 (from Step 1.2)
R2_ACCESS_KEY_ID=<your_access_key_id>
R2_SECRET_ACCESS_KEY=<your_secret_access_key>
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET_NAME=d2d-hail-data

# Node.js version
NODE_VERSION=20
```

**Where to add:**
1. Project Settings → Environment Variables
2. Add each variable
3. Select **Production**, **Preview**, and **Development**
4. Click **Save**

### 2.5 Deploy

1. Click **Deploy**
2. Wait for build to complete (~3-5 minutes first time)
3. Vercel will build the Docker container with eccodes
4. Once deployed, you'll get a URL: `https://d2d-hail-tracker.vercel.app`

---

## Step 3: Verify Deployment

### 3.1 Test Health Check

```bash
curl https://d2d-hail-tracker.vercel.app/api/diagnostics
```

**Expected response:**
```json
{
  "status": "ok",
  "eccodes": {
    "status": "installed",
    "available": true
  },
  "r2Cache": {
    "configured": true,
    "status": "ready"
  }
}
```

### 3.2 Test SPC Pre-Filter

```bash
# Test with October 23, 2025 (known hail date)
curl https://d2d-hail-tracker.vercel.app/api/spc/check-date?date=2025-10-23
```

**Expected response:**
```json
{
  "date": "2025-10-23",
  "hasSignificantHail": true,
  "hasOKCMetroHail": true,
  "oklahomaReports": 15,
  "maxSize": 2.75,
  "recommendation": "PROCESS_GRIB2: Significant hail in OKC Metro area"
}
```

### 3.3 Test MESH Endpoint

```bash
# This will take 30-60 seconds on first request (downloads & processes GRIB2)
curl https://d2d-hail-tracker.vercel.app/api/mesh/2025-10-23
```

**Expected response:**
```json
{
  "date": "2025-10-23",
  "generated_at": "2025-10-26T...",
  "data_source": "NOAA MRMS 24-hour Maximum",
  "reports": [
    {
      "id": "mesh_...",
      "latitude": 35.4676,
      "longitude": -97.5164,
      "size": 2.25,
      "city": "Oklahoma City",
      "confidence": 95
    },
    // ... more reports
  ],
  "summary": {
    "totalReports": 748,
    "maxSize": 2.75,
    "avgSize": 1.42
  },
  "responseTime": "45000ms",
  "cached": false
}
```

### 3.4 Verify R2 Caching

Request the same date again:

```bash
curl https://d2d-hail-tracker.vercel.app/api/mesh/2025-10-23
```

**Expected response:**
- Same data
- `"cached": true`
- `"responseTime": "85ms"` (much faster!)

---

## Step 4: Update iOS App

### 4.1 Update Environment Variable

Edit `/Users/antoniomartinez/Desktop/d2d-sales-tracker/.env.local`:

```bash
# OLD:
EXPO_PUBLIC_MRMS_PROXY_URL=https://d2d-dynamic-server.onrender.com

# NEW:
EXPO_PUBLIC_MRMS_PROXY_URL=https://d2d-hail-tracker.vercel.app
```

### 4.2 Remove Mock Data Fallbacks

Edit `src/services/iemArchiveService.ts`:

**Lines 76-82:** Change mock data fallback to explicit error:

```typescript
// BEFORE:
if (!response.ok) {
  console.log('[IEM Archive] Proxy error:', response.status);
  // Fall back to mock data
  return this.getMockHistoricalData(date);
}

// AFTER:
if (!response.ok) {
  console.log('[IEM Archive] Proxy error:', response.status);
  // Return empty array explicitly (no mock data)
  return [];
}
```

**Delete lines 106-292:** Remove `getMockHistoricalData()` function entirely

### 4.3 Test on iOS Device

1. Restart Expo: `npx expo start --clear`
2. Open app on iOS device
3. Search for **October 23, 2025**
4. Verify real hail swath maps appear
5. Check console logs show real MESH values (not mock)

---

## Step 5: Monitor & Optimize

### 5.1 Vercel Dashboard

Monitor your serverless functions:

1. Go to **Vercel Dashboard** → **Your Project**
2. Click **Functions** tab
3. See:
   - Function execution time
   - Memory usage
   - Error rates
   - Request volume

### 5.2 Cloudflare R2 Dashboard

Monitor cache storage:

1. Go to **Cloudflare Dashboard** → **R2**
2. Click `d2d-hail-data` bucket
3. See:
   - Total objects (number of cached dates)
   - Storage used (should be <1GB for 15-20 dates)
   - Request count

### 5.3 Cost Tracking

**Expected Monthly Costs:**
- Vercel Pro: **$20/month**
- Cloudflare R2: **$0/month** (well under 10GB free tier)
- **Total: $20/month**

**Compared to old Render backend:**
- Render: $7-29/month + data went stale + silent failures
- **Serverless wins:** Same cost, always fresh data, explicit errors

---

## Troubleshooting

### Problem: "eccodes not installed" in diagnostics

**Solution:**
1. Ensure you're on **Vercel Pro** plan (Docker support required)
2. Check `api/Dockerfile` exists
3. Redeploy: Settings → Deployments → Click latest → Redeploy

### Problem: "R2 not configured" in diagnostics

**Solution:**
1. Check environment variables in Vercel settings
2. Ensure all 4 R2 variables are set:
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_ENDPOINT`
   - `R2_BUCKET_NAME`
3. Redeploy after adding variables

### Problem: GRIB2 processing times out (>60 seconds)

**Solution:**
1. Check Vercel function timeout in `vercel.json`
2. Increase to 300 seconds (5 minutes) for MESH endpoint:
   ```json
   "functions": {
     "api/mesh/[date].ts": {
       "maxDuration": 300
     }
   }
   ```
3. Note: Vercel Pro allows up to 300 seconds, Hobby only 60 seconds

### Problem: SPC pre-filter returns 404

**Solution:**
- SPC data may not be available for very recent dates (<24 hours)
- System will fall back to GRIB2 processing automatically
- This is expected behavior

### Problem: Empty hail reports for known storm date

**Solution:**
1. Check if date has SPC data: `/api/spc/check-date?date=YYYY-MM-DD`
2. Check Vercel logs for eccodes errors
3. Verify IEM Archive has data for that date:
   ```
   https://mtarchive.geol.iastate.edu/YYYY/MM/DD/mrms/ncep/MESH_Max_1440min/
   ```

---

## API Endpoints Reference

### Health Check
```
GET /api/diagnostics
```
Returns system status, eccodes availability, R2 configuration

### SPC Pre-Filter
```
GET /api/spc/check-date?date=YYYY-MM-DD
```
Checks if date has 2+ inch hail in Oklahoma

### MESH Hail Data
```
GET /api/mesh/YYYY-MM-DD
```
Returns processed hail swath data for a specific date

**Example:**
```bash
curl https://d2d-hail-tracker.vercel.app/api/mesh/2025-05-17
```

---

## Success Criteria Checklist

- [ ] Vercel Pro account created and project deployed
- [ ] Cloudflare R2 bucket created with API tokens
- [ ] Environment variables configured in Vercel
- [ ] `/api/diagnostics` shows eccodes installed
- [ ] `/api/diagnostics` shows R2 configured
- [ ] SPC pre-filter returns data for known storm dates
- [ ] MESH endpoint returns real hail data (not empty)
- [ ] Second request for same date cached (<100ms response)
- [ ] iOS app `.env.local` updated with Vercel URL
- [ ] Mock data fallbacks removed from `iemArchiveService.ts`
- [ ] October 23, 2025 displays real hail swaths on iOS
- [ ] Console logs show real MESH values (not mock data)

---

## Next Steps After Deployment

1. **Monitor first 48 hours**
   - Check Vercel function logs for errors
   - Monitor R2 storage usage
   - Test multiple storm dates on iOS

2. **Optimize if needed**
   - If GRIB2 processing is slow, consider caching more dates
   - If R2 costs increase, review storage policies
   - If function timeouts occur, increase maxDuration

3. **Document known storm dates**
   - As you search for dates, they get cached
   - Keep a list of significant storm dates for testing
   - Share with team so everyone uses same cached data

4. **Merge to production**
   - After testing successfully, merge feature branch to main
   - Vercel auto-deploys from main branch
   - Update production environment variables if different

---

## Support & Debugging

**Vercel Logs:**
```bash
# Install Vercel CLI
npm install -g vercel

# View logs
vercel logs
```

**R2 CLI (optional):**
```bash
# Install Wrangler (Cloudflare CLI)
npm install -g wrangler

# List bucket contents
wrangler r2 object list d2d-hail-data
```

**Test locally (without deployment):**
```bash
cd api
npm install
npm run dev  # Runs local Vercel dev server
```

---

## Cost Optimization Tips

1. **Monitor R2 storage**
   - After 1 year, you'll have ~15-20 cached dates
   - Estimate: 50KB per date = ~1MB total
   - Well under 10GB free tier

2. **Monitor Vercel function executions**
   - SPC pre-filter prevents ~350 GRIB2 processes/year
   - Each search hits cache after first request
   - Should stay well under Pro limits

3. **Consider cleanup policy**
   - After 2-3 years, delete dates >12 months old
   - Historical data older than 12 months rarely queried

---

## Architecture Benefits

**Before (Render backend):**
- ❌ Data went stale (last update: June 22, 2025)
- ❌ Silent failures (empty reports)
- ❌ Pre-processes all 365 days
- ❌ $7-29/month + maintenance

**After (Vercel + R2):**
- ✅ Always fresh data (on-demand processing)
- ✅ Explicit errors (no silent failures)
- ✅ Only process ~15 significant storm dates/year
- ✅ $20/month, zero maintenance
- ✅ Permanent cache (R2) - instant second lookups
- ✅ SPC pre-filtering (96% reduction in GRIB2 processing)

---

**Questions or issues?** Check Vercel logs first, then Cloudflare R2 dashboard.
