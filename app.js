const EVENT_TYPES = {
  watered: { label: "Полив", badgeClass: "watered" },
  repotted: { label: "Пересадка", badgeClass: "repotted" },
  fertilized: { label: "Подкормка", badgeClass: "fertilized" },
};

const CATALOG_PAGE_SIZE = 8;

const api = {
  async request(path, options = {}) {
    const response = await fetch(path, {
      headers: {
        Accept: "application/json",
        ...options.headers,
      },
      ...options,
    });
    if (!response.ok) {
      let message = `Ошибка ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData && errorData.error) {
          message = errorData.error;
        }
      } catch (error) {
        try {
          const text = await response.text();
          if (text) {
            message = text;
          }
        } catch (innerError) {
          message = message;
        }
      }
      throw new Error(message);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  },
  get(path) {
    return api.request(path);
  },
  post(path, body) {
    return api.request(path, {
      method: "POST",
      headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  },
  put(path, body) {
    return api.request(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  delete(path) {
    return api.request(path, { method: "DELETE" });
  },
};

document.addEventListener("DOMContentLoaded", () => {
  const dom = {
    tabs: Array.from(document.querySelectorAll(".tab")),
    views: Array.from(document.querySelectorAll(".view")),
    catalogSearch: document.getElementById("catalogSearch"),
    catalogFeed: document.getElementById("catalogFeed"),
    catalogSentinel: document.getElementById("catalogSentinel"),
    catalogEmpty: document.getElementById("catalogEmpty"),
    scrollCatalog: document.querySelector("[data-action='scroll-catalog']"),
    catalogSection: document.getElementById("catalogSection"),
    collectionCarousel: document.getElementById("collectionCarousel"),
    collectionCarouselEmpty: document.getElementById("collectionCarouselEmpty"),
    collectionGrid: document.getElementById("collectionGrid"),
    collectionEmpty: document.getElementById("collectionEmpty"),
    profileName: document.getElementById("profileName"),
    statPlants: document.getElementById("statPlants"),
    statEvents: document.getElementById("statEvents"),
    calendarMonth: document.getElementById("calendarMonth"),
    calendarGrid: document.getElementById("calendarGrid"),
    prevMonth: document.getElementById("prevMonth"),
    nextMonth: document.getElementById("nextMonth"),
    eventForm: document.getElementById("eventForm"),
    eventPlant: document.getElementById("eventPlant"),
    eventType: document.getElementById("eventType"),
    eventDate: document.getElementById("eventDate"),
    fertilizerField: document.getElementById("fertilizerField"),
    eventFertilizer: document.getElementById("eventFertilizer"),
    eventNotes: document.getElementById("eventNotes"),
    eventList: document.getElementById("eventList"),
    eventEmpty: document.getElementById("eventEmpty"),
    eventCount: document.getElementById("eventCount"),
    calendarHint: document.getElementById("calendarHint"),
    plantView: document.getElementById("plant"),
    plantTitle: document.getElementById("plantTitle"),
    plantSubtitle: document.getElementById("plantSubtitle"),
    plantImage: document.getElementById("plantImage"),
    plantName: document.getElementById("plantName"),
    plantLight: document.getElementById("plantLight"),
    plantWater: document.getElementById("plantWater"),
    plantFussiness: document.getElementById("plantFussiness"),
    plantRemoveBtn: document.getElementById("plantRemoveBtn"),
    photoForm: document.getElementById("photoForm"),
    photoFile: document.getElementById("photoFile"),
    photoDate: document.getElementById("photoDate"),
    photoGrid: document.getElementById("photoGrid"),
    photoEmpty: document.getElementById("photoEmpty"),
    photoModal: document.getElementById("photoModal"),
    photoModalImage: document.getElementById("photoModalImage"),
    photoModalDate: document.getElementById("photoModalDate"),
    photoModalClose: document.querySelector(".photo-modal-close"),
    plantCalendarMonth: document.getElementById("plantCalendarMonth"),
    plantCalendarGrid: document.getElementById("plantCalendarGrid"),
    plantPrevMonth: document.getElementById("plantPrevMonth"),
    plantNextMonth: document.getElementById("plantNextMonth"),
    plantEventForm: document.getElementById("plantEventForm"),
    plantEventType: document.getElementById("plantEventType"),
    plantEventDate: document.getElementById("plantEventDate"),
    plantFertilizerField: document.getElementById("plantFertilizerField"),
    plantEventFertilizer: document.getElementById("plantEventFertilizer"),
    plantEventNotes: document.getElementById("plantEventNotes"),
    plantEventList: document.getElementById("plantEventList"),
    plantEventEmpty: document.getElementById("plantEventEmpty"),
    plantEventCount: document.getElementById("plantEventCount"),
  };

  const submitButton = dom.eventForm.querySelector("button[type='submit']");
  const plantSubmitButton = dom.plantEventForm.querySelector(
    "button[type='submit']"
  );
  const plantIndex = new Map();
  let profileSaveTimer = null;
  let catalogObserver = null;
  const state = {
    profile: { name: "" },
    collection: [],
    collectionPlants: [],
    events: [],
    catalog: [],
    catalogOffset: 0,
    catalogHasMore: true,
    catalogQuery: "",
    catalogLoading: false,
    monthCursor: new Date(),
    selectedDate: toISODate(new Date()),
    plantDetail: {
      plantId: null,
      plant: null,
      photos: [],
      monthCursor: new Date(),
      selectedDate: toISODate(new Date()),
    },
  };

  dom.eventDate.value = state.selectedDate;
  dom.plantEventDate.value = state.plantDetail.selectedDate;

  dom.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setActiveView(tab.dataset.view);
    });
  });

  dom.scrollCatalog?.addEventListener("click", () => {
    dom.catalogSection?.scrollIntoView({ behavior: "smooth" });
  });

  dom.catalogSearch.addEventListener("input", () => {
    state.catalogQuery = dom.catalogSearch.value;
    loadCatalogPage(true);
  });

  dom.profileName.addEventListener("input", (event) => {
    state.profile.name = event.target.value;
    scheduleProfileSave();
  });

  dom.catalogFeed.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    const plantId = button.dataset.id;
    if (button.dataset.action === "add") {
      addPlantToCollection(plantId);
    }
    if (button.dataset.action === "open") {
      openPlantDetail(plantId);
    }
  });

  dom.collectionCarousel.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    const plantId = button.dataset.id;
    if (button.dataset.action === "open") {
      openPlantDetail(plantId);
    }
  });

  dom.collectionGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    const plantId = button.dataset.id;
    if (button.dataset.action === "remove") {
      removePlantFromCollection(plantId);
    }
    if (button.dataset.action === "open") {
      openPlantDetail(plantId);
    }
  });

  dom.prevMonth.addEventListener("click", () => {
    changeMonth(-1);
  });

  dom.nextMonth.addEventListener("click", () => {
    changeMonth(1);
  });

  dom.eventType.addEventListener("change", () => {
    updateFertilizerField(dom.eventType, dom.fertilizerField, dom.eventFertilizer);
  });

  dom.eventDate.addEventListener("change", () => {
    state.selectedDate = dom.eventDate.value;
    renderMainCalendar();
  });

  dom.eventForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!dom.eventPlant.value) {
      return;
    }
    createEvent({
      plantId: dom.eventPlant.value,
      type: dom.eventType.value,
      date: dom.eventDate.value || toISODate(new Date()),
      fertilizer: dom.eventFertilizer.value.trim(),
      notes: dom.eventNotes.value.trim(),
    });
  });

  dom.eventList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='delete']");
    if (!button) {
      return;
    }
    deleteEvent(button.dataset.id);
  });

  dom.calendarGrid.addEventListener("click", (event) => {
    const cell = event.target.closest("button[data-date]");
    if (!cell) {
      return;
    }
    dom.eventDate.value = cell.dataset.date;
    state.selectedDate = dom.eventDate.value;
    renderMainCalendar();
  });

  dom.plantPrevMonth.addEventListener("click", () => {
    changePlantMonth(-1);
  });

  dom.plantNextMonth.addEventListener("click", () => {
    changePlantMonth(1);
  });

  dom.plantEventType.addEventListener("change", () => {
    updateFertilizerField(
      dom.plantEventType,
      dom.plantFertilizerField,
      dom.plantEventFertilizer
    );
  });

  dom.plantEventDate.addEventListener("change", () => {
    state.plantDetail.selectedDate = dom.plantEventDate.value;
    renderPlantCalendar();
  });

  dom.plantEventForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.plantDetail.plantId) {
      return;
    }
    createEvent({
      plantId: state.plantDetail.plantId,
      type: dom.plantEventType.value,
      date: dom.plantEventDate.value || toISODate(new Date()),
      fertilizer: dom.plantEventFertilizer.value.trim(),
      notes: dom.plantEventNotes.value.trim(),
    });
  });

  dom.plantEventList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='delete']");
    if (!button) {
      return;
    }
    deleteEvent(button.dataset.id);
  });

  dom.plantCalendarGrid.addEventListener("click", (event) => {
    const cell = event.target.closest("button[data-date]");
    if (!cell) {
      return;
    }
    dom.plantEventDate.value = cell.dataset.date;
    state.plantDetail.selectedDate = dom.plantEventDate.value;
    renderPlantCalendar();
  });

  dom.photoForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.plantDetail.plantId) {
      return;
    }
    uploadPlantPhoto();
  });

  dom.photoGrid.addEventListener("click", (event) => {
    const card = event.target.closest(".photo-card");
    if (!card) {
      return;
    }
    const index = Number(card.dataset.index);
    const photo = state.plantDetail.photos[index];
    if (!photo) {
      return;
    }
    openPhotoModal(photo);
  });

  dom.photoModal?.addEventListener("click", (event) => {
    if (event.target === dom.photoModal) {
      closePhotoModal();
    }
  });

  dom.photoModalClose?.addEventListener("click", () => {
    closePhotoModal();
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      dom.photoModal &&
      dom.photoModal.classList.contains("is-active")
    ) {
      closePhotoModal();
    }
  });

  dom.plantRemoveBtn.addEventListener("click", () => {
    if (!state.plantDetail.plantId) {
      return;
    }
    removePlantFromCollection(state.plantDetail.plantId);
  });

  dom.plantView.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='back-home']");
    if (!button) {
      return;
    }
    setActiveView("home");
  });

  init();

  async function init() {
    try {
      const [profileData, collectionData, collectionPlantsData, eventsData] =
        await Promise.all([
          api.get("/api/profile"),
          api.get("/api/collection"),
          api.get("/api/collection/plants"),
          api.get("/api/events"),
        ]);
      state.profile =
        profileData && typeof profileData.name === "string"
          ? profileData
          : { name: "" };
      state.collection = Array.isArray(collectionData?.collection)
        ? collectionData.collection
        : [];
      state.collectionPlants = Array.isArray(collectionPlantsData?.plants)
        ? collectionPlantsData.plants
        : [];
      state.events = Array.isArray(eventsData?.events) ? eventsData.events : [];
      state.collectionPlants.forEach((plant) =>
        plantIndex.set(plant.id, plant)
      );
    } catch (error) {
      showError("Не удалось загрузить данные с сервера.", error);
    }

    dom.profileName.value = state.profile.name;
    renderPlantOptions();
    updateEventFormState();
    updateStats();
    renderCollection();
    renderCollectionCarousel();
    renderMainCalendar();
    renderMainEventList();
    updateFertilizerField(dom.eventType, dom.fertilizerField, dom.eventFertilizer);
    updateFertilizerField(
      dom.plantEventType,
      dom.plantFertilizerField,
      dom.plantEventFertilizer
    );

    setupCatalogObserver();
    loadCatalogPage(true);
  }

  function setupCatalogObserver() {
    if (!dom.catalogSentinel) {
      return;
    }
    if (catalogObserver) {
      catalogObserver.disconnect();
    }
    catalogObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          loadCatalogPage();
        }
      });
    });
    catalogObserver.observe(dom.catalogSentinel);
  }

  function setActiveView(viewId) {
    dom.views.forEach((view) => {
      view.classList.toggle("is-active", view.id === viewId);
    });
    dom.tabs.forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.view === viewId);
    });
  }

  function renderCatalog() {
    dom.catalogFeed.innerHTML = "";
    state.catalog.forEach((plant) => {
      const inCollection = state.collection.includes(plant.id);
      const actions = [];
      if (inCollection) {
        actions.push({
          label: "Открыть карточку",
          action: "open",
          style: "secondary",
        });
        actions.push({
          label: "В коллекции",
          action: "noop",
          style: "ghost",
          disabled: true,
        });
      } else {
        actions.push({
          label: "Добавить в коллекцию",
          action: "add",
          style: "primary",
        });
      }
      const card = buildPlantCard(plant, { actions });
      dom.catalogFeed.appendChild(card);
    });
    toggleEmpty(dom.catalogEmpty, state.catalog.length === 0);
    dom.catalogSentinel.style.display = state.catalogHasMore ? "block" : "none";
  }

  function renderCollectionCarousel() {
    dom.collectionCarousel.innerHTML = "";
    state.collectionPlants.forEach((plant) => {
      const card = buildPlantCard(plant, {
        actions: [
          { label: "Открыть карточку", action: "open", style: "secondary" },
        ],
        compact: true,
      });
      dom.collectionCarousel.appendChild(card);
    });
    toggleEmpty(dom.collectionCarouselEmpty, state.collectionPlants.length === 0);
  }

  function renderCollection() {
    dom.collectionGrid.innerHTML = "";
    state.collectionPlants.forEach((plant) => {
      const card = buildPlantCard(plant, {
        actions: [
          { label: "Открыть карточку", action: "open", style: "secondary" },
          { label: "Удалить", action: "remove", style: "ghost" },
        ],
      });
      dom.collectionGrid.appendChild(card);
    });
    toggleEmpty(dom.collectionEmpty, state.collectionPlants.length === 0);
  }

  function renderMainCalendar() {
    renderCalendar({
      grid: dom.calendarGrid,
      monthLabel: dom.calendarMonth,
      monthCursor: state.monthCursor,
      selectedDate: state.selectedDate,
      events: state.events,
    });
  }

  function renderMainEventList() {
    const events = filterEventsByMonth(state.events, state.monthCursor);
    renderEventList(dom.eventList, events, {
      showPlantName: true,
      empty: dom.eventEmpty,
      count: dom.eventCount,
    });
  }

  function renderPlantCalendar() {
    const events = state.events.filter(
      (event) => event.plantId === state.plantDetail.plantId
    );
    renderCalendar({
      grid: dom.plantCalendarGrid,
      monthLabel: dom.plantCalendarMonth,
      monthCursor: state.plantDetail.monthCursor,
      selectedDate: state.plantDetail.selectedDate,
      events,
    });
    renderEventList(dom.plantEventList, filterEventsByMonth(events, state.plantDetail.monthCursor), {
      showPlantName: false,
      empty: dom.plantEventEmpty,
      count: dom.plantEventCount,
    });
  }

  function renderPlantOptions() {
    const currentValue = dom.eventPlant.value;
    dom.eventPlant.innerHTML = "";
    const plants = [...state.collectionPlants].sort((a, b) =>
      a.name.localeCompare(b.name, "ru")
    );
    if (plants.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Добавьте растение в коллекцию";
      dom.eventPlant.appendChild(option);
      return;
    }
    plants.forEach((plant) => {
      const option = document.createElement("option");
      option.value = plant.id;
      option.textContent = plant.name;
      dom.eventPlant.appendChild(option);
    });
    if (plants.some((plant) => plant.id === currentValue)) {
      dom.eventPlant.value = currentValue;
    }
  }

  function renderPlantDetail() {
    if (!state.plantDetail.plant) {
      return;
    }
    const plant = state.plantDetail.plant;
    dom.plantTitle.textContent = plant.name;
    dom.plantName.textContent = plant.name;
    dom.plantImage.src = plant.image;
    dom.plantImage.alt = plant.name;
    dom.plantLight.textContent = plant.light;
    dom.plantWater.textContent = plant.water;
    dom.plantFussiness.textContent = plant.fussiness;
    renderPlantPhotos();
    renderPlantCalendar();
    updateFertilizerField(
      dom.plantEventType,
      dom.plantFertilizerField,
      dom.plantEventFertilizer
    );
  }

  function renderPlantPhotos() {
    dom.photoGrid.innerHTML = "";
    state.plantDetail.photos.forEach((photo, index) => {
      const card = document.createElement("div");
      card.className = "photo-card";
      card.dataset.index = `${index}`;
      const img = document.createElement("img");
      img.src = photo.url;
      img.alt = "Фото растения";
      img.loading = "lazy";
      const meta = document.createElement("div");
      meta.className = "photo-meta";
      meta.textContent = photo.takenAt
        ? formatDate(photo.takenAt)
        : formatDate(photo.createdAt ? photo.createdAt.slice(0, 10) : "");
      card.appendChild(img);
      card.appendChild(meta);
      dom.photoGrid.appendChild(card);
    });
    toggleEmpty(dom.photoEmpty, state.plantDetail.photos.length === 0);
  }

  function renderEventList(container, events, options) {
    const { showPlantName, empty, count } = options;
    container.innerHTML = "";
    events.forEach((eventItem) => {
      const plant = plantIndex.get(eventItem.plantId);
      const item = document.createElement("div");
      item.className = "event-item";

      const meta = document.createElement("div");
      meta.className = "event-meta";

      const date = document.createElement("div");
      date.textContent = formatDate(eventItem.date);
      meta.appendChild(date);

      const badge = document.createElement("span");
      badge.className = `badge ${EVENT_TYPES[eventItem.type].badgeClass}`;
      badge.textContent = EVENT_TYPES[eventItem.type].label;
      meta.appendChild(badge);

      const details = document.createElement("div");
      details.className = "event-details";

      if (showPlantName) {
        const plantLine = document.createElement("div");
        plantLine.textContent = plant ? plant.name : "Растение удалено";
        details.appendChild(plantLine);
      }

      if (eventItem.type === "fertilized") {
        const fertLine = document.createElement("div");
        fertLine.textContent = `Удобрение: ${
          eventItem.fertilizer || "не указано"
        }`;
        details.appendChild(fertLine);
      }

      if (eventItem.notes) {
        const notesLine = document.createElement("div");
        notesLine.textContent = `Заметка: ${eventItem.notes}`;
        details.appendChild(notesLine);
      }

      const actions = document.createElement("div");
      actions.className = "event-actions";
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "btn ghost";
      deleteButton.dataset.action = "delete";
      deleteButton.dataset.id = eventItem.id;
      deleteButton.textContent = "Удалить";
      actions.appendChild(deleteButton);

      item.appendChild(meta);
      item.appendChild(details);
      item.appendChild(actions);
      container.appendChild(item);
    });

    count.textContent = events.length ? `${events.length}` : "";
    toggleEmpty(empty, events.length === 0);
  }

  function updateStats() {
    dom.statPlants.textContent = `${state.collection.length}`;
    dom.statEvents.textContent = `${state.events.length}`;
  }

  function updateEventFormState() {
    renderPlantOptions();
    const hasCollection = state.collection.length > 0;
    const isDisabled = !hasCollection;
    dom.eventPlant.disabled = isDisabled;
    dom.eventType.disabled = isDisabled;
    dom.eventDate.disabled = isDisabled;
    dom.eventNotes.disabled = isDisabled;
    submitButton.disabled = isDisabled;
    dom.calendarHint.style.display = hasCollection ? "none" : "block";
    updateFertilizerField(dom.eventType, dom.fertilizerField, dom.eventFertilizer);
  }

  function updateFertilizerField(typeSelect, field, input) {
    const isFertilized = typeSelect.value === "fertilized";
    field.classList.toggle("is-hidden", !isFertilized);
    input.required = isFertilized;
    input.disabled = typeSelect.disabled || !isFertilized;
  }

  function scheduleProfileSave() {
    if (profileSaveTimer) {
      clearTimeout(profileSaveTimer);
    }
    profileSaveTimer = setTimeout(async () => {
      try {
        const updated = await api.put("/api/profile", {
          name: state.profile.name,
        });
        state.profile =
          updated && typeof updated.name === "string" ? updated : state.profile;
      } catch (error) {
        showError("Не удалось сохранить профиль.", error);
      }
    }, 400);
  }

  async function addPlantToCollection(id) {
    if (!id || state.collection.includes(id)) {
      return;
    }
    try {
      const response = await api.post("/api/collection", { plantId: id });
      if (Array.isArray(response?.collection)) {
        state.collection = response.collection;
      }
      await refreshCollectionPlants();
    } catch (error) {
      showError("Не удалось добавить растение в коллекцию.", error);
    }
  }

  async function removePlantFromCollection(id) {
    try {
      const response = await api.delete(`/api/collection/${id}`);
      if (Array.isArray(response?.collection)) {
        state.collection = response.collection;
      } else {
        state.collection = state.collection.filter((item) => item !== id);
      }
      await refreshCollectionPlants();
      if (state.plantDetail.plantId === id) {
        setActiveView("home");
      }
    } catch (error) {
      showError("Не удалось удалить растение из коллекции.", error);
    }
  }

  async function refreshCollectionPlants() {
    try {
      const collectionPlantsData = await api.get("/api/collection/plants");
      state.collectionPlants = Array.isArray(collectionPlantsData?.plants)
        ? collectionPlantsData.plants
        : [];
      state.collectionPlants.forEach((plant) =>
        plantIndex.set(plant.id, plant)
      );
      renderCollection();
      renderCollectionCarousel();
      renderPlantOptions();
      updateEventFormState();
      updateStats();
      renderCatalog();
    } catch (error) {
      showError("Не удалось обновить коллекцию.", error);
    }
  }

  async function createEvent(payload) {
    if (payload.type === "fertilized" && !payload.fertilizer) {
      if (state.plantDetail.plantId === payload.plantId) {
        dom.plantEventFertilizer.focus();
      } else {
        dom.eventFertilizer.focus();
      }
      return;
    }
    try {
      const created = await api.post("/api/events", payload);
      if (created) {
        state.events.unshift(created);
      }
      const [year, month] = payload.date.split("-").map(Number);
      if (Number.isFinite(year) && Number.isFinite(month)) {
        state.monthCursor = new Date(year, month - 1, 1);
        state.plantDetail.monthCursor = new Date(year, month - 1, 1);
      }
      dom.eventNotes.value = "";
      dom.eventFertilizer.value = "";
      dom.plantEventNotes.value = "";
      dom.plantEventFertilizer.value = "";
      renderMainCalendar();
      renderMainEventList();
      renderPlantCalendar();
      updateStats();
    } catch (error) {
      showError("Не удалось сохранить событие.", error);
    }
  }

  async function deleteEvent(eventId) {
    if (!eventId) {
      return;
    }
    try {
      await api.delete(`/api/events/${eventId}`);
      state.events = state.events.filter((item) => item.id !== eventId);
      renderMainCalendar();
      renderMainEventList();
      renderPlantCalendar();
      updateStats();
    } catch (error) {
      showError("Не удалось удалить событие.", error);
    }
  }

  function changeMonth(delta) {
    state.monthCursor = new Date(
      state.monthCursor.getFullYear(),
      state.monthCursor.getMonth() + delta,
      1
    );
    renderMainCalendar();
    renderMainEventList();
  }

  function changePlantMonth(delta) {
    state.plantDetail.monthCursor = new Date(
      state.plantDetail.monthCursor.getFullYear(),
      state.plantDetail.monthCursor.getMonth() + delta,
      1
    );
    renderPlantCalendar();
  }

  async function loadCatalogPage(reset = false) {
    if (state.catalogLoading) {
      return;
    }
    if (!state.catalogHasMore && !reset) {
      return;
    }
    if (reset) {
      state.catalog = [];
      state.catalogOffset = 0;
      state.catalogHasMore = true;
    }
    state.catalogLoading = true;
    try {
      const params = new URLSearchParams();
      params.set("limit", `${CATALOG_PAGE_SIZE}`);
      params.set("offset", `${state.catalogOffset}`);
      if (state.catalogQuery.trim()) {
        params.set("q", state.catalogQuery.trim());
      }
      const response = await api.get(`/api/catalog?${params.toString()}`);
      const items = Array.isArray(response?.items) ? response.items : [];
      state.catalog = reset ? items : [...state.catalog, ...items];
      state.catalogOffset = response?.nextOffset ?? state.catalog.length;
      state.catalogHasMore = Boolean(response?.hasMore);
      items.forEach((plant) => plantIndex.set(plant.id, plant));
      renderCatalog();
    } catch (error) {
      showError("Не удалось загрузить справочник.", error);
    } finally {
      state.catalogLoading = false;
    }
  }

  async function openPlantDetail(plantId) {
    if (!plantId) {
      return;
    }
    let plant = plantIndex.get(plantId);
    if (!plant) {
      try {
        plant = await api.get(`/api/plants/${plantId}`);
        plantIndex.set(plant.id, plant);
      } catch (error) {
        showError("Не удалось открыть карточку растения.", error);
        return;
      }
    }
    state.plantDetail.plantId = plantId;
    state.plantDetail.plant = plant;
    state.plantDetail.monthCursor = new Date();
    state.plantDetail.selectedDate = toISODate(new Date());
    dom.plantEventDate.value = state.plantDetail.selectedDate;
    await loadPlantPhotos(plantId);
    renderPlantDetail();
    setActiveView("plant");
  }

  async function loadPlantPhotos(plantId) {
    try {
      const response = await api.get(`/api/plants/${plantId}/photos`);
      state.plantDetail.photos = Array.isArray(response?.photos)
        ? response.photos
        : [];
    } catch (error) {
      showError("Не удалось загрузить фотографии.", error);
    }
  }

  async function uploadPlantPhoto() {
    const file = dom.photoFile.files[0];
    if (!file) {
      return;
    }
    const formData = new FormData();
    formData.append("photo", file);
    if (dom.photoDate.value) {
      formData.append("takenAt", dom.photoDate.value);
    }
    try {
      const created = await api.post(
        `/api/plants/${state.plantDetail.plantId}/photos`,
        formData
      );
      if (created) {
        state.plantDetail.photos.unshift(created);
        renderPlantPhotos();
      }
      dom.photoFile.value = "";
      dom.photoDate.value = "";
    } catch (error) {
      showError("Не удалось загрузить фото.", error);
    }
  }

  function openPhotoModal(photo) {
    dom.photoModalImage.src = photo.url;
    dom.photoModalDate.textContent = photo.takenAt
      ? `Дата: ${formatDate(photo.takenAt)}`
      : `Загружено: ${formatDate(
          photo.createdAt ? photo.createdAt.slice(0, 10) : ""
        )}`;
    dom.photoModal.classList.add("is-active");
    dom.photoModal.setAttribute("aria-hidden", "false");
  }

  function closePhotoModal() {
    dom.photoModal.classList.remove("is-active");
    dom.photoModal.setAttribute("aria-hidden", "true");
    dom.photoModalImage.src = "";
  }

  function renderCalendar({ grid, monthLabel, monthCursor, selectedDate, events }) {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    monthLabel.textContent = new Intl.DateTimeFormat("ru-RU", {
      month: "long",
      year: "numeric",
    }).format(monthCursor);
    grid.innerHTML = "";

    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = toISODate(new Date());
    const eventsByDate = groupEventsByDate(events);

    for (let i = 0; i < offset; i += 1) {
      const emptyCell = document.createElement("div");
      emptyCell.className = "calendar-cell is-empty";
      grid.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${year}-${pad2(month + 1)}-${pad2(day)}`;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "calendar-cell";
      if (date === today) {
        cell.classList.add("is-today");
      }
      if (date === selectedDate) {
        cell.classList.add("is-selected");
      }
      cell.dataset.date = date;

      const number = document.createElement("div");
      number.className = "calendar-number";
      number.textContent = day;
      cell.appendChild(number);

      const dayEvents = eventsByDate.get(date) || [];
      if (dayEvents.length) {
        const markerWrap = document.createElement("div");
        markerWrap.className = "calendar-markers";
        const counts = countEventTypes(dayEvents);
        Object.keys(counts).forEach((type) => {
          const marker = document.createElement("span");
          marker.className = `marker ${type}`;
          const count = counts[type];
          if (count > 1) {
            marker.textContent = count;
          }
          marker.title = `${EVENT_TYPES[type].label}: ${count}`;
          markerWrap.appendChild(marker);
        });
        cell.appendChild(markerWrap);
      }

      grid.appendChild(cell);
    }
  }
});

