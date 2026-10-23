/**
 * Pacing — pure functions over the clock (no I/O), mirroring utils/analytics.ts.
 *
 * The point is not a stopwatch. It is one number: how long you can afford at
 * THIS door, given doors remaining and shift time remaining. Everything here is
 * device-local time and DST-safe (minutes-from-midnight + setHours, never ms
 * arithmetic across a day boundary — same rule as analytics.ts).
 */

/** A shift window as minutes from local midnight. 10:00 => 600. */
export interface ShiftWindow {
  startMin: number;
  endMin: number;
}

/** Owner's default split shift: 10:00–14:00 and 15:00–18:30. */
export const DEFAULT_SHIFTS: ShiftWindow[] = [
  { startMin: 10 * 60, endMin: 14 * 60 },
  { startMin: 15 * 60, endMin: 18 * 60 + 30 },
];

/** Per-door time caps in SECONDS. null = never alarm. */
export type DoorPhase = 'knocking' | 'conversation' | 'inspect' | 'signing' | 'exempt';

/**
 * Alarm smoke-test switch. Flip to `true` to make every door alarm in ~10s so
 * the OS-scheduled notification can be re-verified without waiting 5 minutes
 * per attempt. VERIFIED on device 2026-10-23: fires both locked and unlocked.
 * Must stay `false` in anything the crew uses.
 */
const ALARM_TEST_MODE = false;

const REAL_CAPS: Record<DoorPhase, number | null> = {
  knocking: 120,       // 2 min — most doors are a 30s no-answer
  conversation: 300,   // 5 min — they opened and are engaged
  inspect: 900,        // qualifying pre-inspection: 5 + 10
  signing: 2100,       // post-signature full inspection: 5 + 30
  exempt: null,        // contract signing / claim filing — never interrupt
};

const TEST_CAPS: Record<DoorPhase, number | null> = {
  knocking: 10,
  conversation: 10,    // the one that arms on "Yes — door opened"
  inspect: 20,         // proves +10 Inspect re-arms rather than double-firing
  signing: 30,
  exempt: null,        // must stay silent even in test mode
};

export const CAP_SECONDS: Record<DoorPhase, number | null> =
  ALARM_TEST_MODE ? TEST_CAPS : REAL_CAPS;

export const PHASE_LABEL: Record<DoorPhase, string> = {
  knocking: 'Knocking',
  conversation: 'Talking',
  inspect: 'Pre-inspect',
  signing: 'Signing',
  exempt: 'Exempt',
};

/** Minutes from local midnight for `d`. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Minutes of shift left today: the remainder of the window you're inside, plus
 * every window still ahead. Returns 0 when the day's windows are done.
 */
export function remainingShiftMinutes(
  now: Date = new Date(),
  shifts: ShiftWindow[] = DEFAULT_SHIFTS
): number {
  const t = minutesOfDay(now);
  let total = 0;
  for (const w of shifts) {
    if (t >= w.endMin) continue;              // window already past
    total += t <= w.startMin
      ? w.endMin - w.startMin                 // hasn't started — count it whole
      : w.endMin - t;                         // mid-window — count the remainder
  }
  return Math.max(0, total);
}

/** True when `now` falls inside any configured window. */
export function isOnShift(
  now: Date = new Date(),
  shifts: ShiftWindow[] = DEFAULT_SHIFTS
): boolean {
  const t = minutesOfDay(now);
  return shifts.some(w => t >= w.startMin && t < w.endMin);
}

/**
 * Minutes affordable per remaining door.
 * null when there's nothing meaningful to divide — goal already met, or the
 * shift is over. Callers render "off shift" / "goal met", never a number.
 */
export function doorBudgetMinutes(
  doorsRemaining: number,
  minutesRemaining: number
): number | null {
  if (doorsRemaining <= 0) return null;       // goal met — stop nagging
  if (minutesRemaining <= 0) return null;     // off shift — no budget to spend
  return minutesRemaining / doorsRemaining;
}

export type PaceBand = 'green' | 'amber' | 'red';

/**
 * Band the budget for color. Thresholds are about what a door actually costs:
 * a no-answer is ~30s, an engaged conversation ~3min. Under 1.5 min/door and
 * you cannot afford to talk to anyone — that's red.
 */
export function paceBand(budgetMinutes: number | null): PaceBand {
  if (budgetMinutes === null) return 'green';
  if (budgetMinutes >= 3) return 'green';
  if (budgetMinutes >= 1.5) return 'amber';
  return 'red';
}

export const PACE_COLOR: Record<PaceBand, string> = {
  green: '#16a34a',
  amber: '#d97706',
  red: '#dc2626',
};

/** "2h10m" / "45m" — compact shift-remaining display. */
export function formatMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** "4:07" — elapsed seconds as MM:SS. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "H:MM am/pm" for the shift editor. */
export function formatClock(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}
