CREATE TABLE IF NOT EXISTS catalog_plants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  light TEXT NOT NULL,
  water TEXT NOT NULL,
  fussiness TEXT NOT NULL,
  image TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS plant_photos (
  id TEXT PRIMARY KEY,
  plant_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  taken_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events (event_date);
CREATE INDEX IF NOT EXISTS idx_events_plant ON events (plant_id);
CREATE INDEX IF NOT EXISTS idx_photos_plant ON plant_photos (plant_id);

INSERT INTO profiles (id, name)
VALUES (1, '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalog_plants (id, name, light, water, fussiness, image)
VALUES
  ('monstera', 'Монстера', 'Яркий рассеянный', '1-2 раза в неделю', 'Средняя', 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=800&q=60'),
  ('sansevieria', 'Сансевиерия', 'От тени до яркого', 'Раз в 2-3 недели', 'Низкая', 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=800&q=60'),
  ('spathiphyllum', 'Спатифиллум', 'Полутень', 'Регулярно, не пересушивать', 'Средняя', 'https://images.unsplash.com/photo-1446071103084-c257b5f70672?auto=format&fit=crop&w=800&q=60'),
  ('zamioculcas', 'Замиокулькас', 'Полутень', 'Раз в 2-3 недели', 'Низкая', 'https://images.unsplash.com/photo-1465101046530-73398c7f28ca?auto=format&fit=crop&w=800&q=60'),
  ('calathea', 'Калатея', 'Яркий рассеянный', 'Часто, мягкая вода', 'Высокая', 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=800&q=60'),
  ('ficus', 'Фикус Бенджамина', 'Яркий рассеянный', '1 раз в неделю', 'Средняя', 'https://images.unsplash.com/photo-1471879832106-c7ab9e0cee23?auto=format&fit=crop&w=800&q=60'),
  ('chlorophytum', 'Хлорофитум', 'Полутень', '1 раз в неделю', 'Низкая', 'https://images.unsplash.com/photo-1495195134817-aeb325a55b65?auto=format&fit=crop&w=800&q=60'),
  ('violet', 'Фиалка (сенполия)', 'Яркий рассеянный', 'Умеренно, теплой водой', 'Средняя', 'https://images.unsplash.com/photo-1477554193778-9562c28588c3?auto=format&fit=crop&w=800&q=60')
ON CONFLICT (id) DO NOTHING;
