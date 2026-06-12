/**
 * Analytics — pure functions over Knock[] (no I/O).
 * Single source of truth for label classification; RealMapScreen and
 * StatsScreen import these sets instead of keeping local copies.
 *
 * Classification is COMPLEMENT-based on purpose: the lifecycle server mirrors
 * terminal statuses into knocks.label, including values outside KnockOutcome
 * (arch_hard today; see transition.ts). Enumerated "opened" sets would silently
 * drop those doors — "everything except the three not-opened labels" cannot.
 */
import { Knock, KnockOutcome } from '../types';

// ── Label sets ────────────────────────────────────────────────────────────────

/** Gate "No" outcomes — the door did not open. */
export const NOT_OPENED_LABELS: KnockOutcome[] = ['no_home', 'no_soliciting', 'scout'];

/**
 * Picker concept (NOT the analytics classification): labels a user may choose
 * when the door opened. Lifecycle-mirrored labels (retarget/flaked) are
 * excluded here because they're server-written, never picked.
 */
export const OPENED_PICKER_LABELS: KnockOutcome[] = [
  'not_interested', 'renter', 'conversation', 'inspected', 'follow_up', 'lead', 'signed',
];

/** Validated-effort cluster shown as "Pipeline". */
export const PIPELINE_LABELS: string[] = ['inspected', 'follow_up', 'lead', 'signed'];

/**
 * Cumulative funnel sets. Labels are mutually exclusive snapshots — a signed
 * door no longer carries 'inspected' — so funnel stages must count "X or
 * beyond", not the raw label.
 */
export const INSPECTED_PLUS: string[] = ['inspected', 'signed', 'retarget'];
export const CONVERSATION_PLUS: string[] = [
  'conversation', 'follow_up', 'lead', 'flaked', 'arch_hard', ...INSPECTED_PLUS,
];

// ── Classification ────────────────────────────────────────────────────────────

/** A door interaction. Scout = marking a property without knocking — not a door. */
export const isDoor = (k: Knock): boolean => k.label !== 'scout';

/** Door opened = any door whose label isn't a not-opened outcome. */
export const isOpened = (k: Knock): boolean =>
  isDoor(k) && !(NOT_OPENED_LABELS as string[]).includes(k.label);

// ── Date windows (device-local; DST-safe — setDate/setHours, never ms math) ──

export type RangeKey = 'today' | 'week' | 'month' | 'all';

export interface RangeWindow {
  start: Date | null; // null = unbounded (all-time)
  end: Date | null;   // null = now
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Monday 00:00 local of the week containing d. */
function startOfWeek(d: Date): Date {
  const out = startOfDay(d);
  const daysSinceMonday = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - daysSinceMonday);
  return out;
}

function startOfMonth(d: Date): Date {
  const out = startOfDay(d);
  out.setDate(1);
  return out;
}

export function rangeWindow(key: RangeKey, now: Date = new Date()): RangeWindow {
  switch (key) {
    case 'today': return { start: startOfDay(now), end: null };
    case 'week':  return { start: startOfWeek(now), end: null };
    case 'month': return { start: startOfMonth(now), end: null };
    case 'all':   return { start: null, end: null };
  }
}

/** The equal calendar window immediately before `key`'s window. Null for 'all'. */
export function previousWindow(key: RangeKey, now: Date = new Date()): RangeWindow | null {
  switch (key) {
    case 'today': {
      const end = startOfDay(now);
      const start = new Date(end);
      start.setDate(start.getDate() - 1);
      return { start, end };
    }
    case 'week': {
      const end = startOfWeek(now);
      const start = new Date(end);
      start.setDate(start.getDate() - 7);
      return { start, end };
    }
    case 'month': {
      const end = startOfMonth(now);
      const start = new Date(end);
      start.setMonth(start.getMonth() - 1);
      return { start, end };
    }
    case 'all':
      return null;
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface RangeStats {
  doors: number;
  opened: number;
  openRate: number | null;       // opened ÷ doors (the industry "contact rate")
  pipeline: number;
  pipelineRate: number | null;   // pipeline ÷ opened
  signed: number;
  inspectedPlus: number;
  convToInspRate: number | null; // INSPECTED_PLUS ÷ CONVERSATION_PLUS
  activeDays: number;            // distinct local days with ≥1 door
  avgDailyDoors: number | null;  // doors ÷ activeDays
  counts: Record<string, number>; // raw label counts (breakdown)
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export function computeRangeStats(knocks: Knock[], win: RangeWindow): RangeStats {
  const counts: Record<string, number> = {};
  let doors = 0;
  let opened = 0;
  let pipeline = 0;
  let signed = 0;
  let inspectedPlus = 0;
  let conversationPlus = 0;
  const days = new Set<string>();

  for (const k of knocks) {
    const t = k.knocked_at instanceof Date ? k.knocked_at : new Date(k.knocked_at);
    if (win.start && t < win.start) continue;
    if (win.end && t >= win.end) continue;

    counts[k.label] = (counts[k.label] ?? 0) + 1;
    if (!isDoor(k)) continue;

    doors++;
    days.add(t.toDateString());
    if (isOpened(k)) opened++;
    if (PIPELINE_LABELS.includes(k.label)) pipeline++;
    if (k.label === 'signed') signed++;
    if (INSPECTED_PLUS.includes(k.label)) inspectedPlus++;
    if (CONVERSATION_PLUS.includes(k.label)) conversationPlus++;
  }

  return {
    doors,
    opened,
    openRate: ratio(opened, doors),
    pipeline,
    pipelineRate: ratio(pipeline, opened),
    signed,
    inspectedPlus,
    convToInspRate: ratio(inspectedPlus, conversationPlus),
    activeDays: days.size,
    avgDailyDoors: days.size > 0 ? doors / days.size : null,
  counts,
  };
}

/** Percent change current vs previous; null when previous is unusable (no ∞/NaN). */
export function trendPct(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}

/**
 * Industry contact-rate bands (SalesRabbit/SPOTIO canvassing benchmarks):
 * 30–40% healthy; <20% usually means wrong timing.
 */
export function openRateBand(rate: number | null): { color: string; hint?: string } {
  if (rate == null) return { color: '#9ca3af' };
  if (rate >= 0.3) return { color: '#16a34a' };
  if (rate >= 0.2) return { color: '#d97706' };
  return { color: '#dc2626', hint: 'check timing' };
}
