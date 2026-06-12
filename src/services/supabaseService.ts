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
import { Knock, KnockContact, KnockOutcome, AppNotification } from '../types';

const OFFLINE_QUEUE_KEY = '@knock_offline_queue';
const TEAM_ID_KEY = '@team_id';
const TEAM_SETUP_DONE_KEY = '@team_setup_done';
const MAX_HISTORY_PER_KNOCK = 10;
const API_BASE = 'https://d2d-sales-tracker-tau.vercel.app';

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
  private static role: 'owner' | 'member' | null = null;
  private static defaultDateOfLoss: string | null = null; // YYYY-MM-DD, team's active campaign

  // ── Auth ────────────────────────────────────────────────────────────────────

  static async initialize(): Promise<boolean> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        this.userId = session.user.id;
        this.teamId = await AsyncStorage.getItem(TEAM_ID_KEY);
        this.getTeamDefaultDateOfLoss().catch(() => {}); // warm the cache (non-blocking)
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

    // Guard: if the user already belongs to a team, reuse it instead of creating
    // another. Prevents the duplicate-team mess (one account owning many teams).
    const existing = await this.getMyTeam();
    if (existing) {
      this.teamId = existing.id;
      this.role = existing.role;
      await AsyncStorage.setItem(TEAM_ID_KEY, existing.id);
      await this.markTeamSetupDone();
      return { success: true, invite_code: existing.invite_code };
    }

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
    this.role = 'owner';
    await AsyncStorage.setItem(TEAM_ID_KEY, team.id);
    await this.markTeamSetupDone();

    return { success: true, invite_code };
  }

  static async joinTeam(inviteCode: string): Promise<{ success: boolean; error?: string }> {
    if (!this.userId) return { success: false, error: 'Not authenticated' };

    // The teams table is RLS-locked, so a non-member can't resolve the invite code
    // client-side. Go through the server endpoint, which does the lookup + insert
    // with the service role (authenticated by our JWT).
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return { success: false, error: 'Not authenticated' };

      const res = await fetch(`${API_BASE}/api/teams/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ inviteCode: inviteCode.toUpperCase().trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? `HTTP ${res.status}` };
      }

      this.teamId = body.team.id;
      this.role = 'member';
      await AsyncStorage.setItem(TEAM_ID_KEY, body.team.id);
      await this.markTeamSetupDone();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Network error' };
    }
  }

  static async getMyTeam(): Promise<TeamInfo | null> {
    if (!this.userId) return null;

    // A user may have >1 team_members row (e.g. owns several teams). maybeSingle()
    // ERRORS on multiple rows and returns null — which would wrongly show "Solo mode"
    // and drop the owner to setter labs. Take the earliest-joined team deterministically.
    const { data: rows } = await supabase
      .from('team_members')
      .select('role, teams(id, name, invite_code)')
      .eq('user_id', this.userId)
      .order('joined_at', { ascending: true })
      .limit(1);

    const data = rows?.[0];
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
    this.role = null;
    await AsyncStorage.removeItem(TEAM_ID_KEY);
    // Clear the setup flag so a member who left is re-prompted to create/join next time.
    await AsyncStorage.removeItem(TEAM_SETUP_DONE_KEY);
  }

  static getTeamId(): string | null {
    return this.teamId;
  }

  /**
   * Current user's team role, cached after first lookup.
   * 'owner' = runner/admin, 'member' = setter. Null if not on a team.
   * Pass force=true to refetch (e.g. after creating/joining/leaving a team).
   */
  static async getRole(force = false): Promise<'owner' | 'member' | null> {
    if (this.role !== null && !force) return this.role;
    const team = await this.getMyTeam();
    this.role = team?.role ?? null;
    return this.role;
  }

  static async isOwner(force = false): Promise<boolean> {
    return (await this.getRole(force)) === 'owner';
  }

  // ── Date of loss (active campaign) — F2f-1 ────────────────────────────────
  // The team's current campaign date. New knocks auto-stamp with it; the admin
  // sets it (storm screen / Settings); members inherit it silently.

  /** Team's default date of loss (YYYY-MM-DD), cached. force=true refetches. */
  static async getTeamDefaultDateOfLoss(force = false): Promise<string | null> {
    if (this.defaultDateOfLoss !== null && !force) return this.defaultDateOfLoss;
    if (!this.teamId) return null;
    const { data } = await supabase
      .from('teams')
      .select('default_date_of_loss')
      .eq('id', this.teamId)
      .maybeSingle();
    this.defaultDateOfLoss = (data?.default_date_of_loss as string) ?? null;
    return this.defaultDateOfLoss;
  }

  /** Synchronous cached read (for stamping knocks without a round-trip). */
  static getCachedDateOfLoss(): string | null {
    return this.defaultDateOfLoss;
  }

  /** Owner sets the team's active campaign date. */
  static async setTeamDefaultDateOfLoss(date: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.teamId) return { ok: false, error: 'No team' };
    const { error } = await supabase
      .from('teams')
      .update({ default_date_of_loss: date })
      .eq('id', this.teamId);
    if (error) return { ok: false, error: error.message };
    this.defaultDateOfLoss = date;
    return { ok: true };
  }

  static async signIn(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { success: false, error: error.message };
      if (data.user) {
        this.userId = data.user.id;
        this.teamId = await AsyncStorage.getItem(TEAM_ID_KEY);
        this.role = null; // clear any stale cached role; getRole() refetches for this user
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
        this.role = null;   // clear any stale cached role
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
    this.role = null;
    // Full teardown — otherwise the next login on this device inherits the prior
    // account's team (stale @team_id) and skips Team Setup (@team_setup_done left true).
    this.teamId = null;
    this.defaultDateOfLoss = null;
    await AsyncStorage.removeItem(TEAM_ID_KEY);
    await AsyncStorage.removeItem(TEAM_SETUP_DONE_KEY);
  }

  static getUserId(): string | null {
    return this.userId;
  }

  // ── Lead lifecycle (F2b) ──────────────────────────────────────────────────

  /** Owner-only: trigger server-side processing of a storm date (GitHub Actions pipeline). */
  static async processStorm(
    date: string
  ): Promise<{ ok: boolean; skipWait?: boolean; error?: string }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return { ok: false, error: 'Not authenticated' };

      const res = await fetch(`${API_BASE}/api/storms/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ date }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      return { ok: true, skipWait: body.skipWait };
    } catch (err) {
      console.error('[Supabase] processStorm:', err);
      return { ok: false, error: 'Network error' };
    }
  }

  /**
   * Perform a lifecycle transition via the server endpoint (the only writer of
   * lifecycle state). Sends the user's JWT so the server can verify identity +
   * role before recording the event. Returns the new status on success.
   */
  static async transitionLead(
    knockId: string,
    action: string,
    opts?: { note?: string; appointmentAt?: string }
  ): Promise<{ ok: boolean; status?: string; label?: string; error?: string }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return { ok: false, error: 'Not authenticated' };

      const res = await fetch(`${API_BASE}/api/leads/transition`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          knockId, action,
          note: opts?.note,
          appointmentAt: opts?.appointmentAt,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      return { ok: true, status: body.status, label: body.label };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Network error' };
    }
  }

  /**
   * Active leads = knocks currently in a lifecycle (status set, not terminal).
   * Terminal statuses (signed / arch_hard / retarget) are excluded so the Log
   * shows only leads that still need action. RLS scopes visibility: a member sees
   * their own; an owner sees the team's.
   */
  static async getActiveLeads(): Promise<Knock[]> {
    if (!this.userId) return [];
    const { data, error } = await supabase
      .from('knocks')
      .select('*')
      .not('status', 'is', null)
      .not('status', 'in', '(signed,arch_hard,retarget)')
      .order('knocked_at', { ascending: false })
      .limit(500);
    if (error) {
      console.error('[Supabase] getActiveLeads error:', error);
      return [];
    }
    return data.map(this.rowToKnock);
  }

  /** Append-only event history for one knock (the per-lead Log). */
  static async getLeadEvents(knockId: string): Promise<Array<{
    action: string; from_status: string | null; to_status: string | null;
    actor_role: string | null; cycle_number: number; note: string | null; created_at: string;
  }>> {
    const { data, error } = await supabase
      .from('lead_events')
      .select('action, from_status, to_status, actor_role, cycle_number, note, created_at')
      .eq('knock_id', knockId)
      .order('created_at', { ascending: false });
    if (error) return [];
    return data as any;
  }

  // ── Notifications feed (F2e) ──────────────────────────────────────────────
  // RLS scopes every read/update to the recipient (user_id = auth.uid()), so the
  // client reads + marks-read directly — no endpoint needed.

  static async getNotifications(limit = 50): Promise<AppNotification[]> {
    if (!this.userId) return [];
    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, urgent, title, body, knock_id, lat, lng, data, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) { console.error('[Supabase] getNotifications:', error); return []; }
    return data as AppNotification[];
  }

  /** Unread count for the bell badge. */
  static async getUnreadCount(): Promise<number> {
    if (!this.userId) return 0;
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);
    if (error) return 0;
    return count ?? 0;
  }

  /** Whether any UNREAD notification is urgent (drives shake + buzz). */
  static async hasUrgentUnread(): Promise<boolean> {
    if (!this.userId) return false;
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .eq('urgent', true);
    if (error) return false;
    return (count ?? 0) > 0;
  }

  /** Mark notifications read. Pass ids to mark specific ones, omit to clear all unread. */
  static async markNotificationsRead(ids?: string[]): Promise<void> {
    if (!this.userId) return;
    let q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    if (ids && ids.length) q = q.in('id', ids);
    const { error } = await q;
    if (error) console.warn('[Supabase] markNotificationsRead:', error.message);
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
      service_type: knock.service_type,
      status: knock.status,
      cycle_number: knock.cycle_number,
      // Stamp with the team's active campaign date if the caller didn't supply one.
      date_of_loss: knock.date_of_loss ?? this.defaultDateOfLoss ?? undefined,
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
          service_type: knock.service_type,
          status: knock.status,
          cycle_number: knock.cycle_number,
          date_of_loss: knock.date_of_loss,
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
      service_type: row.service_type ?? undefined,
      status: row.status ?? undefined,
      cycle_number: row.cycle_number ?? undefined,
      date_of_loss: row.date_of_loss ?? undefined,
      appointment_at: row.appointment_at ?? undefined,
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
