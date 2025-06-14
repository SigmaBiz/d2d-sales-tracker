import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// These will be replaced with your actual Supabase project details
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY';

// Create Supabase client with AsyncStorage for React Native
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Database types
export interface SupabaseKnock {
  id?: string;
  user_id: string;
  latitude: number;
  longitude: number;
  address?: string;
  outcome: string;
  notes?: string;
  created_at?: string;
  local_id: string; // To match with local storage
}

export interface SupabaseDailyStats {
  id?: string;
  user_id: string;
  date: string;
  knocks: number;
  contacts: number;
  leads: number;
  sales: number;
  revenue: number;
  created_at?: string;
}

// Storage usage tracking
export interface StorageUsage {
  total_bytes: number;
  knock_count: number;
  percentage_used: number;
  days_until_full: number;
}