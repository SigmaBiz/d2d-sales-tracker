/**
 * POST /api/calendar/book
 * { knockId, startISO, endISO, attendeeEmail?, address?, contactName?, notes? }
 *
 * Creates the inspection event on the owner's calendar and — when an attendee
 * email is supplied — has Google send the homeowner a real invite they can
 * accept, which is what blocks THEIR calendar. Persists the event id on the
 * knock so a later reschedule can move the event instead of orphaning it.
 *
 * Booking is best-effort by design: the lead lifecycle transition is the source
 * of truth and happens client-side regardless. If Google fails here we report it
 * without pretending the appointment doesn't exist.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthedActor, getServiceClient } from '../_lib/auth';
import { createEvent, calendarConfigured } from '../_lib/googleCalendar';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const actor = await getAuthedActor(req as any);
  if (!actor) return res.status(401).json({ error: 'Not authenticated' });

  const { knockId, startISO, endISO, attendeeEmail, address, contactName, notes } =
    (req.body ?? {}) as Record<string, string | undefined>;

  if (!knockId || !startISO || !endISO) {
    return res.status(400).json({ error: 'knockId, startISO and endISO are required' });
  }
  if (!calendarConfigured()) {
    return res.status(503).json({ configured: false, error: 'calendar_not_configured' });
  }

  const where = address || 'Address on file';
  const who = contactName ? ` — ${contactName}` : '';

  let event: { eventId: string; htmlLink: string };
  try {
    event = await createEvent({
      startISO,
      endISO,
      summary: `Roof inspection${who}`,
      location: address,
      description: [
        `Free roof inspection at ${where}.`,
        contactName ? `Homeowner: ${contactName}` : null,
        notes ? `Notes: ${notes}` : null,
        '',
        'Booked from D2D Sales Tracker.',
      ].filter(Boolean).join('\n'),
      attendeeEmail: attendeeEmail || undefined,
    });
  } catch (err: any) {
    const detail = err?.response?.data?.error?.message ?? err?.message;
    console.error('[calendar/book] createEvent failed:', detail);
    return res.status(502).json({ error: 'calendar_create_failed', detail });
  }

  // Persist so reschedule/cancel can move this exact event later. A failure here
  // must not fail the request — the event exists and the homeowner has the
  // invite; losing the id costs us a future update, not the appointment.
  try {
    const supabase = getServiceClient();
    const { error } = await supabase
      .from('knocks')
      .update({ calendar_event_id: event.eventId })
      .eq('id', knockId);
    if (error) console.warn('[calendar/book] could not store event id:', error.message);
  } catch (err: any) {
    console.warn('[calendar/book] could not store event id:', err?.message);
  }

  return res.status(200).json({ ok: true, ...event });
}
