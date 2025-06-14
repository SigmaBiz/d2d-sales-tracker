import { supabase } from './supabaseClient';

export async function testSupabaseConnection() {
  console.log('Testing Supabase connection...');
  
  try {
    // Test 1: Can we reach Supabase?
    const { data, error } = await supabase
      .from('knocks')
      .select('count')
      .limit(1);
    
    if (error) {
      console.error('Database query error:', error);
      
      // Common errors:
      if (error.message.includes('relation "public.knocks" does not exist')) {
        console.error('❌ Tables not created! Run the SQL commands in Supabase dashboard.');
      } else if (error.message.includes('JWT')) {
        console.error('❌ API key issue. Check your credentials.');
      } else if (error.message.includes('network')) {
        console.error('❌ Network error. Check internet connection.');
      }
      
      return false;
    }
    
    console.log('✅ Successfully connected to Supabase!');
    
    // Test 2: Try anonymous auth
    console.log('Testing anonymous authentication...');
    const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
    
    if (authError) {
      console.error('❌ Anonymous auth error:', authError);
      console.error('Make sure Anonymous auth is enabled in Supabase dashboard!');
      return false;
    }
    
    console.log('✅ Anonymous auth working! User ID:', authData.user?.id);
    return true;
    
  } catch (error) {
    console.error('Connection test failed:', error);
    return false;
  }
}