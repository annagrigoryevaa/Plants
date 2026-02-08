# Plants

Одностраничное приложение для ухода за домашними растениями:

- Справочник растений с фото и краткими рекомендациями по уходу.
- Личный профиль с коллекцией своих растений.
- Календарь ухода: полив, пересадка, подкормка с указанием удобрения.

## Как запустить

Требуется Go (1.24+), PostgreSQL 16+. Удобнее всего поднять БД через Docker:

```bash
docker compose up -d
```

Запуск сервера:

```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=plants
export DB_PASSWORD=plants
export DB_NAME=plants
export DB_SSLMODE=disable

go run ./cmd/server
```

После старта откройте в браузере:

```
http://localhost:8080
```

### Доступ к базе данных

Подключиться можно напрямую:

```bash
psql "postgres://plants:plants@localhost:5432/plants?sslmode=disable"
```

Схема описана в `db/schema.sql`, можно использовать ее для ручного редактирования.

### Переменные окружения

- `PORT` — порт сервера (по умолчанию 8080).
- `DATABASE_URL` — полная строка подключения к PostgreSQL.
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSLMODE` — параметры подключения.
