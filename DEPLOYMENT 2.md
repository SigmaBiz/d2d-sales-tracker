# D2D Sales Tracker Deployment Guide

## Overview
This guide covers deploying the 3-tier hail intelligence system to production.

## Architecture
- **Tier 1**: Real-time server (Railway/Docker) - Port 3003
- **Tier 2**: Historical server (Vercel) - Port 3002
- **Tier 3**: Ground truth validation (client-side)
- **Mobile App**: Expo EAS Build

## Prerequisites
- Docker installed locally
- Railway account (or AWS/GCP for containers)
- Vercel account
- Expo account
- Apple Developer account (for iOS)

## 1. Deploy Real-Time Server (Tier 1)

### Option A: Railway Deployment (Recommended)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Navigate to server directory
cd mrms-proxy-server

# Initialize Railway project
railway init

# Deploy
railway up
```

### Option B: Docker Deployment
```bash
# Build Docker image
cd mrms-proxy-server
docker build -t d2d-realtime-server .

# Test locally
docker run -p 3003:3003 d2d-realtime-server

# Push to registry (e.g., Docker Hub)
docker tag d2d-realtime-server yourusername/d2d-realtime-server
docker push yourusername/d2d-realtime-server
```

### Option C: AWS ECS Deployment
1. Build and push image to ECR
2. Create ECS task definition
3. Deploy to ECS Fargate
4. Configure ALB for HTTPS

## 2. Deploy Historical Server (Tier 2)

### Vercel Deployment
```bash
# Already deployed to: https://mrms-proxy-server-nine.vercel.app
# To update:
cd mrms-proxy-server
vercel --prod
```

## 3. Update Production URLs

### Environment Variables
Create `.env.production` in root directory:
```env
EXPO_PUBLIC_REALTIME_SERVER=https://your-railway-app.railway.app
EXPO_PUBLIC_HISTORICAL_SERVER=https://mrms-proxy-server-nine.vercel.app
EXPO_PUBLIC_PROXY_SERVER=https://mrms-proxy-server-nine.vercel.app
```

### Update API Config
The `src/config/api.config.ts` file will automatically use these environment variables.

## 4. Deploy Mobile App

### iOS Deployment
```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Configure build
eas build:configure

# Build for iOS
eas build --platform ios

# Submit to App Store
eas submit --platform ios
```

### Android Deployment
```bash
# Build for Android
eas build --platform android

# Submit to Play Store
eas submit --platform android
```

## 5. Post-Deployment Testing

### Test Real-Time Server
```bash
# Health check
curl https://your-railway-app.railway.app/health

# Test storm simulation
curl -X POST https://your-railway-app.railway.app/api/test/simulate-storm

# Check current storms
curl https://your-railway-app.railway.app/api/storms/current
```

### Test Historical Server
```bash
# Get Sept 24 storm data
curl https://mrms-proxy-server-nine.vercel.app/api/mesh/2024-09-24
```

### Test Mobile App
1. Install production build on device
2. Open Hail Intelligence Dashboard
3. Tap "Test Hail Alerts" button
4. Verify push notification received

## 6. Monitoring

### Railway Monitoring
- View logs: `railway logs`
- View metrics: Railway dashboard
- Set up alerts for downtime

### Vercel Monitoring
- View function logs in Vercel dashboard
- Monitor usage and limits
- Set up error notifications

### Mobile App Monitoring
- Expo dashboard for crash reports
- Push notification delivery metrics
- User engagement analytics

## 7. Troubleshooting

### Real-Time Server Issues
- Check ecCodes installation: `docker exec <container> which grib_get_data`
- Verify GRIB2 downloads: Check `/app/realtime_temp` directory
- Review logs: `docker logs <container>`

### Historical Server Issues
- Check Vercel function logs
- Verify CORS headers
- Monitor rate limits

### Push Notification Issues
- Verify Expo push tokens
- Check notification permissions
- Review delivery reports in Expo dashboard

## 8. Scaling Considerations

### Real-Time Server
- Add Redis for caching
- Implement queue for storm processing
- Use container auto-scaling

### Historical Server
- Implement CDN for cached responses
- Use edge functions for global distribution
- Add database for persistent storage

### Mobile App
- Implement offline queue for knocks
- Add background sync
- Optimize map rendering for large datasets

## 9. Security Checklist

- [ ] HTTPS enabled on all endpoints
- [ ] API rate limiting configured
- [ ] Environment variables secured
- [ ] CORS properly configured
- [ ] No sensitive data in logs
- [ ] Push tokens encrypted
- [ ] Database access restricted

## 10. Backup & Recovery

### Data Backup
- Storm history: Daily exports to S3
- User data: Supabase automatic backups
- Configuration: Git repository

### Disaster Recovery
- Multi-region deployment ready
- Database replication configured
- Automated failover scripts

## Support

For deployment issues:
- Railway: support@railway.app
- Vercel: support@vercel.com
- Expo: forums.expo.dev

For application issues:
- GitHub Issues: https://github.com/SigmaBiz/d2d-sales-tracker/issues