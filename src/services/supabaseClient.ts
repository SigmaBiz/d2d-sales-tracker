import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Supabase configuration
const supabaseUrl = 'https://ibpqwovcrvagwbfrmbgp.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlicHF3b3ZjcnZhZ3diZnJtYmdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDM4NzgsImV4cCI6MjA5NTMxOTg3OH0.-0HbWytT12tohoaMvTvrCfnqNYD9eqRxCik0oAJq7CQ';

// Create Supabase client with AsyncStorage for React Native
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Database row types (match Supabase schema exactly)
export interface SupabaseKnock {
  id?: string;
  user_id?: string;
  team_id?: string;
  address?: string;
  latitude: number;
  longitude: number;
  label: string;
  notes?: string;
  photo_url?: string;
  storm_date?: string; // YYYY-MM-DD
  knocked_at?: string; // ISO timestamptz
}

export interface SupabaseKnockHistory {
  id?: string;
  knock_id: string;
  user_id?: string;
  previous_label: string;
  new_label: string;
  notes?: string;
  changed_at?: string;
}

export interface SupabaseContact {
  id?: string;
  knock_id: string;
  name?: string;
  phone?: string;
  email?: string;
  insurance_carrier?: string;
  is_owner?: boolean;
}

export interface StorageUsage {
  knock_count: number;
  percentage_used: number;
  days_until_full: number;
}