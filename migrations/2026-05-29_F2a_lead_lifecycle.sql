-- ============================================================================
-- F2a Foundations — Lead Lifecycle data model
-- Run in Supabase dashboard → SQL Editor. Safe to run once.
-- Two-axis model: knocks.label (stable pin) + knocks.status (inspection lifecycle).
-- ============================================================================

-- 1) Lifecycle fields on knocks (current cycle lives here; history in tables below)
ALTER TABLE knocks ADD COLUMN IF NOT EXISTS service_type TEXT;   -- live | scheduled | repair
ALTER TABLE knocks ADD COLUMN IF NOT EXISTS status       TEXT;   -- LeadStatus; NULL = not in a flow
ALTER TABLE knocks ADD COLUMN IF NOT EXISTS cycle_number INT DEFAULT 1;
ALTER TABLE knocks ADD COLUMN IF NOT EXISTS date_of_loss DATE;

-- Optional guards (uncomment if you want DB-level enforcement of enum values):
-- ALTER TABLE knocks ADD CONSTRAINT knocks_service_type_chk
--   CHECK (service_type IS NULL OR service_type IN ('live','scheduled','repair'));
-- ALTER TABLE knocks ADD CONSTRAINT knocks_status_chk
--   CHECK (status IS NULL OR status IN
--     ('pinged','confirmed','completed','processing','signed','arch_soft','arch_hard','retarget'));

-- 2) Expand the label CHECK to allow the new runner outcomes: flaked, retarget.
--    The constraint name isn't known here, so find the check constraint on `knocks`
--    that references the label values, drop it, and re-add with the full set.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  WHERE c.conrelid = 'knocks'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%no_home%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE knocks DROP CONSTRAINT %I', con_name);
  END IF;

  ALTER TABLE knocks ADD CONSTRAINT knocks_label_chk CHECK (label IN (
    'no_home','not_interested','no_soliciting','renter','conversation',
    'inspected','signed','follow_up','lead','scout','flaked','retarget'
  ));
END $$;

-- 3) Append-only audit = the Log feed AND the pay source
CREATE TABLE IF NOT EXISTS lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knock_id UUID REFERENCES knocks NOT NULL,
  cycle_number INT NOT NULL DEFAULT 1,
  actor_user_id UUID REFERENCES auth.users NOT NULL,
  actor_role TEXT,                  -- owner | member at time of action
  action TEXT NOT NULL,             -- ping, confirm, complete, processing, signed,
                                    -- arch_soft, arch_hard, retarget, revive, nudge
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  team_id UUID REFERENCES teams,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lead_events_knock_idx ON lead_events (knock_id, created_at);
CREATE INDEX IF NOT EXISTS lead_events_team_idx  ON lead_events (team_id, created_at);

-- 4) One row per (knock, cycle): collapsed history + cycle gating (one override/cycle)
CREATE TABLE IF NOT EXISTS lead_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knock_id UUID REFERENCES knocks NOT NULL,
  cycle_number INT NOT NULL,
  date_of_loss DATE,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  final_status TEXT,
  override_used BOOLEAN DEFAULT FALSE,
  summary TEXT,
  team_id UUID REFERENCES teams,
  UNIQUE (knock_id, cycle_number)
);

-- 5) Team-wide default date of loss (device default also cached in StorageService)
ALTER TABLE teams ADD COLUMN IF NOT EXISTS default_date_of_loss DATE;

-- 6) RLS — actor sees own rows; team owner sees the team's rows (mirror knocks/ping_log)
ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_cycles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- lead_events: actor reads their own events
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_events' AND policyname='lead_events_actor_select') THEN
    CREATE POLICY lead_events_actor_select ON lead_events
      FOR SELECT USING (actor_user_id = auth.uid());
  END IF;
  -- lead_events: team owner reads the team's events
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_events' AND policyname='lead_events_owner_select') THEN
    CREATE POLICY lead_events_owner_select ON lead_events
      FOR SELECT USING (team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));
  END IF;

  -- lead_cycles: team members + owner read the team's cycles
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_cycles' AND policyname='lead_cycles_team_select') THEN
    CREATE POLICY lead_cycles_team_select ON lead_cycles
      FOR SELECT USING (
        team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- NOTE: writes to lead_events / lead_cycles go through the service-role key in
-- Vercel endpoints (F2b+), which bypasses RLS — so no INSERT policies are defined
-- here on purpose. The state machine is the only writer.
