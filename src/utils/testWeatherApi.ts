/**
 * Test script for WeatherAPI integration
 * Run this to verify your API key is working
 */

import { WeatherApiService } from '../services/weatherApiService';

export async function testWeatherApiConnection() {
  console.log('Testing WeatherAPI connection...\n');
  
  // Test 1: Check if API key is configured
  if (!WeatherApiService.hasApiKey()) {
    console.error('❌ WeatherAPI key not configured!');
    console.log('Please add your API key to .env file:');
    console.log('EXPO_PUBLIC_WEATHER_API_KEY=your_actual_key_here\n');
    return false;
  }
  
  console.log('✅ API key detected\n');
  
  // Test 2: Test connection with OKC coordinates
  console.log('Testing connection with Oklahoma City coordinates...');
  const connected = await WeatherApiService.testConnection();
  
  if (!connected) {
    console.error('❌ Failed to connect to WeatherAPI');
    console.log('Please check your API key is valid\n');
    return false;
  }
  
  console.log('✅ Successfully connected to WeatherAPI\n');
  
  // Test 3: Fetch actual hail reports
  console.log('Fetching Oklahoma hail reports...');
  try {
    const reports = await WeatherApiService.fetchOklahomaHailReports();
    console.log(`✅ Found ${reports.length} hail reports in Oklahoma\n`);
    
    if (reports.length > 0) {
      console.log('Sample report:');
      const sample = reports[0];
      console.log(`  Location: ${sample.city} (${sample.latitude.toFixed(4)}, ${sample.longitude.toFixed(4)})`);
      console.log(`  Size: ${sample.size} inches`);
      console.log(`  Confidence: ${sample.confidence}%`);
      console.log(`  Timestamp: ${sample.timestamp.toLocaleString()}\n`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error fetching hail reports:', error);
    return false;
  }
}

// Add test button to development builds
export function addTestButton(navigation: any) {
  if (__DEV__) {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity 
          onPress={async () => {
            const success = await testWeatherApiConnection();
            Alert.alert(
              'WeatherAPI Test',
              success 
                ? 'Connection successful! Check console for details.' 
                : 'Connection failed. Check console for errors.',
              [{ text: 'OK' }]
            );
          }}
          style={{ marginRight: 15 }}
        >
          <Text style={{ color: '#007AFF' }}>Test API</Text>
        </TouchableOpacity>
      ),
    });
  }
}