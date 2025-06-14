# Supabase Setup Guide for D2D Sales Tracker

## Quick Setup (5 minutes)

### 1. Create a Free Supabase Account
1. Go to [supabase.com](https://supabase.com)
2. Click "Start your project"
3. Sign up with GitHub or email
4. Create a new project:
   - Project name: `d2d-sales-tracker`
   - Database password: (save this!)
   - Region: Choose closest to you

### 2. Get Your Project Credentials
Once your project is ready (2-3 minutes):
1. Go to Settings → API
2. Copy these values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **Anon/Public Key**: `eyJhbGc...` (long string)

### 3. Create Database Tables
Go to SQL Editor and run this:

```sql
-- Create knocks table
CREATE TABLE knocks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  local_id TEXT NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  address TEXT,
  outcome TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, local_id)
);

-- Create daily_stats table
CREATE TABLE daily_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  knocks INTEGER DEFAULT 0,
  contacts INTEGER DEFAULT 0,
  leads INTEGER DEFAULT 0,
  sales INTEGER DEFAULT 0,
  revenue DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Enable Row Level Security
ALTER TABLE knocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;

-- Create policies so users can only see their own data
CREATE POLICY "Users can view own knocks" ON knocks
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own stats" ON daily_stats
  FOR ALL USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX idx_knocks_user_id ON knocks(user_id);
CREATE INDEX idx_knocks_created_at ON knocks(created_at);
CREATE INDEX idx_daily_stats_user_date ON daily_stats(user_id, date);

-- Function to calculate storage usage
CREATE OR REPLACE FUNCTION get_user_storage_usage(user_id UUID)
RETURNS TABLE(total_bytes BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pg_column_size(knocks.*) AS total_bytes
  FROM knocks
  WHERE knocks.user_id = get_user_storage_usage.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 4. Update Your App

1. Open `/src/services/supabaseClient.ts`
2. Replace the placeholder values:
```typescript
const supabaseUrl = 'https://YOUR-PROJECT.supabase.co';
const supabaseAnonKey = 'YOUR-ANON-KEY';
```

### 5. Enable Anonymous Auth (Optional but Recommended)
1. Go to Authentication → Providers
2. Enable "Anonymous Sign-ins"
3. This allows users to start immediately without creating accounts

## That's It! 🎉

Your app now has:
- ✅ Automatic cloud backup
- ✅ Real-time sync across devices
- ✅ 500MB free storage (~1.8M knocks)
- ✅ Offline-first functionality
- ✅ Usage monitoring

## Testing Your Setup

1. Record a knock in the app
2. Go to Supabase dashboard → Table Editor → knocks
3. You should see your knock appear!

## Monitoring Usage

In your app's Settings screen, you'll see:
- Storage used (MB)
- Number of knocks stored
- Days until storage full

## Troubleshooting

**"Supabase not configured"**
- Make sure you updated the URL and key in supabaseClient.ts

**No data syncing**
- Check internet connection
- Verify your project is active in Supabase dashboard

**Permission denied errors**
- Make sure you ran all the SQL commands
- Check that Row Level Security policies are created