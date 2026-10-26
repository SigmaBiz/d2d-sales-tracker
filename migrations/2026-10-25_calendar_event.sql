-- 2026-10-25: remember which Google Calendar event backs an appointment.
--
-- Without this, a reschedule creates a SECOND calendar event and leaves the
-- original sitting on the calendar — which reintroduces exactly the
-- double-booking this feature exists to prevent.
--
-- PASTE IN SUPABASE SQL EDITOR. Safe before or after the deploy: booking still
-- works without the column (the server logs a warning and carries on), it just
-- can't move the event later.

ALTER TABLE knocks ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;

-- Verify.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'knocks' AND column_name = 'calendar_event_id';
