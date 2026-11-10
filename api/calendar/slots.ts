/**
 * GET /api/calendar/slots?days=7&slotMinutes=60&dayStart=9&dayEnd=19
 *
 * Candidate appointment slots inside the daily window, minus anything already
 * busy on the owner's calendar. This is what makes the doorstep pitch concrete:
 * the canvasser reads real openings off the screen instead of guessing a time
 * and discovering the clash later.
 *
 * Returns 503 with `configured:false` when the Google env vars are absent, so
 * the client can fall back to the manual picker rather than treating it as a
 * hard failure — being unable to book because the integration is down is worse
 * than booking without conflict-checking.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthedActor } from '../_lib/auth';
import { freeBusy, calendarConfigured } from '../_lib/googleCalendar';

const MAX_DAYS = 14;

function num(v: unknown, dflt: number): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : dflt;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const actor = await getAuthedActor(req as any);
  if (!actor) return res.status(401).json({ error: 'Not authenticated' });

  if (!calendarConfigured()) {
    // Not an error — the client falls back to the manual time picker.
    return res.status(503).json({ configured: false, slots: [] });
  }

  const days = Math.min(MAX_DAYS, Math.max(1, num(req.query.days, 7)));
  const slotMinutes = Math.min(240, Math.max(15, num(req.query.slotMinutes, 60)));
  const dayStart = Math.min(23, Math.max(0, num(req.query.dayStart, 9)));
  const dayEnd = Math.min(24, Math.max(dayStart + 1, num(req.query.dayEnd, 19)));

  const now = new Date();
  const windowStart = new Date(now.getTime());
  const windowEnd = new Date(now.getTime() + days * 86_400_000);

  let busy: { start: string; end: string }[] = [];
  try {
    busy = await freeBusy(windowStart.toISOString(), windowEnd.toISOString());
  } catch (err: any) {
    console.error('[calendar/slots] freeBusy failed:', err?.message);
    // Same contract as unconfigured: let the client degrade gracefully.
    return res.status(503).json({ configured: false, slots: [], error: 'calendar_unavailable' });
  }

  const busyRanges = busy.map(b => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
  }));
  const overlapsBusy = (s: number, e: number) =>
    busyRanges.some(b => s < b.end && e > b.start);

  const slots: { startISO: string; endISO: string }[] = [];
  const slotMs = slotMinutes * 60_000;

  for (let d = 0; d < days; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    // setHours (not ms arithmetic) so DST transitions don't shift the window —
    // same rule the analytics/pacing date code follows.
    day.setHours(dayStart, 0, 0, 0);
    const end = new Date(day);
    end.setHours(dayEnd, 0, 0, 0);

    for (let t = day.getTime(); t + slotMs <= end.getTime(); t += slotMs) {
      if (t <= now.getTime()) continue;        // never offer a slot in the past
      if (overlapsBusy(t, t + slotMs)) continue;
      slots.push({
        startISO: new Date(t).toISOString(),
        endISO: new Date(t + slotMs).toISOString(),
      });
    }
  }

  // `busy` is the authoritative payload: absolute instants, no timezone
  // assumptions. The server runs in UTC, so building the 8am-6pm grid HERE
  // produced slots in UTC-local time — which surfaced as 2am-11am for a
  // US-Central user. The CLIENT owns that math now; it knows the device
  // timezone and DST. `slots` stays only so an older client build keeps working.
  return res.status(200).json({
    configured: true,
    busy,
    slots,
    busyCount: busyRanges.length,
  });
}
