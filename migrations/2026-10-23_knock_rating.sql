-- 2026-10-23: per-door star rating (owner request).
-- 0–5 in HALF steps, nullable. Feeds the Revisit tab's ranking in the Lead Log,
-- alongside the door's note — two independent signals for "is this worth a
-- second trip".
-- PASTE IN SUPABASE SQL EDITOR **BEFORE** the app update ships — until this
-- runs, saving a rating fails and the app reports "Failed to save knock".

ALTER TABLE knocks ADD COLUMN IF NOT EXISTS rating numeric(2,1);

-- Half-step guard: rating*2 must be a whole number, so 3.5 passes and 3.7 does not.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knocks_rating_chk'
  ) THEN
    ALTER TABLE knocks ADD CONSTRAINT knocks_rating_chk CHECK (
      rating IS NULL OR (
        rating >= 0 AND rating <= 5 AND (rating * 2) = trunc(rating * 2)
      )
    );
  END IF;
END $$;

-- Ranked reads of the revisit queue hit this constantly; partial index keeps it
-- cheap without indexing every door in the table.
CREATE INDEX IF NOT EXISTS knocks_revisit_rating_idx
  ON knocks (rating DESC NULLS LAST)
  WHERE label = 'revisit';

-- Verify: expect the rating column plus the half-step CHECK.
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'knocks' AND column_name = 'rating';

SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'knocks_rating_chk';
