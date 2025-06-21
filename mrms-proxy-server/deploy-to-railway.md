# Railway Deployment Instructions

## Manual Steps Required:

### 1. Login to Railway
```bash
railway login
```
This will open your browser. Create an account or login.

### 2. Deploy Real-Time Server (Port 3003)
```bash
cd /Users/antoniomartinez/Desktop/d2d-sales-tracker/mrms-proxy-server

# Create new Railway project for real-time server
railway init
# When prompted, select "Empty Project"
# Name it: d2d-realtime-server

# Deploy the real-time server
railway up

# Get the deployment URL
railway domain
```

### 3. Deploy Dynamic Server (Port 3002)
We need a separate Dockerfile for the dynamic server:

```bash
# First, create a new Dockerfile for dynamic server
cp Dockerfile Dockerfile.dynamic

# Edit Dockerfile.dynamic to change the CMD line to:
# CMD ["node", "server-dynamic.js"]

# Create another Railway project
railway init
# Name it: d2d-dynamic-server

# Deploy with the dynamic Dockerfile
railway up -d Dockerfile.dynamic

# Get the deployment URL
railway domain
```

### 4. Update Your App Configuration
Once deployed, you'll get URLs like:
- Real-time: https://d2d-realtime-server.up.railway.app
- Dynamic: https://d2d-dynamic-server.up.railway.app

Update your .env file:
```
EXPO_PUBLIC_MRMS_PROXY_URL=https://d2d-dynamic-server.up.railway.app
EXPO_PUBLIC_REALTIME_SERVER_URL=https://d2d-realtime-server.up.railway.app
```

### 5. Set Environment Variables (if needed)
```bash
railway variables set PORT=3003
railway variables set NODE_ENV=production
```

## Alternative: Deploy Both in One Project
If you prefer both servers in one deployment, we can create a process manager script.