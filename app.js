const EVENT_TYPES = {
  watered: { label: "Полив", badgeClass: "watered" },
  repotted: { label: "Пересадка", badgeClass: "repotted" },
  fertilized: { label: "Подкормка", badgeClass: "fertilized" },
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthFormatter = new Intl.DateTimeFormat("ru-RU", {
  month: "long",
  year: "numeric",
});

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
    catalogGrid: document.getElementById("catalogGrid"),
    catalogSearch: document.getElementById("catalogSearch"),
    catalogEmpty: document.getElementById("catalogEmpty"),
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
  };

  const submitButton = dom.eventForm.querySelector("button[type='submit']");
  let plantIndex = new Map();
  let profileSaveTimer = null;
  const state = {
    profile: { name: "" },
    collection: [],
    events: [],
    monthCursor: new Date(),
    catalogQuery: "",
    catalog: [],
  };

  dom.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setActiveView(tab.dataset.view);
    });
  });

  dom.catalogSearch.addEventListener("input", () => {
    state.catalogQuery = dom.catalogSearch.value;
    renderCatalog();
  });

  dom.profileName.addEventListener("input", (event) => {
    state.profile.name = event.target.value;
    scheduleProfileSave();
  });

  dom.catalogGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='add']");
    if (!button) {
      return;
    }
    addPlantToCollection(button.dataset.id);
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
    if (button.dataset.action === "log") {
      setActiveView("calendar");
      dom.eventPlant.value = plantId;
      dom.eventDate.focus();
      renderCalendar();
    }
  });

  dom.prevMonth.addEventListener("click", () => {
    changeMonth(-1);
  });

  dom.nextMonth.addEventListener("click", () => {
    changeMonth(1);
  });

  dom.eventType.addEventListener("change", () => {
    updateFertilizerField();
  });

  dom.eventDate.addEventListener("change", () => {
    renderCalendar();
  });

  dom.eventForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!dom.eventPlant.value) {
      return;
    }
    createEvent();
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
    renderCalendar();
  });

  init();

  async function init() {
    try {
      const [catalogData, profileData, collectionData, eventsData] =
        await Promise.all([
          api.get("/api/catalog"),
          api.get("/api/profile"),
          api.get("/api/collection"),
          api.get("/api/events"),
        ]);
      state.catalog = Array.isArray(catalogData?.catalog)
        ? catalogData.catalog
        : Array.isArray(catalogData)
        ? catalogData
        : [];
      state.profile =
        profileData && typeof profileData.name === "string"
          ? profileData
          : { name: "" };
      state.collection = Array.isArray(collectionData?.collection)
        ? collectionData.collection
        : [];
      state.events = Array.isArray(eventsData?.events) ? eventsData.events : [];
      plantIndex = new Map(state.catalog.map((plant) => [plant.id, plant]));
    } catch (error) {
      showError("Не удалось загрузить данные с сервера.", error);
    }

    if (dom.profileName) {
      dom.profileName.value = state.profile.name;
    }

    if (!dom.eventDate.value) {
      dom.eventDate.value = toISODate(new Date());
    }

    renderCatalog();
    renderCollection();
    renderPlantOptions();
    updateEventFormState();
    updateFertilizerField();
    updateStats();
    renderCalendar();
    renderEventList();
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
    const query = state.catalogQuery.trim().toLowerCase();
    const filtered = state.catalog.filter((plant) =>
      plant.name.toLowerCase().includes(query)
    );
    dom.catalogGrid.innerHTML = "";
    filtered.forEach((plant) => {
      const inCollection = state.collection.includes(plant.id);
      const card = buildPlantCard(plant, {
        action: inCollection ? "in-collection" : "add",
      });
      dom.catalogGrid.appendChild(card);
    });
    toggleEmpty(dom.catalogEmpty, filtered.length === 0);
  }

  function renderCollection() {
    dom.collectionGrid.innerHTML = "";
    const plants = state.collection
      .map((id) => plantIndex.get(id))
      .filter(Boolean);
    plants.forEach((plant) => {
      const card = buildPlantCard(plant, {
        actions: [
          { label: "Отметить уход", action: "log", style: "secondary" },
          { label: "Удалить", action: "remove", style: "ghost" },
        ],
      });
      dom.collectionGrid.appendChild(card);
    });
    toggleEmpty(dom.collectionEmpty, plants.length === 0);
  }

  function renderPlantOptions() {
    const currentValue = dom.eventPlant.value;
    dom.eventPlant.innerHTML = "";
    const plants = state.collection
      .map((id) => plantIndex.get(id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
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

  function renderCalendar() {
    const year = state.monthCursor.getFullYear();
    const month = state.monthCursor.getMonth();
    dom.calendarMonth.textContent = monthFormatter.format(state.monthCursor);
    dom.calendarGrid.innerHTML = "";

    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = toISODate(new Date());
    const selectedDate = dom.eventDate.value || today;
    const eventsByDate = groupEventsByDate(state.events);

    for (let i = 0; i < offset; i += 1) {
      const emptyCell = document.createElement("div");
      emptyCell.className = "calendar-cell is-empty";
      dom.calendarGrid.appendChild(emptyCell);
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

      dom.calendarGrid.appendChild(cell);
    }
  }

  function renderEventList() {
    dom.eventList.innerHTML = "";
    const events = state.events.filter((event) =>
      isSameMonth(event.date, state.monthCursor)
    );
    events.sort((a, b) => {
      if (a.date === b.date) {
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      }
      return b.date.localeCompare(a.date);
    });

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

      const plantLine = document.createElement("div");
      plantLine.textContent = plant ? plant.name : "Растение удалено";
      details.appendChild(plantLine);

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
      dom.eventList.appendChild(item);
    });

    dom.eventCount.textContent = events.length ? `${events.length}` : "";
    toggleEmpty(dom.eventEmpty, events.length === 0);
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
    updateFertilizerField();
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

  function updateFertilizerField() {
    const isFertilized = dom.eventType.value === "fertilized";
    dom.fertilizerField.classList.toggle("is-hidden", !isFertilized);
    dom.eventFertilizer.required = isFertilized;
    dom.eventFertilizer.disabled =
      dom.eventPlant.disabled || !isFertilized;
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
      renderCatalog();
      renderCollection();
      updateEventFormState();
      updateStats();
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
      renderCatalog();
      renderCollection();
      updateEventFormState();
      updateStats();
    } catch (error) {
      showError("Не удалось удалить растение из коллекции.", error);
    }
  }

  function changeMonth(delta) {
    state.monthCursor = new Date(
      state.monthCursor.getFullYear(),
      state.monthCursor.getMonth() + delta,
      1
    );
    renderCalendar();
    renderEventList();
  }

  async function createEvent() {
    const type = dom.eventType.value;
    const date = dom.eventDate.value || toISODate(new Date());
    const fertilizer = dom.eventFertilizer.value.trim();
    if (type === "fertilized" && !fertilizer) {
      dom.eventFertilizer.focus();
      return;
    }
    const payload = {
      plantId: dom.eventPlant.value,
      type,
      date,
      fertilizer: type === "fertilized" ? fertilizer : "",
      notes: dom.eventNotes.value.trim(),
    };
    try {
      const created = await api.post("/api/events", payload);
      if (created) {
        state.events.unshift(created);
      }
      const [year, month] = date.split("-").map(Number);
      if (Number.isFinite(year) && Number.isFinite(month)) {
        state.monthCursor = new Date(year, month - 1, 1);
      }
      dom.eventNotes.value = "";
      dom.eventFertilizer.value = "";
      renderCalendar();
      renderEventList();
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
      renderCalendar();
      renderEventList();
      updateStats();
    } catch (error) {
      showError("Не удалось удалить событие.", error);
    }
  }
});

