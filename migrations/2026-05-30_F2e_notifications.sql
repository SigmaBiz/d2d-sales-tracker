-- ============================================================================
-- F2e — In-app notifications feed (the bell)
-- Run in Supabase dashboard → SQL Editor. Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,   -- recipient
  team_id UUID REFERENCES teams,
  type TEXT NOT NULL,             -- lead_update | lead_reminder | nudge | hail
  urgent BOOLEAN DEFAULT FALSE,   -- drives the bell shake + buzz
  title TEXT,
  body TEXT,
  knock_id UUID,                  -- tap → teleport when present (nullable; hail has none)
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  data JSONB,                     -- echo of the push payload (status, kind, ...)
  read_at TIMESTAMPTZ,            -- NULL = unread
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications (user_id, created_at DESC);

-- RLS — recipient reads + marks-read their own rows; writes are service-role only
-- (the API endpoints insert via the service key, bypassing RLS).
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications' AND policyname='notif_select') THEN
    CREATE POLICY notif_select ON notifications
      FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications' AND policyname='notif_update') THEN
    CREATE POLICY notif_update ON notifications
      FOR UPDATE USING (user_id = auth.uid());
  END IF;
END $$;
