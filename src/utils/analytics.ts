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
import { LABEL_RANK } from './labelRules';

// ── Label sets ────────────────────────────────────────────────────────────────

/** Gate "No" outcomes — the door did not open. */
export const NOT_OPENED_LABELS: KnockOutcome[] = [
  'no_home', 'no_soliciting', 'scout', 'not_eligible', 'revisit',
  'new_roof', 'no_damage', 'roofing_sign',
];

/**
 * Curb-side disqualifiers: assessed WITHOUT knocking, so they are not door
 * attempts and must never drag the open rate. Owner's framing: "doors which
 * don't count as knocks but require labeling" — they exist to capture intel
 * (roofing_sign in particular maps competitor presence street by street).
 */
export const NON_DOOR_LABELS: string[] = [
  'scout', 'not_eligible', 'new_roof', 'no_damage', 'roofing_sign',
];

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
 *
 * DERIVED from LABEL_RANK rather than hand-listed: the hand-written version
 * omitted `follow_up`, so relabelling inspected → follow_up silently erased the
 * inspection from the day's numbers. Deriving makes that class of drift
 * impossible — a new funnel label is counted correctly the moment it gets a rank.
 */
export function labelsAtOrAbove(stage: KnockOutcome): string[] {
  const floor = LABEL_RANK[stage];
  if (floor === undefined) return [stage];
  return Object.entries(LABEL_RANK)
    .filter(([, rank]) => (rank ?? 0) >= floor)
    .map(([label]) => label);
}

/** Terminal outcomes that sit outside LABEL_RANK but still imply an inspection. */
const POST_INSPECTION_TERMINALS = ['retarget', 'flaked', 'arch_hard'];

export const INSPECTED_PLUS: string[] = [
  ...labelsAtOrAbove('inspected'), 'retarget',
];
export const CONVERSATION_PLUS: string[] = [
  ...labelsAtOrAbove('conversation'), ...POST_INSPECTION_TERMINALS,
];

// ── Classification ────────────────────────────────────────────────────────────

/**
 * A door interaction. Scout = marking a property without knocking — not a door.
 * Not Eligible = property disqualified (for sale/rent/unmaintained) — also not a
 * door attempt, so it never drags the open rate. Revisit IS a door (knocked,
 * nobody home, roof promising).
 */
export const isDoor = (k: Knock): boolean => !NON_DOOR_LABELS.includes(k.label);

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

// ── Trajectory ("reached") stats ─────────────────────────────────────────────

/** One relabel, from knock_history. */
export interface LabelTransition {
  knock_id: string;
  previous_label?: string;
  new_label: string;
  changed_at: string; // ISO
}

export interface ReachedStats {
  lead: number;
  inspected: number;
  follow_up: number;
  signed: number;
}

const FUNNEL_STAGES: KnockOutcome[] = ['lead', 'inspected', 'follow_up', 'signed'];

/**
 * How many doors ENTERED each funnel stage during the window — what you
 * actually did in the period, credited to the day it happened.
 *
 * Why this exists: `knocks.label` holds only the CURRENT state, so a door that
 * was inspected and then relabelled follow_up stops being visible as an
 * inspection. computeRangeStats' cumulative sets patch that for the current
 * label, but still attribute the stage to the knock's ORIGINAL date — so
 * inspecting today a door you knocked last week would miss today's numbers.
 *
 * ENTRY semantics, deliberately — NOT "at or beyond". Signing today a door that
 * was inspected last week credits Signed TODAY and leaves the inspection in
 * LAST week, where it happened. Cumulative crediting double-counted the earlier
 * stages into the current period and made "inspections today" a lie.
 *
 * A door's FIRST label writes no history row, so it is reconstructed from the
 * `previous_label` of that door's earliest transition (falling back to the
 * current label for doors that never moved). Using k.label directly would
 * back-date a door's latest stage to its knock date.
 */
export function computeReachedStats(
  knocks: Knock[],
  transitions: LabelTransition[],
  win: RangeWindow
): ReachedStats {
  const inWindow = (t: Date) =>
    !(win.start && t < win.start) && !(win.end && t >= win.end);

  const entered: Record<string, Set<string>> = {};
  for (const stage of FUNNEL_STAGES) entered[stage] = new Set();

  const credit = (knockId: string, label: string | undefined) => {
    if (!label) return;
    if ((FUNNEL_STAGES as string[]).includes(label)) entered[label].add(knockId);
  };

  // Earliest transition per door — its `previous_label` is that door's first label.
  const earliest = new Map<string, LabelTransition>();
  for (const tr of transitions) {
    const cur = earliest.get(tr.knock_id);
    if (!cur || new Date(tr.changed_at) < new Date(cur.changed_at)) {
      earliest.set(tr.knock_id, tr);
    }
  }

  // A door created in the window enters whatever stage it was FIRST labelled.
  for (const k of knocks) {
    const t = k.knocked_at instanceof Date ? k.knocked_at : new Date(k.knocked_at);
    if (!inWindow(t)) continue;
    credit(k.id, earliest.get(k.id)?.previous_label ?? k.label);
  }

  // Every relabel in the window enters exactly the stage it moved INTO.
  for (const tr of transitions) {
    if (inWindow(new Date(tr.changed_at))) credit(tr.knock_id, tr.new_label);
  }

  return {
    lead: entered.lead.size,
    inspected: entered.inspected.size,
    follow_up: entered.follow_up.size,
    signed: entered.signed.size,
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
