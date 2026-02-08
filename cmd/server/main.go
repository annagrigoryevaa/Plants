package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type Plant struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Light     string `json:"light"`
	Water     string `json:"water"`
	Fussiness string `json:"fussiness"`
	Image     string `json:"image"`
}

type Profile struct {
	Name string `json:"name"`
}

type Event struct {
	ID         string `json:"id"`
	PlantID    string `json:"plantId"`
	Type       string `json:"type"`
	Date       string `json:"date"`
	Fertilizer string `json:"fertilizer"`
	Notes      string `json:"notes"`
	CreatedAt  string `json:"createdAt"`
}

type App struct {
	db         *sql.DB
	catalog    []Plant
	plantIndex map[string]Plant
}

const (
	defaultPort      = "8080"
	isoDateLayout    = "2006-01-02"
	isoMonthLayout   = "2006-01"
	maxBodySizeBytes = 1 << 20
	dbTimeout        = 4 * time.Second
)

var (
	allowedEventTypes = map[string]bool{
		"watered":    true,
		"repotted":   true,
		"fertilized": true,
	}
	errNotFound = errors.New("not found")
)

func main() {
	app, err := newApp()
	if err != nil {
		log.Fatal(err)
	}
	defer app.db.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/catalog", app.handleCatalog)
	mux.HandleFunc("/api/profile", app.handleProfile)
	mux.HandleFunc("/api/collection", app.handleCollection)
	mux.HandleFunc("/api/collection/", app.handleCollectionItem)
	mux.HandleFunc("/api/events", app.handleEvents)
	mux.HandleFunc("/api/events/", app.handleEventItem)

	fileServer := http.FileServer(http.Dir("."))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.ServeFile(w, r, "index.html")
			return
		}
		fileServer.ServeHTTP(w, r)
	})

	server := &http.Server{
		Addr:         ":" + getenv("PORT", defaultPort),
		Handler:      withLogging(mux),
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	log.Printf("Plant care server running on http://localhost:%s", server.Addr[1:])
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func newApp() (*App, error) {
	catalog := defaultCatalog()
	plantIndex := make(map[string]Plant, len(catalog))
	for _, plant := range catalog {
		plantIndex[plant.ID] = plant
	}

	db, err := openDB()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), dbTimeout)
	defer cancel()
	if err := ensureSchema(ctx, db); err != nil {
		db.Close()
		return nil, err
	}

	return &App{
		db:         db,
		catalog:    catalog,
		plantIndex: plantIndex,
	}, nil
}

func (a *App) handleCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, r.Method, http.MethodGet)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]Plant{"catalog": a.catalog})
}

func (a *App) handleProfile(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		ctx, cancel := a.requestContext(r)
		defer cancel()
		profile, err := a.getProfile(ctx)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, profile)
	case http.MethodPut:
		var input Profile
		if err := decodeJSON(w, r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		ctx, cancel := a.requestContext(r)
		defer cancel()
		profile, err := a.updateProfile(ctx, strings.TrimSpace(input.Name))
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, profile)
	default:
		methodNotAllowed(w, r.Method, http.MethodGet, http.MethodPut)
	}
}

func (a *App) handleCollection(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/collection" {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		ctx, cancel := a.requestContext(r)
		defer cancel()
		collection, err := a.listCollection(ctx)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string][]string{"collection": collection})
	case http.MethodPost:
		var input struct {
			PlantID string `json:"plantId"`
		}
		if err := decodeJSON(w, r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		plantID := strings.TrimSpace(input.PlantID)
		if plantID == "" {
			writeError(w, http.StatusBadRequest, "plantId обязателен")
			return
		}
		if _, ok := a.plantIndex[plantID]; !ok {
			writeError(w, http.StatusBadRequest, "неизвестное растение")
			return
		}
		ctx, cancel := a.requestContext(r)
		defer cancel()
		collection, err := a.addToCollection(ctx, plantID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string][]string{"collection": collection})
	default:
		methodNotAllowed(w, r.Method, http.MethodGet, http.MethodPost)
	}
}

