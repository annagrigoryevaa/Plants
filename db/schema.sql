CREATE TABLE IF NOT EXISTS profiles (
  id SMALLINT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS collection (
  plant_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  plant_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('watered', 'repotted', 'fertilized')),
  event_date DATE NOT NULL,
  fertilizer TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((event_type != 'fertilized') OR (length(trim(fertilizer)) > 0))
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events (event_date);

INSERT INTO profiles (id, name)
VALUES (1, '')
ON CONFLICT (id) DO NOTHING;
