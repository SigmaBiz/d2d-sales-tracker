/**
 * Pacing settings — device-local prefs backing the pace readout.
 *
 * Deliberately AsyncStorage, not Supabase:
 *  - The per-day goal override is a personal stretch target for TODAY. Writing
 *    it to teams.daily_door_goal would change everyone's goal and stay changed.
 *    Keyed by date so it expires by construction at midnight — no reset job.
 *  - Shift windows are per-person (a setter's hours differ from the owner's).
 * Losing either on reinstall costs nothing: both fall back to sane defaults.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ShiftWindow, DEFAULT_SHIFTS } from '../utils/pacing';

const SHIFTS_KEY = '@shift_windows';
const GOAL_OVERRIDE_KEY = '@door_goal_override';

/** YYYY-MM-DD in device-local time (NOT toISOString — that's UTC and rolls early). */
export function localDateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export async function getShifts(): Promise<ShiftWindow[]> {
  try {
    const raw = await AsyncStorage.getItem(SHIFTS_KEY);
    if (!raw) return DEFAULT_SHIFTS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_SHIFTS;
    // Guard against a malformed write — a bad shift silently zeroes the budget.
    const ok = parsed.every(
      (w: any) =>
        typeof w?.startMin === 'number' &&
        typeof w?.endMin === 'number' &&
        w.endMin > w.startMin
    );
    return ok ? (parsed as ShiftWindow[]) : DEFAULT_SHIFTS;
  } catch {
    return DEFAULT_SHIFTS;
  }
}

export async function setShifts(shifts: ShiftWindow[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SHIFTS_KEY, JSON.stringify(shifts));
  } catch (err) {
    console.warn('[Pacing] Failed to save shifts:', err);
  }
}

/** Today's override, or null when none is set for today (yesterday's is ignored). */
export async function getGoalOverride(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(GOAL_OVERRIDE_KEY);
    if (!raw) return null;
    const { date, goal } = JSON.parse(raw);
    if (date !== localDateKey()) return null;      // stale — expires itself
    return typeof goal === 'number' ? goal : null;
  } catch {
    return null;
  }
}

export async function setGoalOverride(goal: number): Promise<void> {
  try {
    const clamped = Math.max(5, Math.min(500, Math.round(goal)));
    await AsyncStorage.setItem(
      GOAL_OVERRIDE_KEY,
      JSON.stringify({ date: localDateKey(), goal: clamped })
    );
  } catch (err) {
    console.warn('[Pacing] Failed to save goal override:', err);
  }
}

export async function clearGoalOverride(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GOAL_OVERRIDE_KEY);
  } catch {
    /* non-fatal */
  }
}