func (a *App) handleCollectionItem(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/api/collection/") {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, r.Method, http.MethodDelete)
		return
	}
	plantID := strings.TrimPrefix(r.URL.Path, "/api/collection/")
	plantID = strings.TrimSpace(plantID)
	if plantID == "" {
		writeError(w, http.StatusBadRequest, "plantId обязателен")
		return
	}
	ctx, cancel := a.requestContext(r)
	defer cancel()
	collection, err := a.removeFromCollection(ctx, plantID)
	if err != nil {
		if errors.Is(err, errNotFound) {
			writeError(w, http.StatusNotFound, "растение не найдено в коллекции")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string][]string{"collection": collection})
}

func (a *App) handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/events" {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		month := strings.TrimSpace(r.URL.Query().Get("month"))
		var monthStart, monthEnd time.Time
		var err error
		if month != "" {
			monthStart, monthEnd, err = monthRange(month)
			if err != nil {
				writeError(w, http.StatusBadRequest, "неверный формат месяца")
				return
			}
		}
		ctx, cancel := a.requestContext(r)
		defer cancel()
		events, err := a.listEvents(ctx, monthStart, monthEnd)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string][]Event{"events": events})
	case http.MethodPost:
		var input struct {
			PlantID    string `json:"plantId"`
			Type       string `json:"type"`
			Date       string `json:"date"`
			Fertilizer string `json:"fertilizer"`
			Notes      string `json:"notes"`
		}
		if err := decodeJSON(w, r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		input.PlantID = strings.TrimSpace(input.PlantID)
		input.Type = strings.TrimSpace(input.Type)
		input.Date = strings.TrimSpace(input.Date)
		input.Fertilizer = strings.TrimSpace(input.Fertilizer)
		input.Notes = strings.TrimSpace(input.Notes)

		if input.PlantID == "" {
			writeError(w, http.StatusBadRequest, "plantId обязателен")
			return
		}
		if _, ok := a.plantIndex[input.PlantID]; !ok {
			writeError(w, http.StatusBadRequest, "неизвестное растение")
			return
		}
		if !allowedEventTypes[input.Type] {
			writeError(w, http.StatusBadRequest, "неизвестный тип события")
			return
		}
		if input.Date == "" {
			writeError(w, http.StatusBadRequest, "date обязателен")
			return
		}
		eventDate, err := time.Parse(isoDateLayout, input.Date)
		if err != nil {
			writeError(w, http.StatusBadRequest, "неверный формат даты")
			return
		}
		if input.Type == "fertilized" && input.Fertilizer == "" {
			writeError(w, http.StatusBadRequest, "для подкормки требуется удобрение")
			return
		}

		ctx, cancel := a.requestContext(r)
		defer cancel()
		inCollection, err := a.isInCollection(ctx, input.PlantID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !inCollection {
			writeError(w, http.StatusBadRequest, "растение не в коллекции")
			return
		}
		event, err := a.createEvent(ctx, input.PlantID, input.Type, eventDate, input.Fertilizer, input.Notes)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, event)
	default:
		methodNotAllowed(w, r.Method, http.MethodGet, http.MethodPost)
	}
}

func (a *App) handleEventItem(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/api/events/") {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, r.Method, http.MethodDelete)
		return
	}
	eventID := strings.TrimPrefix(r.URL.Path, "/api/events/")
	eventID = strings.TrimSpace(eventID)
	if eventID == "" {
		writeError(w, http.StatusBadRequest, "id обязателен")
		return
	}
	ctx, cancel := a.requestContext(r)
	defer cancel()
	if err := a.deleteEvent(ctx, eventID); err != nil {
		if errors.Is(err, errNotFound) {
			writeError(w, http.StatusNotFound, "событие не найдено")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) requestContext(r *http.Request) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), dbTimeout)
}

func (a *App) getProfile(ctx context.Context) (Profile, error) {
	var name string
	err := a.db.QueryRowContext(ctx, "SELECT name FROM profiles WHERE id = 1").Scan(&name)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Profile{Name: ""}, nil
		}
		return Profile{}, err
	}
	return Profile{Name: name}, nil
}

func (a *App) updateProfile(ctx context.Context, name string) (Profile, error) {
	var updated string
	err := a.db.QueryRowContext(
		ctx,
		"INSERT INTO profiles (id, name) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING name",
		name,
	).Scan(&updated)
	if err != nil {
		return Profile{}, err
	}
	return Profile{Name: updated}, nil
}

