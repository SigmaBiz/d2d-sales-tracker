/**
 * Supabase Service — Primary data layer for canvassing knocks.
 *
 * Architecture:
 * - Supabase is the source of truth for all knock data.
 * - AsyncStorage is used as an offline queue only — knocks saved while offline
 *   are synced to Supabase when connectivity is restored.
 * - Anonymous auth is used on first launch and persists via AsyncStorage session.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase, SupabaseKnock, SupabaseKnockHistory, SupabaseContact } from './supabaseClient';
import { Knock, KnockContact, KnockOutcome } from '../types';

const OFFLINE_QUEUE_KEY = '@knock_offline_queue';
const TEAM_ID_KEY = '@team_id';
const TEAM_SETUP_DONE_KEY = '@team_setup_done';
const MAX_HISTORY_PER_KNOCK = 10;

export interface TeamInfo {
  id: string;
  name: string;
  invite_code: string;
  role: 'owner' | 'member';
  member_count?: number;
}

export class SupabaseService {
  private static userId: string | null = null;
  private static teamId: string | null = null;

  // ── Auth ────────────────────────────────────────────────────────────────────

  static async initialize(): Promise<boolean> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        this.userId = session.user.id;
        this.teamId = await AsyncStorage.getItem(TEAM_ID_KEY);
        return true;
      }
      return false; // No session — user must sign in via AuthScreen
    } catch (err) {
      console.error('[Supabase] Init error:', err);
      return false;
    }
  }

  static async isTeamSetupDone(): Promise<boolean> {
    const val = await AsyncStorage.getItem(TEAM_SETUP_DONE_KEY);
    return val === 'true';
  }

  static async markTeamSetupDone(): Promise<void> {
    await AsyncStorage.setItem(TEAM_SETUP_DONE_KEY, 'true');
  }

  // ── Team ────────────────────────────────────────────────────────────────────

  static async createTeam(name: string): Promise<{ success: boolean; invite_code?: string; error?: string }> {
    if (!this.userId) return { success: false, error: 'Not authenticated' };

    // Generate a 6-char invite code (no confusing chars)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let invite_code = '';
    for (let i = 0; i < 6; i++) {
      invite_code += chars[Math.floor(Math.random() * chars.length)];
    }

    const { data: team, error: teamErr } = await supabase
      .from('teams')
      .insert({ owner_id: this.userId, name, invite_code })
      .select()
      .single();

    if (teamErr) return { success: false, error: teamErr.message };

    await supabase.from('team_members').insert({
      team_id: team.id,
      user_id: this.userId,
      role: 'owner',
    });

    this.teamId = team.id;
    await AsyncStorage.setItem(TEAM_ID_KEY, team.id);
    await this.markTeamSetupDone();

    return { success: true, invite_code };
  }

  static async joinTeam(inviteCode: string): Promise<{ success: boolean; error?: string }> {
    if (!this.userId) return { success: false, error: 'Not authenticated' };

    const { data: team, error: lookupErr } = await supabase
      .from('teams')
      .select('id, name')
      .eq('invite_code', inviteCode.toUpperCase().trim())
      .maybeSingle();

    if (lookupErr || !team) return { success: false, error: 'Invalid invite code' };

    const { error: joinErr } = await supabase.from('team_members').insert({
      team_id: team.id,
      user_id: this.userId,
      role: 'member',
    });

    if (joinErr) {
      if (joinErr.code === '23505') return { success: false, error: 'Already a member of this team' };
      return { success: false, error: joinErr.message };
    }

    this.teamId = team.id;
    await AsyncStorage.setItem(TEAM_ID_KEY, team.id);
    await this.markTeamSetupDone();

    return { success: true };
  }

  static async getMyTeam(): Promise<TeamInfo | null> {
    if (!this.userId) return null;

    const { data } = await supabase
      .from('team_members')
      .select('role, teams(id, name, invite_code)')
      .eq('user_id', this.userId)
      .maybeSingle();

    if (!data || !data.teams) return null;

    const team = data.teams as any;

    // Get member count (only available to owner)
    let member_count: number | undefined;
    if (data.role === 'owner') {
      const { count } = await supabase
        .from('team_members')
        .select('*', { count: 'exact', head: true })
        .eq('team_id', team.id);
      member_count = count ?? undefined;
    }

    return {
      id: team.id,
      name: team.name,
      invite_code: team.invite_code,
      role: data.role as 'owner' | 'member',
      member_count,
    };
  }

  static async leaveTeam(): Promise<void> {
    if (!this.userId || !this.teamId) return;

    await supabase
      .from('team_members')
      .delete()
      .eq('team_id', this.teamId)
      .eq('user_id', this.userId);

    this.teamId = null;
    await AsyncStorage.removeItem(TEAM_ID_KEY);
  }

  static getTeamId(): string | null {
    return this.teamId;
  }

  static async signIn(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { success: false, error: error.message };
      if (data.user) {
        this.userId = data.user.id;
        this.teamId = await AsyncStorage.getItem(TEAM_ID_KEY);
        return { success: true };
      }
      return { success: false, error: 'Sign in failed' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async signUp(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { success: false, error: error.message };
      if (data.user) {
        this.userId = data.user.id;
        this.teamId = null; // New user has no team yet
        return { success: true };
      }
      return { success: false, error: 'Sign up failed' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async signOut(): Promise<void> {
    await supabase.auth.signOut();
    this.userId = null;
  }

  static getUserId(): string | null {
    return this.userId;
  }

  // ── Knocks — Write ──────────────────────────────────────────────────────────

  /**
   * Save a new knock. If online, writes directly to Supabase.
   * If offline, queues locally and syncs when connection returns.
   */
  static async saveKnock(knock: Omit<Knock, 'id' | 'syncStatus'>): Promise<Knock> {
    const net = await NetInfo.fetch();

    const row: SupabaseKnock = {
      user_id: this.userId ?? undefined,
      team_id: this.teamId ?? undefined,
      address: knock.address,
      latitude: knock.latitude,
      longitude: knock.longitude,
      label: knock.label,
      notes: knock.notes,
      photo_url: knock.photo_url,
      storm_date: knock.storm_date,
      knocked_at: knock.knocked_at.toISOString(),
    };

    if (net.isConnected && this.userId) {
      const { data, error } = await supabase
        .from('knocks')
        .insert(row)
        .select()
        .single();

      if (error) throw error;

      return this.rowToKnock(data);
    }

    // Offline — queue locally
    const localId = `local_${Date.now()}`;
    const localKnock: Knock = {
      ...knock,
      id: localId,
      syncStatus: 'pending',
    };
    await this.addToOfflineQueue(localKnock);
    return localKnock;
  }

  /**
   * Update a knock's label. Writes new label to knocks table and appends
   * to knock_history (capped at MAX_HISTORY_PER_KNOCK).
   */
  static async updateKnockLabel(
    knockId: string,
    previousLabel: KnockOutcome,
    newLabel: KnockOutcome,
    notes?: string
  ): Promise<void> {
    if (!this.userId) throw new Error('Not authenticated');

    // Update the knock
    const { error: updateError } = await supabase
      .from('knocks')
      .update({ label: newLabel, notes: notes ?? null })
      .eq('id', knockId)
      .eq('user_id', this.userId);

    if (updateError) throw updateError;

    // Append history entry
    const historyRow: SupabaseKnockHistory = {
      knock_id: knockId,
      user_id: this.userId,
      previous_label: previousLabel,
      new_label: newLabel,
      notes,
    };

    await supabase.from('knock_history').insert(historyRow);

    // Trim history to cap
    await this.trimHistory(knockId);
  }

  // ── Knocks — Read ───────────────────────────────────────────────────────────

  static async getKnocks(): Promise<Knock[]> {
    if (!this.userId) return [];

    const { data, error } = await supabase
      .from('knocks')
      .select('*')
      .order('knocked_at', { ascending: false })
      .limit(2000);

    if (error) {
      console.error('[Supabase] getKnocks error:', error);
      return [];
    }

    return data.map(this.rowToKnock);
  }

  static async getKnocksForArea(
    north: number, south: number, east: number, west: number
  ): Promise<Knock[]> {
    if (!this.userId) return [];

    const { data, error } = await supabase
      .from('knocks')
      .select('*')
      .gte('latitude', south)
      .lte('latitude', north)
      .gte('longitude', west)
      .lte('longitude', east)
      .order('knocked_at', { ascending: false });

    if (error) {
      console.error('[Supabase] getKnocksForArea error:', error);
      return [];
    }

    return data.map(this.rowToKnock);
  }

  static async getKnockHistory(knockId: string): Promise<Knock['history']> {
    const { data, error } = await supabase
      .from('knock_history')
      .select('*')
      .eq('knock_id', knockId)
      .order('changed_at', { ascending: true });

    if (error) return [];

    return data.map(h => ({
      previous_label: h.previous_label as KnockOutcome,
      new_label: h.new_label as KnockOutcome,
      changed_at: new Date(h.changed_at),
      notes: h.notes ?? undefined,
    }));
  }

  // ── Contacts ────────────────────────────────────────────────────────────────

  static async saveContact(contact: Omit<KnockContact, 'id'>): Promise<KnockContact> {
    const row: SupabaseContact = {
      knock_id: contact.knock_id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      is_owner: contact.is_owner,
    };

    const { data, error } = await supabase
      .from('contacts')
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    return {
      id: data.id,
      knock_id: data.knock_id,
      name: data.name ?? undefined,
      phone: data.phone ?? undefined,
      email: data.email ?? undefined,
      is_owner: data.is_owner ?? true,
    };
  }

  static async getContactsForKnock(knockId: string): Promise<KnockContact[]> {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('knock_id', knockId);

    if (error) return [];

    return data.map(c => ({
      id: c.id,
      knock_id: c.knock_id,
      name: c.name ?? undefined,
      phone: c.phone ?? undefined,
      email: c.email ?? undefined,
      insurance_carrier: c.insurance_carrier ?? undefined,
      is_owner: c.is_owner ?? true,
    }));
  }

  /**
   * Upsert a contact for a knock — inserts if none exists, updates if one does.
   * ζ-verdict: one contact per knock (Z₂ — simple, guaranteed fast in field).
   */
  static async upsertContact(
    knockId: string,
    data: { name?: string; phone?: string; insurance_carrier?: string }
  ): Promise<void> {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('knock_id', knockId)
      .maybeSingle();

    if (existing?.id) {
      await supabase.from('contacts').update({
        name: data.name ?? null,
        phone: data.phone ?? null,
        insurance_carrier: data.insurance_carrier ?? null,
      }).eq('id', existing.id);
    } else {
      await supabase.from('contacts').insert({
        knock_id: knockId,
        name: data.name,
        phone: data.phone,
        insurance_carrier: data.insurance_carrier,
        is_owner: true,
      });
    }
  }

  // ── Knock — Delete ─────────────────────────────────────────────────────────

  static async deleteKnock(knockId: string): Promise<void> {
    if (!this.userId) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('knocks')
      .delete()
      .eq('id', knockId)
      .eq('user_id', this.userId);

    if (error) throw error;
  }

  // ── Knock — Property Data ───────────────────────────────────────────────────

  static async updateKnockProperty(
    knockId: string,
    data: { year_built?: number; sqft?: number }
  ): Promise<void> {
    if (!this.userId) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('knocks')
      .update({
        year_built: data.year_built ?? null,
        sqft: data.sqft ?? null,
      })
      .eq('id', knockId)
      .eq('user_id', this.userId);

    if (error) throw error;
  }

  // ── Offline Queue ───────────────────────────────────────────────────────────

  static async syncOfflineQueue(): Promise<{ synced: number; failed: number }> {
    const net = await NetInfo.fetch();
    if (!net.isConnected || !this.userId) return { synced: 0, failed: 0 };

    const queue = await this.getOfflineQueue();
    if (queue.length === 0) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;
    const remaining: Knock[] = [];

    for (const knock of queue) {
      try {
        const row: SupabaseKnock = {
          user_id: this.userId,
          address: knock.address,
          latitude: knock.latitude,
          longitude: knock.longitude,
          label: knock.label,
          notes: knock.notes,
          photo_url: knock.photo_url,
          storm_date: knock.storm_date,
          knocked_at: knock.knocked_at instanceof Date
            ? knock.knocked_at.toISOString()
            : knock.knocked_at,
        };

        const { error } = await supabase.from('knocks').insert(row);
        if (error) throw error;
        synced++;
      } catch {
        failed++;
        remaining.push(knock);
      }
    }

    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    console.log(`[Supabase] Synced ${synced} offline knocks, ${failed} failed`);
    return { synced, failed };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private static rowToKnock(row: any): Knock {
    return {
      id: row.id,
      user_id: row.user_id,
      address: row.address ?? undefined,
      latitude: row.latitude,
      longitude: row.longitude,
      label: row.label as KnockOutcome,
      notes: row.notes ?? undefined,
      photo_url: row.photo_url ?? undefined,
      storm_date: row.storm_date ?? undefined,
      knocked_at: new Date(row.knocked_at),
      syncStatus: 'synced',
      year_built: row.year_built ?? undefined,
      sqft: row.sqft ?? undefined,
    };
  }

  private static async trimHistory(knockId: string): Promise<void> {
    const { data } = await supabase
      .from('knock_history')
      .select('id')
      .eq('knock_id', knockId)
      .order('changed_at', { ascending: true });

    if (!data || data.length <= MAX_HISTORY_PER_KNOCK) return;

    const idsToDelete = data
      .slice(0, data.length - MAX_HISTORY_PER_KNOCK)
      .map(r => r.id);

    await supabase.from('knock_history').delete().in('id', idsToDelete);
  }

  private static async addToOfflineQueue(knock: Knock): Promise<void> {
    const queue = await this.getOfflineQueue();
    queue.push(knock);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  }

  private static async getOfflineQueue(): Promise<Knock[]> {
    try {
      const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  static async getStorageUsage() {
    if (!this.userId) return null;

    const { count } = await supabase
      .from('knocks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', this.userId);

    const knockCount = count ?? 0;
    const bytesPerKnock = 300;
    const freeLimit = 500 * 1024 * 1024;
    const bytesUsed = knockCount * bytesPerKnock;

    return {
      knock_count: knockCount,
      percentage_used: (bytesUsed / freeLimit) * 100,
      days_until_full: Math.floor((freeLimit - bytesUsed) / (bytesPerKnock * 100)),
    };
  }
}
