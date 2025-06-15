/**
 * Weather Data Proxy Server
 * Runs on Vercel Edge Functions or Cloudflare Workers
 * Handles CORS and transforms NOAA data for mobile consumption
 */

// For Vercel Edge Runtime
export const config = {
  runtime: 'edge',
};

// Cache configuration
const CACHE_TTL = 5 * 60; // 5 minutes in seconds
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Client-Version',
  'Cache-Control': 'public, max-age=60'
};

export default async function handler(request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  try {
    // Route handlers
    if (path === '/api/weather/hail/current') {
      return await handleCurrentHail(request);
    } else if (path.startsWith('/api/weather/hail/historical/')) {
      return await handleHistoricalHail(request, path);
    } else if (path === '/api/weather/health') {
      return handleHealth();
    } else {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function handleCurrentHail(request) {
  // Try to get from cache first
  const cacheKey = 'hail:current';
  const cached = await getFromCache(cacheKey);
  
  if (cached) {
    return new Response(JSON.stringify({
      success: true,
      data: cached,
      source: 'cache',
      timestamp: Date.now()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Fetch fresh data
  let data = null;
  let source = 'noaa';

  try {
    // Try NOAA first
    data = await fetchNOAAData();
  } catch (noaaError) {
    console.error('NOAA fetch failed:', noaaError);
    
    // Fall back to WeatherAPI
    if (WEATHER_API_KEY) {
      try {
        data = await fetchWeatherAPIData();
        source = 'weatherapi';
      } catch (weatherError) {
        console.error('WeatherAPI fetch failed:', weatherError);
        throw new Error('All data sources failed');
      }
    }
  }

  // Cache the data
  if (data) {
    await setCache(cacheKey, data, CACHE_TTL);
  }

  return new Response(JSON.stringify({
    success: true,
    data: data,
    source: source,
    timestamp: Date.now()
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function fetchNOAAData() {
  // Fetch from multiple NOAA endpoints
  const endpoints = [
    'https://mrms.ncep.noaa.gov/data/realtime/MESH_Max_60min.latest.json',
    'https://api.weather.gov/alerts/active?area=OK'
  ];

  const reports = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          'User-Agent': 'D2D-Sales-Tracker/1.0'
        }
      });

      if (response.ok) {
        const data = await response.json();
        const parsed = parseNOAAData(data, endpoint);
        reports.push(...parsed);
      }
    } catch (error) {
      console.error(`Failed to fetch ${endpoint}:`, error);
    }
  }

  return { reports };
}

async function fetchWeatherAPIData() {
  const locations = [
    { lat: 35.4676, lon: -97.5164, name: 'Oklahoma City' },
    { lat: 35.2226, lon: -97.4395, name: 'Norman' },
    { lat: 36.1540, lon: -95.9928, name: 'Tulsa' }
  ];

  const reports = [];

  for (const loc of locations) {
    const url = `https://api.weatherapi.com/v1/alerts.json?key=${WEATHER_API_KEY}&q=${loc.lat},${loc.lon}`;
    
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        const parsed = parseWeatherAPIAlerts(data, loc);
        reports.push(...parsed);
      }
    } catch (error) {
      console.error(`Failed to fetch WeatherAPI for ${loc.name}:`, error);
    }
  }

  return { reports };
}

function parseNOAAData(data, endpoint) {
  const reports = [];
  
  if (endpoint.includes('alerts')) {
    // Parse NWS alerts
    if (data.features) {
      data.features.forEach(feature => {
        const props = feature.properties;
        if (props.event && props.event.toLowerCase().includes('hail')) {
          // Extract coordinates from affected zones
          // This is simplified - in production would need zone-to-coordinate mapping
          reports.push({
            id: props.id,
            latitude: 35.4676, // Default to OKC
            longitude: -97.5164,
            size: 1.0, // Default size
            timestamp: props.effective,
            confidence: 80,
            city: 'Oklahoma',
            isMetroOKC: true
          });
        }
      });
    }
  }
  
  return reports;
}

function parseWeatherAPIAlerts(data, location) {
  const reports = [];
  
  if (data.alerts && data.alerts.alert) {
    const alerts = Array.isArray(data.alerts.alert) ? data.alerts.alert : [data.alerts.alert];
    
    alerts.forEach(alert => {
      if (alert.event.toLowerCase().includes('hail') || 
          alert.desc.toLowerCase().includes('hail')) {
        reports.push({
          id: `alert_${Date.now()}_${location.lat}`,
          latitude: location.lat,
          longitude: location.lon,
          size: 1.0,
          timestamp: alert.effective,
          confidence: 75,
          city: location.name,
          isMetroOKC: location.name.includes('Oklahoma City')
        });
      }
    });
  }
  
  return reports;
}

async function handleHistoricalHail(request, path) {
  const date = path.split('/').pop();
  
  // Implement historical data fetching
  // This would query archived data sources
  
  return new Response(JSON.stringify({
    success: true,
    data: { reports: [] },
    source: 'archive',
    timestamp: Date.now()
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function handleHealth() {
  return new Response(JSON.stringify({
    status: 'healthy',
    timestamp: Date.now(),
    version: '1.0.0'
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Cache helpers (using KV storage in production)
async function getFromCache(key) {
  // In production, use Cloudflare KV or Vercel KV
  // For now, return null to always fetch fresh
  return null;
}

async function setCache(key, value, ttl) {
  // In production, store in KV with TTL
  return true;
}