func (a *App) listCollection(ctx context.Context) ([]string, error) {
	rows, err := a.db.QueryContext(ctx, "SELECT plant_id FROM collection ORDER BY created_at ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	collection := make([]string, 0)
	for rows.Next() {
		var plantID string
		if err := rows.Scan(&plantID); err != nil {
			return nil, err
		}
		if _, ok := a.plantIndex[plantID]; ok {
			collection = append(collection, plantID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return collection, nil
}

func (a *App) addToCollection(ctx context.Context, plantID string) ([]string, error) {
	if _, err := a.db.ExecContext(ctx, "INSERT INTO collection (plant_id) VALUES ($1) ON CONFLICT DO NOTHING", plantID); err != nil {
		return nil, err
	}
	return a.listCollection(ctx)
}

func (a *App) removeFromCollection(ctx context.Context, plantID string) ([]string, error) {
	result, err := a.db.ExecContext(ctx, "DELETE FROM collection WHERE plant_id = $1", plantID)
	if err != nil {
		return nil, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return nil, errNotFound
	}
	return a.listCollection(ctx)
}

func (a *App) isInCollection(ctx context.Context, plantID string) (bool, error) {
	var exists bool
	err := a.db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM collection WHERE plant_id = $1)", plantID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (a *App) listEvents(ctx context.Context, monthStart, monthEnd time.Time) ([]Event, error) {
	query := "SELECT id, plant_id, event_type, event_date, fertilizer, notes, created_at FROM events"
	args := []interface{}{}
	if !monthStart.IsZero() && !monthEnd.IsZero() {
		query += " WHERE event_date >= $1 AND event_date < $2"
		args = append(args, monthStart, monthEnd)
	}
	query += " ORDER BY created_at DESC"

	rows, err := a.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]Event, 0)
	for rows.Next() {
		var event Event
		var eventType string
		var eventDate time.Time
		var createdAt time.Time
		if err := rows.Scan(&event.ID, &event.PlantID, &eventType, &eventDate, &event.Fertilizer, &event.Notes, &createdAt); err != nil {
			return nil, err
		}
		event.Type = eventType
		event.Date = eventDate.Format(isoDateLayout)
		event.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func (a *App) createEvent(ctx context.Context, plantID, eventType string, eventDate time.Time, fertilizer, notes string) (Event, error) {
	event := Event{
		ID:         newID(),
		PlantID:    plantID,
		Type:       eventType,
		Date:       eventDate.Format(isoDateLayout),
		Fertilizer: fertilizer,
		Notes:      notes,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	createdAt, err := time.Parse(time.RFC3339, event.CreatedAt)
	if err != nil {
		createdAt = time.Now().UTC()
		event.CreatedAt = createdAt.Format(time.RFC3339)
	}
	_, err = a.db.ExecContext(
		ctx,
		"INSERT INTO events (id, plant_id, event_type, event_date, fertilizer, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
		event.ID,
		event.PlantID,
		event.Type,
		eventDate,
		event.Fertilizer,
		event.Notes,
		createdAt,
	)
	if err != nil {
		return Event{}, err
	}
	return event, nil
}

func (a *App) deleteEvent(ctx context.Context, eventID string) error {
	result, err := a.db.ExecContext(ctx, "DELETE FROM events WHERE id = $1", eventID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return errNotFound
	}
	return nil
}

func openDB() (*sql.DB, error) {
	dsn := getDatabaseURL()
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), dbTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func getDatabaseURL() string {
	if value := strings.TrimSpace(os.Getenv("DATABASE_URL")); value != "" {
		return value
	}
	host := getenv("DB_HOST", "localhost")
	port := getenv("DB_PORT", "5432")
	user := getenv("DB_USER", "plants")
	password := getenv("DB_PASSWORD", "plants")
	name := getenv("DB_NAME", "plants")
	sslmode := getenv("DB_SSLMODE", "disable")

	u := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(user, password),
		Host:   fmt.Sprintf("%s:%s", host, port),
		Path:   name,
	}
	query := u.Query()
	query.Set("sslmode", sslmode)
	u.RawQuery = query.Encode()
	return u.String()
}

func ensureSchema(ctx context.Context, db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS profiles (
			id SMALLINT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS collection (
			plant_id TEXT PRIMARY KEY,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS events (
			id TEXT PRIMARY KEY,
			plant_id TEXT NOT NULL,
			event_type TEXT NOT NULL CHECK (event_type IN ('watered', 'repotted', 'fertilized')),
			event_date DATE NOT NULL,
			fertilizer TEXT NOT NULL DEFAULT '',
			notes TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			CHECK ((event_type != 'fertilized') OR (length(trim(fertilizer)) > 0))
		)`,
		`CREATE INDEX IF NOT EXISTS idx_events_date ON events (event_date)`,
		`INSERT INTO profiles (id, name) VALUES (1, '') ON CONFLICT (id) DO NOTHING`,
	}
	for _, stmt := range statements {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func monthRange(month string) (time.Time, time.Time, error) {
	start, err := time.Parse(isoMonthLayout, month)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	end := start.AddDate(0, 1, 0)
	return start, end, nil
}

func defaultCatalog() []Plant {
	return []Plant{
		{
			ID:        "monstera",
			Name:      "Монстера",
			Light:     "Яркий рассеянный",
			Water:     "1-2 раза в неделю",
			Fussiness: "Средняя",
			Image:     "https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=800&q=60",
		},
		{
			ID:        "sansevieria",
			Name:      "Сансевиерия",
			Light:     "От тени до яркого",
			Water:     "Раз в 2-3 недели",
			Fussiness: "Низкая",
			Image:     "https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=800&q=60",
		},
		{
			ID:        "spathiphyllum",
			Name:      "Спатифиллум",
			Light:     "Полутень",
			Water:     "Регулярно, не пересушивать",
			Fussiness: "Средняя",
			Image:     "https://images.unsplash.com/photo-1446071103084-c257b5f70672?auto=format&fit=crop&w=800&q=60",
		},
		{
			ID:        "zamioculcas",
			Name:      "Замиокулькас",
			Light:     "Полутень",
			Water:     "Раз в 2-3 недели",
			Fussiness: "Низкая",
			Image:     "https://images.unsplash.com/photo-1465101046530-73398c7f28ca?auto=format&fit=crop&w=800&q=60",
		},
		{
			ID:        "calathea",
			Name:      "Калатея",
			Light:     "Яркий рассеянный",
			Water:     "Часто, мягкая вода",
			Fussiness: "Высокая",
			Image:     "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=800&q=60",
		},
		{
			ID:        "ficus",
			Name:      "Фикус Бенджамина",
			Light:     "Яркий рассеянный",
			Water:     "1 раз в неделю",
			Fussiness: "Средняя",
			Image:     "https://images.unsplash.com/photo-1471879832106-c7ab9e0cee23?auto=format&fit=crop&w=800&q=60",
		},
		{
			ID:        "chlorophytum",
			Name:      "Хлорофитум",
			Light:     "Полутень",
			Water:     "1 раз в неделю",
			Fussiness: "Низкая",
			Image:     "https://images.unsplash.com/photo-1495195134817-aeb325a55b65?auto=format&fit=crop&w=800&q=60",
		},
		{
			ID:        "violet",
			Name:      "Фиалка (сенполия)",
			Light:     "Яркий рассеянный",
			Water:     "Умеренно, теплой водой",
			Fussiness: "Средняя",
			Image:     "https://images.unsplash.com/photo-1477554193778-9562c28588c3?auto=format&fit=crop&w=800&q=60",
		},
	}
}

func newID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err == nil {
		return hex.EncodeToString(buf)
	}
	return fmt.Sprintf("event-%d", time.Now().UnixNano())
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target interface{}) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodySizeBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("ошибка чтения JSON: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("тело запроса должно содержать один JSON-объект")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		log.Printf("failed to write JSON response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func methodNotAllowed(w http.ResponseWriter, method string, allowed ...string) {
	w.Header().Set("Allow", strings.Join(allowed, ", "))
	writeError(w, http.StatusMethodNotAllowed, fmt.Sprintf("метод %s не поддерживается", method))
}

func getenv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}
