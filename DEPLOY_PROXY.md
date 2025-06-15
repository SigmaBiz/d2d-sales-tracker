# 🚀 Deploy Your FREE MRMS Proxy in 3 Minutes

## What This Gives You:
✅ **Real-time MRMS hail detection** (updates every 2-5 minutes)  
✅ **Historical data access** (back to 2019)  
✅ **Storm validation data** (ground truth from NOAA)  
✅ **No CORS issues** (proxy handles everything)  
✅ **100% FREE** (Vercel free tier is generous)

## Step-by-Step Deployment:

### 1️⃣ Open Terminal
```bash
cd /Users/antoniomartinez/Desktop/d2d-sales-tracker/mrms-proxy
```

### 2️⃣ Deploy to Vercel (FREE)
```bash
npx vercel

# You'll see prompts like:
? Set up and deploy "mrms-proxy"? [Y/n] → Y
? Which scope do you want to deploy to? → (select your account)
? Link to existing project? [y/N] → N
? What's your project's name? → mrms-proxy
? In which directory is your code located? → ./
? Want to modify these settings? [y/N] → N
```

### 3️⃣ Copy Your URL
After deployment completes, you'll see:
```
🔍 Inspect: https://vercel.com/your-username/mrms-proxy/...
✅ Production: https://mrms-proxy-abc123.vercel.app [COPY THIS URL]
```

### 4️⃣ Update Your App
Edit your `.env` file:
```bash
# Add your proxy URL
echo "EXPO_PUBLIC_MRMS_PROXY_URL=https://mrms-proxy-abc123.vercel.app" >> ../.env
```

### 5️⃣ Restart Your App
```bash
cd ..
npx expo start
```

## 🎉 That's It! You Now Have:

### Real-Time Detection (Every 2-5 min)
- Professional MRMS MESH data
- Immediate canvassing alerts
- No more fake weather data

### Historical Archive (24-48hr delay)
- Enhanced data for territory planning
- Long-term storm patterns
- Competitive intelligence

### Weekly Validation
- Accuracy improvements
- Algorithm tuning
- Ground truth comparison

## Test Your Proxy:

### Check Real-Time Data:
```
https://your-proxy.vercel.app/api/mrms?type=realtime
```

### Check Historical Data:
```
https://your-proxy.vercel.app/api/mrms?type=historical&date=2024-09-24
```

### Check Validation Data:
```
https://your-proxy.vercel.app/api/mrms?type=validation
```

## Monitor Your Data Flow:

1. Open your app
2. Go to Settings → Data Flow Monitor
3. See all three stages in action!

## Troubleshooting:

**"Command not found: vercel"**
```bash
npm install -g vercel
```

**"This project already exists"**
```bash
vercel --name mrms-proxy-v2
```

**Need to redeploy?**
```bash
vercel --prod
```

---

**Total Cost: $0/month** 🎉  
**Total Time: 3 minutes** ⏱️  
**Professional Hail Intelligence: Priceless** 💎