function buildPlantCard(plant, options) {
  const card = document.createElement("article");
  card.className = "plant-card";
  if (options.compact) {
    card.classList.add("is-compact");
  }

  const image = document.createElement("img");
  image.className = "plant-photo";
  image.src = plant.image;
  image.alt = plant.name;
  image.loading = "lazy";
  card.appendChild(image);

  const body = document.createElement("div");
  body.className = "plant-body";

  const title = document.createElement("h3");
  title.textContent = plant.name;
  body.appendChild(title);

  const tags = document.createElement("div");
  tags.className = "plant-tags";
  tags.appendChild(createCareRow("Свет", plant.light));
  tags.appendChild(createCareRow("Полив", plant.water));
  tags.appendChild(createCareRow("Привередливость", plant.fussiness));
  body.appendChild(tags);

  const actions = document.createElement("div");
  actions.className = "plant-actions";

  if (Array.isArray(options.actions)) {
    options.actions.forEach((action) => {
      const button = createActionButton(
        action.label,
        action.style,
        action.action,
        plant.id
      );
      if (action.disabled) {
        button.disabled = true;
      }
      actions.appendChild(button);
    });
  }

  body.appendChild(actions);
  card.appendChild(body);

  return card;
}

function createCareRow(label, value) {
  const row = document.createElement("div");
  const labelSpan = document.createElement("span");
  labelSpan.textContent = `${label}: `;
  row.appendChild(labelSpan);
  row.appendChild(document.createTextNode(value));
  return row;
}

