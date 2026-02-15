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
  ('monstera', 'Монстера', 'Яркий рассеянный', '1-2 раза в неделю', 'Средняя', '/assets/catalog/monstera.svg'),
  ('sansevieria', 'Сансевиерия', 'От тени до яркого', 'Раз в 2-3 недели', 'Низкая', '/assets/catalog/sansevieria.svg'),
  ('spathiphyllum', 'Спатифиллум', 'Полутень', 'Регулярно, не пересушивать', 'Средняя', '/assets/catalog/spathiphyllum.svg'),
  ('zamioculcas', 'Замиокулькас', 'Полутень', 'Раз в 2-3 недели', 'Низкая', '/assets/catalog/zamioculcas.svg'),
  ('calathea', 'Калатея', 'Яркий рассеянный', 'Часто, мягкая вода', 'Высокая', '/assets/catalog/calathea.svg'),
  ('ficus', 'Фикус Бенджамина', 'Яркий рассеянный', '1 раз в неделю', 'Средняя', '/assets/catalog/ficus.svg'),
  ('chlorophytum', 'Хлорофитум', 'Полутень', '1 раз в неделю', 'Низкая', '/assets/catalog/chlorophytum.svg'),
  ('violet', 'Фиалка (сенполия)', 'Яркий рассеянный', 'Умеренно, теплой водой', 'Средняя', '/assets/catalog/violet.svg')
ON CONFLICT (id) DO NOTHING;
