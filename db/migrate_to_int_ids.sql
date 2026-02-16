BEGIN;

ALTER TABLE IF EXISTS plant_covers RENAME TO plant_covers_old;
ALTER TABLE IF EXISTS plant_photos RENAME TO plant_photos_old;
ALTER TABLE IF EXISTS events RENAME TO events_old;
ALTER TABLE IF EXISTS collection RENAME TO collection_old;
ALTER TABLE IF EXISTS catalog_plants RENAME TO catalog_plants_old;

CREATE TABLE catalog_plants (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  light TEXT NOT NULL,
  water TEXT NOT NULL,
  fussiness TEXT NOT NULL,
  image TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE collection (
  plant_id INTEGER PRIMARY KEY REFERENCES catalog_plants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  plant_id INTEGER NOT NULL REFERENCES catalog_plants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('watered', 'repotted', 'fertilized')),
  event_date DATE NOT NULL,
  fertilizer TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((event_type != 'fertilized') OR (length(trim(fertilizer)) > 0))
);

CREATE TABLE plant_photos (
  id BIGSERIAL PRIMARY KEY,
  plant_id INTEGER NOT NULL REFERENCES catalog_plants(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  taken_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE plant_covers (
  plant_id INTEGER PRIMARY KEY REFERENCES catalog_plants(id) ON DELETE CASCADE,
  photo_id BIGINT NOT NULL REFERENCES plant_photos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events (event_date);
CREATE INDEX IF NOT EXISTS idx_events_plant ON events (plant_id);
CREATE INDEX IF NOT EXISTS idx_photos_plant ON plant_photos (plant_id);

INSERT INTO catalog_plants (slug, name, light, water, fussiness, image, created_at)
SELECT id, name, light, water, fussiness, image, created_at
FROM catalog_plants_old;

INSERT INTO collection (plant_id, created_at)
SELECT p.id, c.created_at
FROM collection_old c
JOIN catalog_plants p ON p.slug = c.plant_id;

INSERT INTO events (plant_id, event_type, event_date, fertilizer, notes, created_at)
SELECT p.id, e.event_type, e.event_date, e.fertilizer, e.notes, e.created_at
FROM events_old e
JOIN catalog_plants p ON p.slug = e.plant_id;

INSERT INTO plant_photos (plant_id, image_url, taken_at, created_at)
SELECT p.id, ph.image_url, ph.taken_at, ph.created_at
FROM plant_photos_old ph
JOIN catalog_plants p ON p.slug = ph.plant_id;

DROP TABLE IF EXISTS plant_covers_old;
DROP TABLE IF EXISTS plant_photos_old;
DROP TABLE IF EXISTS events_old;
DROP TABLE IF EXISTS collection_old;
DROP TABLE IF EXISTS catalog_plants_old;

COMMIT;
