-- ============================================================================
-- F2c — Scheduled-inspection lifecycle
-- Run in Supabase dashboard → SQL Editor. Safe to run once / idempotent.
-- ============================================================================

-- 1) Current scheduled time on the knock (the live appointment for this cycle)
ALTER TABLE knocks ADD COLUMN IF NOT EXISTS appointment_at TIMESTAMPTZ;

-- 2) Precomputed reminder rows — one per (lead, offset). The cron sweeps these by
--    fire_at; no date math in the poller. Canceled on confirm/arch/reschedule.
CREATE TABLE IF NOT EXISTS scheduled_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knock_id UUID REFERENCES knocks NOT NULL,
  runner_user_id UUID REFERENCES auth.users NOT NULL, -- recipient (team owner)
  team_id UUID REFERENCES teams,
  appointment_at TIMESTAMPTZ NOT NULL,
  fire_at TIMESTAMPTZ NOT NULL,        -- when this reminder is due
  kind TEXT NOT NULL,                  -- 'scheduled' | '2d' | '1d' | '2h'
  sent_at TIMESTAMPTZ,                 -- NULL = pending
  canceled_at TIMESTAMPTZ,             -- set on confirm/arch_*/reschedule
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast "what's due?" sweep for the cron (only pending, uncanceled rows).
CREATE INDEX IF NOT EXISTS scheduled_reminders_due_idx
  ON scheduled_reminders (fire_at)
  WHERE sent_at IS NULL AND canceled_at IS NULL;

CREATE INDEX IF NOT EXISTS scheduled_reminders_knock_idx
  ON scheduled_reminders (knock_id);

-- 3) RLS — runner reads own reminders; owner reads team's (mirror lead_events).
--    Writes go through the service-role key (cron + transition endpoint), so no
--    INSERT/UPDATE policies — the server is the only writer.
ALTER TABLE scheduled_reminders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='scheduled_reminders' AND policyname='reminders_runner_select') THEN
    CREATE POLICY reminders_runner_select ON scheduled_reminders
      FOR SELECT USING (runner_user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='scheduled_reminders' AND policyname='reminders_owner_select') THEN
    CREATE POLICY reminders_owner_select ON scheduled_reminders
      FOR SELECT USING (team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));
  END IF;
END $$;

-- 4) If you added a CHECK constraint on knocks.status earlier, widen it to include
--    'scheduled' (and the existing 'confirmed'). No-op if you never constrained status.
--    (status is free-text TEXT by default in the F2a migration, so nothing required here.)
