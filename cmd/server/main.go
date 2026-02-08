package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
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

type Store struct {
	Profile    Profile  `json:"profile"`
	Collection []string `json:"collection"`
	Events     []Event  `json:"events"`
}

type App struct {
	mu         sync.RWMutex
	store      Store
	storePath  string
	catalog    []Plant
	plantIndex map[string]Plant
}

const (
	defaultPort      = "8080"
	isoDateLayout    = "2006-01-02"
	isoMonthLayout   = "2006-01"
	maxBodySizeBytes = 1 << 20
)

var allowedEventTypes = map[string]bool{
	"watered":    true,
	"repotted":   true,
	"fertilized": true,
}

func main() {
	app, err := newApp()
	if err != nil {
		log.Fatal(err)
	}

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

	storePath := getenv("STORE_PATH", filepath.Join("data", "store.json"))
	store, err := loadStore(storePath)
	if err != nil {
		return nil, err
	}
	store.Collection = filterCollection(store.Collection, plantIndex)

	return &App{
		store:      store,
		storePath:  storePath,
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
		a.mu.RLock()
		profile := a.store.Profile
		a.mu.RUnlock()
		writeJSON(w, http.StatusOK, profile)
	case http.MethodPut:
		var input Profile
		if err := decodeJSON(w, r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		a.mu.Lock()
		a.store.Profile = Profile{Name: strings.TrimSpace(input.Name)}
		if err := a.saveStoreLocked(); err != nil {
			a.mu.Unlock()
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		profile := a.store.Profile
		a.mu.Unlock()
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
		a.mu.RLock()
		collection := append([]string(nil), a.store.Collection...)
		a.mu.RUnlock()
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
		a.mu.Lock()
		if !containsString(a.store.Collection, plantID) {
			a.store.Collection = append(a.store.Collection, plantID)
		}
		if err := a.saveStoreLocked(); err != nil {
			a.mu.Unlock()
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		collection := append([]string(nil), a.store.Collection...)
		a.mu.Unlock()
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

	a.mu.Lock()
	if !containsString(a.store.Collection, plantID) {
		a.mu.Unlock()
		writeError(w, http.StatusNotFound, "растение не найдено в коллекции")
		return
	}
	a.store.Collection = removeString(a.store.Collection, plantID)
	if err := a.saveStoreLocked(); err != nil {
		a.mu.Unlock()
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	collection := append([]string(nil), a.store.Collection...)
	a.mu.Unlock()
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
		a.mu.RLock()
		events := append([]Event(nil), a.store.Events...)
		a.mu.RUnlock()
		if month != "" {
			if _, err := time.Parse(isoMonthLayout, month); err != nil {
				writeError(w, http.StatusBadRequest, "неверный формат месяца")
				return
			}
			events = filterEventsByMonth(events, month)
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
		if _, err := time.Parse(isoDateLayout, input.Date); err != nil {
			writeError(w, http.StatusBadRequest, "неверный формат даты")
			return
		}
		if input.Type == "fertilized" && input.Fertilizer == "" {
			writeError(w, http.StatusBadRequest, "для подкормки требуется удобрение")
			return
		}

		a.mu.Lock()
		if !containsString(a.store.Collection, input.PlantID) {
			a.mu.Unlock()
			writeError(w, http.StatusBadRequest, "растение не в коллекции")
			return
		}
		event := Event{
			ID:         newID(),
			PlantID:    input.PlantID,
			Type:       input.Type,
			Date:       input.Date,
			Fertilizer: input.Fertilizer,
			Notes:      input.Notes,
			CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		}
		a.store.Events = append([]Event{event}, a.store.Events...)
		if err := a.saveStoreLocked(); err != nil {
			a.mu.Unlock()
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		a.mu.Unlock()
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
	a.mu.Lock()
	index := -1
	for i, event := range a.store.Events {
		if event.ID == eventID {
			index = i
			break
		}
	}
	if index == -1 {
		a.mu.Unlock()
		writeError(w, http.StatusNotFound, "событие не найдено")
		return
	}
	a.store.Events = append(a.store.Events[:index], a.store.Events[index+1:]...)
	if err := a.saveStoreLocked(); err != nil {
		a.mu.Unlock()
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) saveStoreLocked() error {
	return saveStore(a.storePath, a.store)
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

func loadStore(path string) (Store, error) {
	var store Store
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Store{
				Profile:    Profile{},
				Collection: []string{},
				Events:     []Event{},
			}, nil
		}
		return store, err
	}
	if err := json.Unmarshal(data, &store); err != nil {
		return Store{
			Profile:    Profile{},
			Collection: []string{},
			Events:     []Event{},
		}, nil
	}
	if store.Collection == nil {
		store.Collection = []string{}
	}
	if store.Events == nil {
		store.Events = []Event{}
	}
	return store, nil
}

func saveStore(path string, store Store) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	tempFile, err := os.CreateTemp(dir, "store-*.json")
	if err != nil {
		return err
	}
	if _, err := tempFile.Write(data); err != nil {
		tempFile.Close()
		return err
	}
	if err := tempFile.Close(); err != nil {
		return err
	}
	return os.Rename(tempFile.Name(), path)
}

func filterCollection(collection []string, plantIndex map[string]Plant) []string {
	seen := make(map[string]bool, len(collection))
	result := make([]string, 0, len(collection))
	for _, id := range collection {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		if _, ok := plantIndex[id]; !ok {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result
}

func filterEventsByMonth(events []Event, month string) []Event {
	filtered := make([]Event, 0, len(events))
	for _, event := range events {
		if strings.HasPrefix(event.Date, month) {
			filtered = append(filtered, event)
		}
	}
	return filtered
}

func containsString(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}

func removeString(items []string, value string) []string {
	result := make([]string, 0, len(items))
	for _, item := range items {
		if item != value {
			result = append(result, item)
		}
	}
	return result
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
