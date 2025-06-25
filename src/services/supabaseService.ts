import { supabase, SupabaseKnock, SupabaseDailyStats, StorageUsage } from './supabaseClient';
import { StorageService } from './storageService';
import { Knock, DailyStats } from '../types';
import NetInfo from '@react-native-community/netinfo';

export class SupabaseService {
  private static userId: string | null = null;

  // Initialize service and check auth
  static async initialize(): Promise<boolean> {
    try {
      console.log('Initializing Supabase...');
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('Supabase session error:', error);
        return false;
      }
      
      if (session?.user) {
        this.userId = session.user.id;
        console.log('Supabase connected with existing session');
        return true;
      }
      
      console.log('No existing session, will need to sign in');
      return false;
    } catch (error) {
      console.error('Supabase initialization error:', error);
      return false;
    }
  }

  // Anonymous auth for easy start
  static async signInAnonymously(): Promise<boolean> {
    try {
      console.log('Attempting anonymous sign in...');
      const { data, error } = await supabase.auth.signInAnonymously();
      
      if (error) {
        console.error('Anonymous sign in error:', error);
        throw error;
      }
      
      if (data.user) {
        this.userId = data.user.id;
        console.log('Successfully signed in anonymously, userId:', this.userId);
        return true;
      }
      
      console.log('No user returned from anonymous sign in');
      return false;
    } catch (error) {
      console.error('Error signing in:', error);
      return false;
    }
  }

  // Sync local knocks to Supabase
  static async syncKnocks(knocks?: Knock[], metadata?: any): Promise<{ synced: number; failed: number }> {
    if (!this.userId) return { synced: 0, failed: 0 };

    try {
      // Check network status
      const netInfo = await NetInfo.fetch();
      if (!netInfo.isConnected) {
        return { synced: 0, failed: 0 };
      }

      // Get knocks to sync - either provided or unsynced ones
      const knocksToProcess = knocks || await StorageService.getUnsyncedKnocks();
      let synced = 0;
      let failed = 0;

      // Batch sync for efficiency
      const knocksToSync: SupabaseKnock[] = knocksToProcess.map(knock => ({
        user_id: this.userId!,
        latitude: knock.latitude,
        longitude: knock.longitude,
        address: knock.address,
        outcome: knock.outcome,
        notes: knock.notes,
        created_at: knock.timestamp.toString(),
        local_id: knock.id,
      }));

      if (knocksToSync.length > 0) {
        const { data, error } = await supabase
          .from('knocks')
          .upsert(knocksToSync, {
            onConflict: 'user_id,local_id',
            ignoreDuplicates: false
          })
          .select();

        if (error) {
          console.error('Sync error:', error);
          failed = knocksToSync.length;
        } else {
          synced = data?.length || 0;
          // Mark synced knocks if we're syncing unsynced ones
          if (!knocks) {
            const syncedIds = knocksToProcess.slice(0, synced).map(k => k.id);
            await StorageService.markKnocksSynced(syncedIds);
          }
        }
      }

      // Sync daily stats
      await this.syncDailyStats();

      return { synced, failed };
    } catch (error) {
      console.error('Sync failed:', error);
      return { synced: 0, failed: 0 };
    }
  }

  // Sync daily stats
  static async syncDailyStats(): Promise<void> {
    if (!this.userId) return;

    try {
      const dailyStats = await StorageService.getDailyStats();
      
      for (const stat of dailyStats) {
        const { error } = await supabase
          .from('daily_stats')
          .upsert({
            user_id: this.userId,
            date: new Date(stat.date).toISOString(),
            knocks: stat.knocks,
            contacts: stat.contacts,
            leads: stat.leads,
            sales: stat.sales,
            revenue: stat.revenue,
          }, {
            onConflict: 'user_id,date'
          });

        if (error) {
          console.error('Error syncing daily stats:', error);
        }
      }
    } catch (error) {
      console.error('Daily stats sync failed:', error);
    }
  }

  // Get knocks from cloud (for viewing on other devices)
  static async getCloudKnocks(): Promise<Knock[]> {
    if (!this.userId) return [];

    try {
      const { data, error } = await supabase
        .from('knocks')
        .select('*')
        .eq('user_id', this.userId)
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) throw error;

      return data.map(knock => ({
        id: knock.local_id,
        latitude: knock.latitude,
        longitude: knock.longitude,
        address: knock.address || undefined,
        outcome: knock.outcome as Knock['outcome'],
        notes: knock.notes || undefined,
        timestamp: new Date(knock.created_at),
        repId: knock.user_id,
        syncStatus: 'synced' as const,
      }));
    } catch (error) {
      console.error('Error fetching cloud knocks:', error);
      return [];
    }
  }

  // Get storage usage
  static async getStorageUsage(): Promise<StorageUsage | null> {
    if (!this.userId) return null;

    try {
      // Get knock count
      const { count: knockCount, error: countError } = await supabase
        .from('knocks')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', this.userId);

      if (countError) {
        console.error('Error getting knock count:', countError);
      }

      // For now, estimate storage based on knock count
      // Average knock size is about 280 bytes
      const totalKnocks = knockCount || 0;
      const avgBytesPerKnock = 280;
      const bytesUsed = totalKnocks * avgBytesPerKnock;
      const freeLimit = 500 * 1024 * 1024; // 500MB in bytes
      const percentageUsed = (bytesUsed / freeLimit) * 100;
      
      // Calculate days until full based on current rate
      const knocksPerDay = 100; // Estimate
      const bytesPerDay = avgBytesPerKnock * knocksPerDay;
      const bytesRemaining = freeLimit - bytesUsed;
      const daysUntilFull = bytesRemaining > 0 ? Math.floor(bytesRemaining / bytesPerDay) : 0;

      return {
        total_bytes: bytesUsed,
        knock_count: totalKnocks,
        percentage_used: percentageUsed,
        days_until_full: daysUntilFull > 99999 ? 99999 : daysUntilFull,
      };
    } catch (error) {
      console.error('Error getting storage usage:', error);
      return null;
    }
  }

  // Enable real-time sync
  static enableRealtimeSync(onUpdate: () => void): () => void {
    if (!this.userId) return () => {};

    const subscription = supabase
      .channel('knocks_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'knocks',
          filter: `user_id=eq.${this.userId}`,
        },
        (payload) => {
          console.log('Real-time update:', payload);
          onUpdate();
        }
      )
      .subscribe();

    // Return cleanup function
    return () => {
      subscription.unsubscribe();
    };
  }
}