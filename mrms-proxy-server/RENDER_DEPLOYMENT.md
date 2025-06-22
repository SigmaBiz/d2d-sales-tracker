# Render Deployment Instructions

## Deploying the Optimized MRMS Server

### What's New
We're deploying `server-dynamic-precise.js` which features:
- **Pre-filtered extraction**: Only processes 600k lines instead of 24.5M
- **Memory efficient**: Uses only 70-79MB (well under 512MB limit)
- **5x faster**: ~10 seconds vs ~50 seconds processing time
- **Production ready**: Tested with multiple dates, handles both hail and no-hail scenarios

### Deployment Steps

1. **Commit and Push Changes**
```bash
git add -A
git commit -m "Deploy optimized server with pre-filtering"
git push origin feature/grib2-processing
```

2. **Merge to Main Branch** (if using branch)
```bash
git checkout main
git merge feature/grib2-processing
git push origin main
```

3. **Render Auto-Deploy**
- Render will automatically detect the push to main
- The new server will start using the updated `package.json` start script
- Monitor the deployment in Render dashboard

### Environment Variables
Ensure these are set in Render:
- `PORT` - Will be set automatically by Render
- No other environment variables required

### Post-Deployment Verification

1. **Check Health Endpoint**
```bash
curl https://mrms-proxy-server.onrender.com/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "mrms-dynamic-server-precise",
  "memory": {
    "used": "XX MB",
    "total": "XX MB",
    "rss": "XX MB"
  },
  "optimization": "Pre-filtered extraction (lines 13400000-14000000)"
}
```

2. **Test Data Endpoint**
```bash
# Test with a known hail date
curl https://mrms-proxy-server.onrender.com/api/mesh/2024-09-24

# Test with a no-hail date
curl https://mrms-proxy-server.onrender.com/api/mesh/2025-03-29
```

3. **Monitor Logs**
- Check Render dashboard for logs
- Look for "[PRECISE]" prefixed messages
- Verify memory usage stays under 100MB

### Rollback Plan
If issues arise, you can quickly rollback:

1. Update `package.json` to use previous server:
```json
"start": "node server-dynamic-optimized.js"
```

2. Push the change to trigger redeployment

### Performance Expectations
- First request: ~30-40 seconds (includes download)
- Cached requests: <1 second
- Memory usage: 70-79MB peak
- Processing: ~10 seconds for non-cached dates