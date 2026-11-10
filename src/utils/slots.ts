/**
 * Appointment slot grid — pure, no I/O (same pattern as analytics.ts / pacing.ts).
 *
 * Lives outside the component so it can be exercised directly: the timezone bug
 * this fixes was invisible until the grid could be inspected in isolation.
 */

export interface Slot { startISO: string; endISO: string }
export interface BusyInterval { start: string; end: string }

/** Booking window, in DEVICE-LOCAL time. Owner's hours: 8am-6pm, 30-min blocks. */
const DAY_START = 8;
const DAY_END = 18;
const STEP_MIN = 30;
const DAYS = 7;

/**
 * Build the local slot grid, minus anything busy.
 *
 * Deliberately CLIENT-SIDE. The server runs in UTC, so doing this there made
 * `setHours(8)` mean 8am UTC — which rendered as 2am for a US-Central user.
 * Only the device knows its own timezone and DST, so the grid is built here and
 * the server contributes nothing but absolute busy instants.
 *
 * setHours (not ms arithmetic) so a DST boundary shifts the window correctly —
 * same rule the pacing/analytics date code follows.
 */
export function buildLocalSlots(
  busy: BusyInterval[],
  days = DAYS,
  now: Date = new Date()
): Slot[] {
  const ranges = busy.map(b => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
  }));
  const overlaps = (s: number, e: number) =>
    ranges.some(r => s < r.end && e > r.start);

  const stepMs = STEP_MIN * 60_000;
  const out: Slot[] = [];

  for (let d = 0; d < days; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    day.setHours(DAY_START, 0, 0, 0);
    const end = new Date(day);
    end.setHours(DAY_END, 0, 0, 0);

    for (let t = day.getTime(); t + stepMs <= end.getTime(); t += stepMs) {
      if (t <= now.getTime()) continue;       // never offer a past slot
      if (overlaps(t, t + stepMs)) continue;
      out.push({
        startISO: new Date(t).toISOString(),
        endISO: new Date(t + stepMs).toISOString(),
      });
    }
  }
  return out;
}

