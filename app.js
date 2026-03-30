const API_BASE_URL = 'https://crm.skch.cz/ajax0/procedure.php';

const COMMANDS = {
  listUsers: 'getPeopleList',
  listDrinks: 'getTypesList',
  save: 'saveDrinks'
};

const STORAGE_KEYS = {
  user: 'coffeeTracker:lastUser',
  draft: 'coffeeTracker:draft',
  offlineQueue: 'coffeeTracker:offlineQueue',
  dailyHistory: 'coffeeTracker:dailyHistory',
  lastDailyNotificationDate: 'coffeeTracker:lastDailyNotificationDate',
  notificationPermissionAsked: 'coffeeTracker:notificationPermissionAsked'
};

const FALLBACK_USERS = [
  { id: '1', name: 'Masopust Lukáš' },
  { id: '2', name: 'Molič Jan' },
  { id: '3', name: 'Adamek Daniel' },
  { id: '4', name: 'Weber David' }
];

const FALLBACK_DRINKS = [
  { type: 'Mléko' },
  { type: 'Espresso' },
  { type: 'Coffe' },
  { type: 'Long' },
  { type: 'Doppio+' }
];

const elements = {
  userSelect: document.getElementById('userSelect'),
  drinksContainer: document.getElementById('drinksContainer'),
  saveBtn: document.getElementById('saveBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  resetBtn: document.getElementById('resetBtn'),
  totalCount: document.getElementById('totalCount'),
  selectedUserLabel: document.getElementById('selectedUserLabel'),
  statusCard: document.getElementById('statusCard'),
  statusText: document.getElementById('statusText'),
  payloadPreview: document.getElementById('payloadPreview'),
  drinkRowTemplate: document.getElementById('drinkRowTemplate')
};

const state = {
  users: [],
  drinks: [],
  counts: {},
  isSyncInProgress: false
};

async function init() {
  wireEvents();
  restoreDraftFromStorage();
  await loadAll();
  await registerServiceWorker();
  await requestNotificationPermissionIfNeeded();
  await processPendingQueue();
  await maybeShowDailySummaryNotification();
}

function wireEvents() {
  elements.userSelect.addEventListener('change', onUserChanged);
  elements.saveBtn.addEventListener('click', saveConsumption);
  elements.refreshBtn.addEventListener('click', async () => {
    await loadAll();
    await processPendingQueue();
  });
  elements.resetBtn.addEventListener('click', resetCounts);
  window.addEventListener('beforeunload', persistDraftToLocal);
  window.addEventListener('online', handleOnline);
  window.addEventListener('focus', maybeShowDailySummaryNotification);
}

async function handleOnline() {
  showStatus('Připojení bylo obnoveno. Probíhá odeslání lokálně uložených dat…', 'success', false);
  await processPendingQueue();
}

async function loadAll() {
  setBusy(true);
  showStatus('Načítám data z API…', 'success', false);

  try {
    const [usersData, drinksData] = await Promise.all([
      fetchJson(`${API_BASE_URL}?cmd=${encodeURIComponent(COMMANDS.listUsers)}`),
      fetchJson(`${API_BASE_URL}?cmd=${encodeURIComponent(COMMANDS.listDrinks)}`)
    ]);

    state.users = normalizeUsers(usersData);
    state.drinks = normalizeDrinks(drinksData);

    if (!state.users.length || !state.drinks.length) {
      throw new Error('API vrátilo prázdná data.');
    }

    initializeCounts();
    renderUsers();
    hydrateRememberedUser();
    hydrateDraftCounts();
    renderDrinks();
    updateSummary();

    showStatus('Data byla úspěšně načtena z API.', 'success', false);
  } catch (error) {
    console.error(error);

    state.users = [...FALLBACK_USERS];
    state.drinks = [...FALLBACK_DRINKS];

    initializeCounts();
    renderUsers();
    hydrateRememberedUser();
    hydrateDraftCounts();
    renderDrinks();
    updateSummary();

    showStatus(
      'API se nepodařilo načíst, proto byla zobrazena náhradní data. Formulář jde dál používat a odeslání se uloží lokálně.',
      'error',
      false
    );
  } finally {
    setBusy(false);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function toArray(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (data && typeof data === 'object') {
    return Object.values(data);
  }

  return [];
}

function normalizeUsers(data) {
  const arr = toArray(data);

  return arr
    .map((item, index) => ({
      id: String(
        item.ID ??
        item.id ??
        item.userId ??
        item.userid ??
        item.personId ??
        item.value ??
        index + 1
      ),
      name: String(
        item.name ??
        item.fullname ??
        item.fullName ??
        item.user ??
        item.username ??
        item.text ??
        `Uživatel ${index + 1}`
      )
    }))
    .filter((user) => user.id && user.name);
}

function normalizeDrinks(data) {
  const arr = toArray(data);

  return arr
    .map((item, index) => ({
      type: String(
        item.typ ??
        item.type ??
        item.name ??
        item.drink ??
        item.title ??
        item.text ??
        item.value ??
        `Nápoj ${index + 1}`
      )
    }))
    .filter((drink) => drink.type);
}

function initializeCounts() {
  const previous = { ...state.counts };
  state.counts = {};

  state.drinks.forEach((drink) => {
    state.counts[drink.type] = sanitizeCount(previous[drink.type] ?? 0);
  });
}

function renderUsers() {
  elements.userSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = state.users.length ? 'Vyberte uživatele' : 'Žádní uživatelé';
  elements.userSelect.appendChild(placeholder);

  state.users.forEach((user) => {
    const option = document.createElement('option');
    option.value = user.id;
    option.textContent = user.name;
    elements.userSelect.appendChild(option);
  });
}

function renderDrinks() {
  elements.drinksContainer.innerHTML = '';

  state.drinks.forEach((drink) => {
    const fragment = elements.drinkRowTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.drink-row');
    const name = fragment.querySelector('.drink-name');
    const valueLabel = fragment.querySelector('.drink-value-label');
    const input = fragment.querySelector('.drink-input');
    const decrementBtn = fragment.querySelector('.decrement');
    const incrementBtn = fragment.querySelector('.increment');

    row.dataset.type = drink.type;
    name.textContent = drink.type;

    const currentValue = sanitizeCount(state.counts[drink.type]);
    input.value = currentValue;
    valueLabel.textContent = `${currentValue} ks`;

    input.addEventListener('input', () => {
      const sanitized = sanitizeCount(input.value);
      input.value = sanitized;
      state.counts[drink.type] = sanitized;
      valueLabel.textContent = `${sanitized} ks`;
      persistDraftToLocal();
      updateSummary();
    });

    incrementBtn.addEventListener('click', () => {
      adjustDrink(drink.type, input, valueLabel, 1);
    });

    decrementBtn.addEventListener('click', () => {
      adjustDrink(drink.type, input, valueLabel, -1);
    });

    elements.drinksContainer.appendChild(fragment);
  });
}

function adjustDrink(type, input, label, delta) {
  const next = Math.max(0, sanitizeCount(input.value) + delta);
  input.value = next;
  label.textContent = `${next} ks`;
  state.counts[type] = next;
  persistDraftToLocal();
  updateSummary();
}

function sanitizeCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function onUserChanged() {
  rememberUser(elements.userSelect.value);
  persistDraftToLocal();
  updateSummary();
}

function updateSummary() {
  const total = Object.values(state.counts).reduce((sum, value) => {
    return sum + sanitizeCount(value);
  }, 0);

  elements.totalCount.textContent = String(total);

  const selectedOption = elements.userSelect.selectedOptions[0];
  elements.selectedUserLabel.textContent =
    selectedOption && selectedOption.value ? selectedOption.textContent : '–';
}

function resetCounts() {
  Object.keys(state.counts).forEach((key) => {
    state.counts[key] = 0;
  });

  renderDrinks();
  persistDraftToLocal();
  updateSummary();
}

function buildPayload() {
  return {
    user: String(elements.userSelect.value),
    drinks: state.drinks.map((drink) => ({
      type: drink.type,
      value: sanitizeCount(state.counts[drink.type])
    }))
  };
}

async function saveConsumption() {
  const payload = buildPayload();

  if (!payload.user) {
    showStatus('Nejprve vyberte uživatele.', 'error');
    return;
  }

  const selectedUserName = getSelectedUserName();
  const total = getPayloadTotal(payload);

  if (total <= 0) {
    showStatus('Zadejte alespoň jeden nápoj.', 'error');
    return;
  }

  try {
    setBusy(true);

    if (!navigator.onLine) {
      queueOfflinePayload(payload, selectedUserName);
      recordDailyConsumption(payload, selectedUserName);
      resetCounts();
      showStatus(
        'Nejste online. Záznam byl uložen do localStorage a po obnovení připojení se odešle automaticky.',
        'error',
        true,
        payload,
        { queued: true }
      );
      return;
    }

    const parsedResponse = await sendPayloadToApi(payload);

    rememberUser(payload.user);
    recordDailyConsumption(payload, selectedUserName);
    clearDraft();
    resetCounts();
    showStatus('Záznam byl úspěšně odeslán.', 'success', true, payload, parsedResponse);
  } catch (error) {
    console.error(error);
    queueOfflinePayload(payload, selectedUserName);
    recordDailyConsumption(payload, selectedUserName);
    resetCounts();
    showStatus(
      `API není dostupné. Záznam byl uložen lokálně a odešle se po obnovení připojení. Detail: ${error.message}`,
      'error',
      true,
      payload,
      { queued: true }
    );
  } finally {
    setBusy(false);
    await maybeShowDailySummaryNotification();
  }
}

async function sendPayloadToApi(payload) {
  const response = await fetch(
    `${API_BASE_URL}?cmd=${encodeURIComponent(COMMANDS.save)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  const text = await response.text();

  let parsedResponse;
  try {
    parsedResponse = JSON.parse(text);
  } catch {
    parsedResponse = text;
  }

  if (!response.ok) {
    throw new Error(
      typeof parsedResponse === 'string'
        ? parsedResponse
        : JSON.stringify(parsedResponse)
    );
  }

  return parsedResponse;
}

function showStatus(message, kind = 'success', withPayload = false, payload = null, response = null) {
  elements.statusCard.classList.remove('hidden', 'success', 'error');
  elements.statusCard.classList.add(kind);
  elements.statusText.textContent = message;

  if (withPayload && payload) {
    elements.payloadPreview.textContent = JSON.stringify({ payload, response }, null, 2);
    elements.payloadPreview.classList.remove('hidden');
  } else {
    elements.payloadPreview.textContent = '';
    elements.payloadPreview.classList.add('hidden');
  }
}

function setBusy(isBusy) {
  elements.saveBtn.disabled = isBusy;
  elements.refreshBtn.disabled = isBusy;
  elements.resetBtn.disabled = isBusy;
  elements.userSelect.disabled = isBusy;

  elements.saveBtn.textContent = isBusy ? 'Probíhá…' : 'Odeslat záznam';
}

function rememberUser(userId) {
  if (!userId) return;

  localStorage.setItem(STORAGE_KEYS.user, userId);
  document.cookie =
    `${STORAGE_KEYS.user}=${encodeURIComponent(userId)}; max-age=${60 * 60 * 24 * 365}; path=/; SameSite=Lax`;
}

function hydrateRememberedUser() {
  const remembered =
    localStorage.getItem(STORAGE_KEYS.user) ||
    getCookie(STORAGE_KEYS.user);

  if (
    remembered &&
    [...elements.userSelect.options].some((option) => option.value === remembered)
  ) {
    elements.userSelect.value = remembered;
  }
}

function persistDraftToLocal() {
  const draft = {
    user: elements.userSelect.value || '',
    counts: state.counts
  };

  localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(draft));
}

function restoreDraftFromStorage() {
  try {
    const draft = localStorage.getItem(STORAGE_KEYS.draft);

    if (!draft) {
      return;
    }

    const parsedDraft = JSON.parse(draft);
    state.counts = parsedDraft.counts ?? {};

    if (parsedDraft.user) {
      localStorage.setItem(STORAGE_KEYS.user, parsedDraft.user);
    }
  } catch (error) {
    console.warn('Draft se nepodařilo načíst:', error);
  }
}

function hydrateDraftCounts() {
  Object.keys(state.counts).forEach((key) => {
    state.counts[key] = sanitizeCount(state.counts[key]);
  });
}

function clearDraft() {
  localStorage.removeItem(STORAGE_KEYS.draft);
}

function getCookie(name) {
  const found = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));

  return found ? decodeURIComponent(found.split('=')[1]) : '';
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  try {
    return await navigator.serviceWorker.register('./sw.js');
  } catch (error) {
    console.warn('Service worker se nepodařilo zaregistrovat:', error);
    return null;
  }
}

function getOfflineQueue() {
  try {
    const queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.offlineQueue) || '[]');
    return Array.isArray(queue) ? queue : [];
  } catch (error) {
    console.warn('Offline fronta se nepodařila načíst:', error);
    return [];
  }
}

function saveOfflineQueue(queue) {
  localStorage.setItem(STORAGE_KEYS.offlineQueue, JSON.stringify(queue));
}

function queueOfflinePayload(payload, userName) {
  const queue = getOfflineQueue();
  queue.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    userName,
    payload
  });

  saveOfflineQueue(queue);
  rememberUser(payload.user);
  clearDraft();
}

async function processPendingQueue() {
  if (!navigator.onLine || state.isSyncInProgress) {
    return;
  }

  const queue = getOfflineQueue();

  if (!queue.length) {
    return;
  }

  state.isSyncInProgress = true;
  let remainingQueue = [...queue];
  let sentCount = 0;

  try {
    for (const item of queue) {
      await sendPayloadToApi(item.payload);
      remainingQueue = remainingQueue.filter((queuedItem) => queuedItem.id !== item.id);
      saveOfflineQueue(remainingQueue);
      sentCount += 1;
    }

    if (sentCount > 0) {
      showStatus(`Bylo znovu odesláno ${sentCount} dříve uložených záznamů.`, 'success');
    }
  } catch (error) {
    console.error('Synchronizace fronty selhala:', error);
    showStatus(
      `Nepodařilo se odeslat všechna lokálně uložená data. Ve frontě zbývá ${remainingQueue.length} záznamů.`,
      'error'
    );
  } finally {
    state.isSyncInProgress = false;
  }
}

function recordDailyConsumption(payload, userName) {
  const history = getDailyHistory();
  const dayKey = getTodayKey();

  if (!history[dayKey]) {
    history[dayKey] = {
      date: dayKey,
      users: {}
    };
  }

  const normalizedUserName = userName || 'Neznámý uživatel';

  if (!history[dayKey].users[normalizedUserName]) {
    history[dayKey].users[normalizedUserName] = {};
  }

  payload.drinks.forEach((drink) => {
    const value = sanitizeCount(drink.value);

    if (value <= 0) {
      return;
    }

    const currentValue = sanitizeCount(history[dayKey].users[normalizedUserName][drink.type]);
    history[dayKey].users[normalizedUserName][drink.type] = currentValue + value;
  });

  localStorage.setItem(STORAGE_KEYS.dailyHistory, JSON.stringify(history));
}

function getDailyHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(STORAGE_KEYS.dailyHistory) || '{}');
    return history && typeof history === 'object' ? history : {};
  } catch (error) {
    console.warn('Denní historie se nepodařila načíst:', error);
    return {};
  }
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getSelectedUserName() {
  const selectedOption = elements.userSelect.selectedOptions[0];
  return selectedOption && selectedOption.value ? selectedOption.textContent : 'Neznámý uživatel';
}

function getPayloadTotal(payload) {
  return payload.drinks.reduce((sum, drink) => sum + sanitizeCount(drink.value), 0);
}

async function requestNotificationPermissionIfNeeded() {
  if (!('Notification' in window)) {
    return;
  }

  if (Notification.permission !== 'default') {
    return;
  }

  if (localStorage.getItem(STORAGE_KEYS.notificationPermissionAsked) === 'true') {
    return;
  }

  localStorage.setItem(STORAGE_KEYS.notificationPermissionAsked, 'true');

  try {
    await Notification.requestPermission();
  } catch (error) {
    console.warn('Nepodařilo se získat oprávnění pro notifikace:', error);
  }
}

async function maybeShowDailySummaryNotification() {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const todayKey = getTodayKey();
  const lastShown = localStorage.getItem(STORAGE_KEYS.lastDailyNotificationDate);

  if (lastShown === todayKey) {
    return;
  }

  const history = getDailyHistory();
  const todayHistory = history[todayKey];

  if (!todayHistory || !todayHistory.users) {
    return;
  }

  const lines = Object.entries(todayHistory.users)
    .map(([userName, drinks]) => {
      const summary = Object.entries(drinks)
        .filter(([, value]) => sanitizeCount(value) > 0)
        .map(([drinkType, value]) => `${drinkType} ${value}x`)
        .join(', ');

      return summary ? `${userName}: ${summary}` : '';
    })
    .filter(Boolean);

  if (!lines.length) {
    return;
  }

  const body = lines.join(' | ');
  localStorage.setItem(STORAGE_KEYS.lastDailyNotificationDate, todayKey);

  if (navigator.serviceWorker) {
    const registration = await navigator.serviceWorker.getRegistration();

    if (registration) {
      await registration.showNotification('Denní přehled pití', {
        body,
        tag: `daily-summary-${todayKey}`,
        renotify: false,
        icon: './manifest.webmanifest',
        badge: './manifest.webmanifest'
      });
      return;
    }
  }

  new Notification('Denní přehled pití', { body, tag: `daily-summary-${todayKey}` });
}

init();