function buildPlantCard(plant, options) {
  const card = document.createElement("article");
  card.className = "plant-card";

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

  if (options.action === "add") {
    actions.appendChild(
      createActionButton("Добавить в коллекцию", "primary", "add", plant.id)
    );
  }

  if (options.action === "in-collection") {
    const button = createActionButton(
      "Уже в коллекции",
      "secondary",
      "noop",
      plant.id
    );
    button.disabled = true;
    actions.appendChild(button);
  }

  if (Array.isArray(options.actions)) {
    options.actions.forEach((action) => {
      actions.appendChild(
        createActionButton(action.label, action.style, action.action, plant.id)
      );
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

function isValidISODate(value) {
  return isoDatePattern.test(value);
}

function formatDate(value) {
  if (!isValidISODate(value)) {
    return value;
  }
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function isSameMonth(value, cursor) {
  if (!isValidISODate(value)) {
    return false;
  }
  const [year, month] = value.split("-").map(Number);
  return year === cursor.getFullYear() && month - 1 === cursor.getMonth();
}

function groupEventsByDate(events) {
  const map = new Map();
  events.forEach((event) => {
    if (!isValidISODate(event.date)) {
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

function toggleEmpty(element, show) {
  element.style.display = show ? "block" : "none";
}

function showError(message, error) {
  console.error(message, error);
  window.alert(message);
}