function createActionButton(label, style, action, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn ${style}`;
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function pad2(value) {
  return `${value}`.padStart(2, "0");
}

function toISODate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )}`;
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  const parts = value.split("-");
  if (parts.length !== 3) {
    return value;
  }
  const [year, month, day] = parts;
  return `${day}.${month}.${year}`;
}

function groupEventsByDate(events) {
  const map = new Map();
  events.forEach((event) => {
    if (!event.date) {
      return;
    }
    if (!map.has(event.date)) {
      map.set(event.date, []);
    }
    map.get(event.date).push(event);
  });
  return map;
}

function countEventTypes(events) {
  return events.reduce((acc, event) => {
    const type = event.type;
    if (!EVENT_TYPES[type]) {
      return acc;
    }
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
}

function filterEventsByMonth(events, cursor) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  return events
    .filter((event) => {
      if (!event.date) {
        return false;
      }
      const [eventYear, eventMonth] = event.date.split("-").map(Number);
      return eventYear === year && eventMonth === month;
    })
    .sort((a, b) => {
      if (a.date === b.date) {
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      }
      return b.date.localeCompare(a.date);
    });
}

function toggleEmpty(element, show) {
  element.style.display = show ? "block" : "none";
}

function showError(message, error) {
  console.error(message, error);
  window.alert(message);
}
