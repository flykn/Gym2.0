/* ============================================================
   GYM TRACKER — ГЛАВНЫЙ СКРИПТ
   ============================================================

   СТРУКТУРА ДАННЫХ (IndexedDB / localStorage):

   Тренажеры (objectStore: "equipment"):
   {
     id:          "uuid-строка",
     name:        "Жим лёжа",
     description: "Описание упражнения...",
     photo:       "data:image/jpeg;base64,...",  // base64 или null
     createdAt:   "2024-01-15T10:30:00.000Z"
   }

   Записи дневника (objectStore: "diary"):
   {
     id:          "uuid-строка",
     date:        "2024-01-15",               // YYYY-MM-DD
     equipmentId: "uuid-тренажера",
     sets: [
       { weight: 80, reps: 10 },
       { weight: 85, reps: 8  },
       { weight: 90, reps: 6  }
     ],
     notes:       "Хорошая тренировка",
     createdAt:   "2024-01-15T10:30:00.000Z"
   }

   ============================================================ */

'use strict';

// ============================================================
// КОНСТАНТЫ
// ============================================================
const DB_NAME    = 'GymTrackerDB';
const DB_VERSION = 1;
const STORE_EQ   = 'equipment';
const STORE_DI   = 'diary';

// ============================================================
// УТИЛИТЫ
// ============================================================

/** Генерация уникального ID */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Форматирование даты для отображения */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

/** Получение текущей даты в формате YYYY-MM-DD */
function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Показ Toast-уведомления */
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/** Экранирование HTML для безопасного вывода */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// СЛОЙ РАБОТЫ С IndexedDB
// ============================================================
const DB = (() => {
  let db = null;

  /** Открытие / инициализация базы данных */
  function open() {
    return new Promise((resolve, reject) => {
      if (db) { resolve(db); return; }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      // Создание хранилищ при первом запуске или обновлении версии
      request.onupgradeneeded = (event) => {
        const database = event.target.result;

        if (!database.objectStoreNames.contains(STORE_EQ)) {
          const eqStore = database.createObjectStore(STORE_EQ, { keyPath: 'id' });
          eqStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!database.objectStoreNames.contains(STORE_DI)) {
          const diStore = database.createObjectStore(STORE_DI, { keyPath: 'id' });
          diStore.createIndex('date', 'date', { unique: false });
          diStore.createIndex('equipmentId', 'equipmentId', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = (event) => {
        console.error('[DB] Ошибка открытия:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /** Выполнение транзакции */
  function transaction(storeName, mode = 'readonly') {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  /** Обёртка промиса над IDBRequest */
  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror  = () => reject(request.error);
    });
  }

  // --- CRUD для тренажеров ---

  async function getAllEquipment() {
    await open();
    const store = transaction(STORE_EQ, 'readonly');
    const items = await promisify(store.getAll());
    // Сортировка по дате создания (новые сначала)
    return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async function getEquipmentById(id) {
    await open();
    const store = transaction(STORE_EQ, 'readonly');
    return promisify(store.get(id));
  }

  async function saveEquipment(item) {
    await open();
    const store = transaction(STORE_EQ, 'readwrite');
    return promisify(store.put(item));
  }

  async function deleteEquipment(id) {
    await open();
    // Удаляем тренажер
    const eqStore = transaction(STORE_EQ, 'readwrite');
    await promisify(eqStore.delete(id));

    // Каскадно удаляем все записи дневника с этим тренажером
    const diStore = transaction(STORE_DI, 'readwrite');
    const allDiary = await promisify(diStore.getAll());
    const toDelete = allDiary.filter(e => e.equipmentId === id);
    for (const entry of toDelete) {
      await promisify(
        db.transaction(STORE_DI, 'readwrite').objectStore(STORE_DI).delete(entry.id)
      );
    }
  }

  // --- CRUD для дневника ---

  async function getDiaryByDate(date) {
    await open();
    const store = transaction(STORE_DI, 'readonly');
    const index = store.index('date');
    const items = await promisify(index.getAll(date));
    return items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  async function getDiaryEntryById(id) {
    await open();
    const store = transaction(STORE_DI, 'readonly');
    return promisify(store.get(id));
  }

  async function saveDiaryEntry(entry) {
    await open();
    const store = transaction(STORE_DI, 'readwrite');
    return promisify(store.put(entry));
  }

  async function deleteDiaryEntry(id) {
    await open();
    const store = transaction(STORE_DI, 'readwrite');
    return promisify(store.delete(id));
  }

  return {
    getAllEquipment,
    getEquipmentById,
    saveEquipment,
    deleteEquipment,
    getDiaryByDate,
    getDiaryEntryById,
    saveDiaryEntry,
    deleteDiaryEntry
  };
})();

// ============================================================
// СОСТОЯНИЕ ПРИЛОЖЕНИЯ
// ============================================================
const AppState = {
  equipment:       [],    // Кэш тренажеров
  currentDate:     null,  // Выбранная дата в дневнике
  diaryEntries:    [],    // Записи за выбранную дату
  editingEquipId:  null,  // ID редактируемого тренажера
  editingDiaryId:  null,  // ID редактируемой записи
  photoBase64:     null,  // Текущее фото в форме (base64)
  confirmCallback: null   // Коллбэк для модала подтверждения
};

// ============================================================
// НАВИГАЦИЯ ПО ТАБАМ
// ============================================================
function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const sections = document.querySelectorAll('.tab-section');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;

      buttons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });

      sections.forEach(s => {
        s.hidden = true;
        s.classList.remove('active');
      });

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      const targetSection = document.getElementById(
        targetTab === 'equipment' ? 'sectionEquipment' : 'sectionDiary'
      );
      targetSection.hidden = false;
      targetSection.classList.add('active');
    });
  });
}

// ============================================================
// МОДУЛЬ: ТРЕНАЖЕРЫ
// ============================================================
const EquipmentModule = (() => {

  // --- DOM-элементы ---
  const modal          = document.getElementById('modalEquipment');
  const form           = document.getElementById('formEquipment');
  const modalTitle     = document.getElementById('modalEquipmentTitle');
  const inputId        = document.getElementById('equipmentId');
  const inputName      = document.getElementById('equipmentName');
  const inputDesc      = document.getElementById('equipmentDesc');
  const inputPhoto     = document.getElementById('equipmentPhoto');
  const photoPreview   = document.getElementById('photoPreview');
  const photoPlaceholder = document.getElementById('photoPlaceholder');
  const btnRemovePhoto = document.getElementById('btnRemovePhoto');
  const listEl         = document.getElementById('equipmentList');
  const emptyEl        = document.getElementById('emptyEquipment');
  const errorName      = document.getElementById('errorEquipmentName');

  /** Открытие модала добавления */
  function openAddModal() {
    AppState.editingEquipId = null;
    AppState.photoBase64    = null;
    modalTitle.textContent  = 'Добавить тренажер';
    form.reset();
    resetPhotoUI();
    clearErrors();
    modal.hidden = false;
    inputName.focus();
  }

  /** Открытие модала редактирования */
  async function openEditModal(id) {
    const item = await DB.getEquipmentById(id);
    if (!item) return;

    AppState.editingEquipId = id;
    AppState.photoBase64    = item.photo || null;
    modalTitle.textContent  = 'Редактировать тренажер';

    inputId.value   = item.id;
    inputName.value = item.name;
    inputDesc.value = item.description || '';

    if (item.photo) {
      showPhotoPreview(item.photo);
    } else {
      resetPhotoUI();
    }

    clearErrors();
    modal.hidden = false;
    inputName.focus();
  }

  /** Закрытие модала */
  function closeModal() {
    modal.hidden = true;
    form.reset();
    resetPhotoUI();
    AppState.editingEquipId = null;
    AppState.photoBase64    = null;
  }

  /** Показ превью фото */
  function showPhotoPreview(src) {
    photoPreview.src    = src;
    photoPreview.hidden = false;
    photoPlaceholder.hidden = true;
    btnRemovePhoto.hidden   = false;
  }

  /** Сброс UI фото */
  function resetPhotoUI() {
    photoPreview.src        = '';
    photoPreview.hidden     = true;
    photoPlaceholder.hidden = false;
    btnRemovePhoto.hidden   = true;
    inputPhoto.value        = '';
  }

  /** Очистка ошибок валидации */
  function clearErrors() {
    errorName.textContent = '';
    inputName.style.borderColor = '';
  }

  /** Валидация формы */
  function validate() {
    let valid = true;
    clearErrors();

    if (!inputName.value.trim()) {
      errorName.textContent = 'Введите название тренажера';
      inputName.style.borderColor = 'var(--color-danger)';
      inputName.focus();
      valid = false;
    }

    return valid;
  }

  /** Обработка выбора файла */
  function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Проверка типа файла
    if (!file.type.startsWith('image/')) {
      showToast('Выберите файл изображения', 'error');
      return;
    }

    // Ограничение размера: 5 МБ
    if (file.size > 5 * 1024 * 1024) {
      showToast('Файл слишком большой (максимум 5 МБ)', 'error');
      return;
    }

    // Чтение файла как base64 через FileReader API
    const reader = new FileReader();
    reader.onload = (e) => {
      AppState.photoBase64 = e.target.result;
      showPhotoPreview(e.target.result);
    };
    reader.onerror = () => showToast('Ошибка чтения файла', 'error');
    reader.readAsDataURL(file);
  }

  /** Сохранение тренажера */
  async function handleSubmit(event) {
    event.preventDefault();
    if (!validate()) return;

    const item = {
      id:          AppState.editingEquipId || generateId(),
      name:        inputName.value.trim(),
      description: inputDesc.value.trim(),
      photo:       AppState.photoBase64 || null,
      createdAt:   AppState.editingEquipId
                     ? (await DB.getEquipmentById(AppState.editingEquipId))?.createdAt
                     : new Date().toISOString()
    };

    try {
      await DB.saveEquipment(item);
      await loadAndRender();
      closeModal();
      showToast(
        AppState.editingEquipId ? 'Тренажер обновлён' : 'Тренажер добавлен',
        'success'
      );
    } catch (err) {
      console.error('[Equipment] Ошибка сохранения:', err);
      showToast('Ошибка сохранения', 'error');
    }
  }

  /** Удаление тренажера с подтверждением */
  async function handleDelete(id) {
    const item = AppState.equipment.find(e => e.id === id);
    if (!item) return;

    ConfirmModal.show(
      `Удалить тренажер «${item.name}»?\nВсе записи в дневнике с этим тренажером также будут удалены.`,
      async () => {
        try {
          await DB.deleteEquipment(id);
          await loadAndRender();

          // Обновляем дневник, если открыт
          if (AppState.currentDate) {
            await DiaryModule.loadAndRender(AppState.currentDate);
          }

          showToast('Тренажер удалён', 'success');
        } catch (err) {
          console.error('[Equipment] Ошибка удаления:', err);
          showToast('Ошибка удаления', 'error');
        }
      }
    );
  }

  /** Загрузка данных и рендер списка */
  async function loadAndRender() {
    try {
      AppState.equipment = await DB.getAllEquipment();
      renderList();
    } catch (err) {
      console.error('[Equipment] Ошибка загрузки:', err);
      showToast('Ошибка загрузки тренажеров', 'error');
    }
  }

  /** Рендер списка тренажеров */
  function renderList() {
    listEl.innerHTML = '';

    if (AppState.equipment.length === 0) {
      emptyEl.hidden = false;
      return;
    }

    emptyEl.hidden = true;

    AppState.equipment.forEach(item => {
      const card = createCard(item);
      listEl.appendChild(card);
    });
  }

  /** Создание DOM-карточки тренажера */
  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'equipment-card';
    card.dataset.id = item.id;

    const imgHtml = item.photo
      ? `<img class="equipment-card__img" src="${item.photo}" alt="${escapeHtml(item.name)}" loading="lazy" />`
      : `<span class="equipment-card__img-placeholder">🏋️</span>`;

    card.innerHTML = `
      <div class="equipment-card__img-wrap">
        ${imgHtml}
      </div>
      <div class="equipment-card__body">
        <div class="equipment-card__name">${escapeHtml(item.name)}</div>
        <div class="equipment-card__desc">${escapeHtml(item.description) || '<em style="opacity:.5">Без описания</em>'}</div>
      </div>
      <div class="equipment-card__actions">
        <button class="btn btn-secondary btn-sm btn-edit" data-id="${item.id}">
          ✏️ Изменить
        </button>
        <button class="btn btn-danger btn-sm btn-delete" data-id="${item.id}">
          🗑 Удалить
        </button>
      </div>
    `;

    // Обработчики кнопок карточки
    card.querySelector('.btn-edit').addEventListener('click', () => openEditModal(item.id));
    card.querySelector('.btn-delete').addEventListener('click', () => handleDelete(item.id));

    return card;
  }

  /** Инициализация модуля */
  function init() {
    // Кнопки открытия модала
    document.getElementById('btnAddEquipment').addEventListener('click', openAddModal);
    document.getElementById('btnAddEquipmentEmpty').addEventListener('click', openAddModal);

    // Закрытие модала
    document.getElementById('btnCloseEquipmentModal').addEventListener('click', closeModal);
    document.getElementById('btnCancelEquipment').addEventListener('click', closeModal);

    // Клик по оверлею — закрытие
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Отправка формы
    form.addEventListener('submit', handleSubmit);

    // Выбор фото
    inputPhoto.addEventListener('change', handleFileSelect);

    // Удаление фото
    btnRemovePhoto.addEventListener('click', () => {
      AppState.photoBase64 = null;
      resetPhotoUI();
    });

    // Загрузка данных при старте
    loadAndRender();
  }

  return { init, loadAndRender };
})();

// ============================================================
// МОДУЛЬ: ДНЕВНИК ТРЕНИРОВОК
// ============================================================
const DiaryModule = (() => {

  // --- DOM-элементы ---
  const dateInput      = document.getElementById('diaryDate');
  const dayHeader      = document.getElementById('diaryDayHeader');
  const dayTitle       = document.getElementById('diaryDayTitle');
  const entryList      = document.getElementById('diaryEntryList');
  const emptyDiary     = document.getElementById('emptyDiary');
  const diaryHint      = document.getElementById('diaryHint');
  const modal          = document.getElementById('modalDiary');
  const form           = document.getElementById('formDiary');
  const modalTitle     = document.getElementById('modalDiaryTitle');
  const inputEntryId   = document.getElementById('diaryEntryId');
  const inputEntryDate = document.getElementById('diaryEntryDate');
  const selectEquip    = document.getElementById('diaryEquipmentSelect');
  const setsList       = document.getElementById('setsList');
  const inputNotes     = document.getElementById('diaryNotes');
  const errorEquip     = document.getElementById('errorDiaryEquipment');

  let setsCount = 0;

  // --- Управление подходами ---

  /** Добавление строки подхода */
  function addSetRow(weight = '', reps = '') {
    setsCount++;
    const row = document.createElement('div');
    row.className = 'set-row';
    row.dataset.setIndex = setsCount;

    row.innerHTML = `
      <span class="set-row__num">${setsCount}</span>
      <input
        type="number"
        class="set-weight"
        placeholder="Вес (кг)"
        value="${weight}"
        min="0"
        max="9999"
        step="0.5"
        aria-label="Вес подхода ${setsCount}"
      />
      <input
        type="number"
        class="set-reps"
        placeholder="Повторений"
        value="${reps}"
        min="1"
        max="9999"
        step="1"
        aria-label="Повторений в подходе ${setsCount}"
      />
      <button type="button" class="btn-icon btn-remove-set" aria-label="Удалить подход">✕</button>
    `;

    row.querySelector('.btn-remove-set').addEventListener('click', () => {
      row.remove();
      renumberSets();
    });

    setsList.appendChild(row);
  }

  /** Перенумерация подходов после удаления */
  function renumberSets() {
    const rows = setsList.querySelectorAll('.set-row');
    rows.forEach((row, idx) => {
      row.querySelector('.set-row__num').textContent = idx + 1;
    });
    setsCount = rows.length;
  }

  /** Получение данных подходов из формы */
  function getSetsData() {
    const rows = setsList.querySelectorAll('.set-row');
    const sets = [];

    rows.forEach(row => {
      const weight = parseFloat(row.querySelector('.set-weight').value) || 0;
      const reps   = parseInt(row.querySelector('.set-reps').value)    || 0;
      sets.push({ weight, reps });
    });

    return sets;
  }

  // --- Модал ---

  /** Заполнение select тренажеров */
  function populateEquipmentSelect(selectedId = '') {
    selectEquip.innerHTML = '<option value="">— Выберите тренажер —</option>';

    AppState.equipment.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      if (item.id === selectedId) opt.selected = true;
      selectEquip.appendChild(opt);
    });
  }

  /** Открытие модала добавления записи */
  function openAddModal(date) {
    AppState.editingDiaryId = null;
    modalTitle.textContent  = 'Добавить запись';
    form.reset();
    setsList.innerHTML = '';
    setsCount = 0;
    inputEntryDate.value = date;
    populateEquipmentSelect();
    clearErrors();

    // По умолчанию — 3 подхода
    addSetRow();
    addSetRow();
    addSetRow();

    modal.hidden = false;
    selectEquip.focus();
  }

  /** Открытие модала редактирования записи */
  async function openEditModal(id) {
    const entry = await DB.getDiaryEntryById(id);
    if (!entry) return;

    AppState.editingDiaryId = id;
    modalTitle.textContent  = 'Редактировать запись';

    inputEntryId.value   = entry.id;
    inputEntryDate.value = entry.date;
    inputNotes.value     = entry.notes || '';

    populateEquipmentSelect(entry.equipmentId);

    setsList.innerHTML = '';
    setsCount = 0;

    if (entry.sets && entry.sets.length > 0) {
      entry.sets.forEach(s => addSetRow(s.weight, s.reps));
    } else {
      addSetRow();
    }

    clearErrors();
    modal.hidden = false;
  }

  /** Закрытие модала */
  function closeModal() {
    modal.hidden = true;
    form.reset();
    setsList.innerHTML = '';
    setsCount = 0;
    AppState.editingDiaryId = null;
  }

  /** Очистка ошибок */
  function clearErrors() {
    errorEquip.textContent = '';
    selectEquip.style.borderColor = '';
  }

  /** Валидация формы дневника */
  function validate() {
    let valid = true;
    clearErrors();

    if (!selectEquip.value) {
      errorEquip.textContent = 'Выберите тренажер';
      selectEquip.style.borderColor = 'var(--color-danger)';
      selectEquip.focus();
      valid = false;
    }

    return valid;
  }

  /** Сохранение записи */
  async function handleSubmit(event) {
    event.preventDefault();
    if (!validate()) return;

    const sets = getSetsData();
    const date = inputEntryDate.value || AppState.currentDate;

    const entry = {
      id:          AppState.editingDiaryId || generateId(),
      date:        date,
      equipmentId: selectEquip.value,
      sets:        sets,
      notes:       inputNotes.value.trim(),
      createdAt:   AppState.editingDiaryId
                     ? (await DB.getDiaryEntryById(AppState.editingDiaryId))?.createdAt
                     : new Date().toISOString()
    };

    try {
      await DB.saveDiaryEntry(entry);
      await loadAndRender(date);
      closeModal();
      showToast(
        AppState.editingDiaryId ? 'Запись обновлена' : 'Запись добавлена',
        'success'
      );
    } catch (err) {
      console.error('[Diary] Ошибка сохранения:', err);
      showToast('Ошибка сохранения', 'error');
    }
  }

  /** Удаление записи с подтверждением */
  async function handleDelete(id) {
    const entry = AppState.diaryEntries.find(e => e.id === id);
    const equip = AppState.equipment.find(e => e.id === entry?.equipmentId);
    const name  = equip?.name || 'запись';

    ConfirmModal.show(
      `Удалить запись «${name}» из дневника?`,
      async () => {
        try {
          await DB.deleteDiaryEntry(id);
          await loadAndRender(AppState.currentDate);
          showToast('Запись удалена', 'success');
        } catch (err) {
          console.error('[Diary] Ошибка удаления:', err);
          showToast('Ошибка удаления', 'error');
        }
      }
    );
  }

  /** Загрузка и рендер записей за дату */
  async function loadAndRender(date) {
    if (!date) return;
    AppState.currentDate  = date;

    try {
      AppState.diaryEntries = await DB.getDiaryByDate(date);
      renderEntries();
    } catch (err) {
      console.error('[Diary] Ошибка загрузки:', err);
      showToast('Ошибка загрузки дневника', 'error');
    }
  }

  /** Рендер записей */
  function renderEntries() {
    entryList.innerHTML = '';
    diaryHint.hidden    = true;
    dayHeader.hidden    = false;
    dayTitle.textContent = formatDate(AppState.currentDate);

    if (AppState.diaryEntries.length === 0) {
      emptyDiary.hidden = false;
      return;
    }

    emptyDiary.hidden = true;

    AppState.diaryEntries.forEach(entry => {
      const equip = AppState.equipment.find(e => e.id === entry.equipmentId);
      const card  = createEntryCard(entry, equip);
      entryList.appendChild(card);
    });
  }

  /** Создание карточки записи дневника */
  function createEntryCard(entry, equip) {
    const card = document.createElement('div');
    card.className = 'diary-entry-card';

    // Миниатюра тренажера
    const thumbHtml = equip?.photo
      ? `<img class="diary-entry-card__thumb" src="${equip.photo}" alt="${escapeHtml(equip?.name)}" loading="lazy" />`
      : `<div class="diary-entry-card__thumb-placeholder">🏋️</div>`;

    // Таблица подходов
    let setsHtml = '';
    if (entry.sets && entry.sets.length > 0) {
      const rows = entry.sets.map((s, i) => `
        <tr>
          <td class="set-number">${i + 1}</td>
          <td>${s.weight > 0 ? `${s.weight} кг` : '—'}</td>
          <td>${s.reps > 0 ? `${s.reps} повт.` : '—'}</td>
        </tr>
      `).join('');

      setsHtml = `
        <table class="sets-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Вес</th>
              <th>Повторения</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } else {
      setsHtml = '<p style="color:var(--color-text-muted);font-size:.85rem">Подходы не указаны</p>';
    }

    // Заметки
    const notesHtml = entry.notes
      ? `<div class="diary-entry-card__notes">💬 ${escapeHtml(entry.notes)}</div>`
      : '';

    card.innerHTML = `
      <div class="diary-entry-card__header">
        ${thumbHtml}
        <span class="diary-entry-card__name">${escapeHtml(equip?.name || 'Тренажер удалён')}</span>
        <div class="diary-entry-card__actions">
          <button class="btn-icon btn-edit-entry" data-id="${entry.id}" title="Редактировать">✏️</button>
          <button class="btn-icon btn-delete-entry" data-id="${entry.id}" title="Удалить">🗑</button>
        </div>
      </div>
      <div class="diary-entry-card__body">
        ${setsHtml}
        ${notesHtml}
      </div>
    `;

    card.querySelector('.btn-edit-entry').addEventListener('click', () => openEditModal(entry.id));
    card.querySelector('.btn-delete-entry').addEventListener('click', () => handleDelete(entry.id));

    return card;
  }

  /** Инициализация модуля */
  function init() {
    // Установка сегодняшней даты по умолчанию
    dateInput.value = getTodayString();

    // Изменение даты
    dateInput.addEventListener('change', () => {
      const date = dateInput.value;
      if (date) loadAndRender(date);
    });

    // Кнопка добавления записи
    document.getElementById('btnAddDiaryEntry').addEventListener('click', () => {
      if (AppState.equipment.length === 0) {
        showToast('Сначала добавьте тренажеры в раздел «Тренажеры»', 'info');
        return;
      }
      openAddModal(AppState.currentDate);
    });

    // Добавление подхода
    document.getElementById('btnAddSet').addEventListener('click', () => addSetRow());

    // Закрытие модала
    document.getElementById('btnCloseDiaryModal').addEventListener('click', closeModal);
    document.getElementById('btnCancelDiary').addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Отправка формы
    form.addEventListener('submit', handleSubmit);
  }

  return { init, loadAndRender };
})();

// ============================================================
// МОДУЛЬ: МОДАЛ ПОДТВЕРЖДЕНИЯ УДАЛЕНИЯ
// ============================================================
const ConfirmModal = (() => {
  const modal   = document.getElementById('modalConfirm');
  const message = document.getElementById('confirmMessage');
  const btnOk   = document.getElementById('btnConfirmOk');
  const btnCancel = document.getElementById('btnConfirmCancel');

  function show(text, onConfirm) {
    message.textContent      = text;
    AppState.confirmCallback = onConfirm;
    modal.hidden = false;
  }

  function hide() {
    modal.hidden = true;
    AppState.confirmCallback = null;
  }

  function init() {
    btnOk.addEventListener('click', () => {
      if (typeof AppState.confirmCallback === 'function') {
        AppState.confirmCallback();
      }
      hide();
    });

    btnCancel.addEventListener('click', hide);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) hide();
    });

    // Закрытие по Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) hide();
    });
  }

  return { init, show };
})();

// ============================================================
// PWA: РЕГИСТРАЦИЯ SERVICE WORKER
// ============================================================
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[SW] Зарегистрирован:', reg.scope);
        })
        .catch((err) => {
          console.warn('[SW] Ошибка регистрации:', err);
        });
    });
  }
}

// ============================================================
// ОТСЛЕЖИВАНИЕ СТАТУСА СЕТИ
// ============================================================
function initNetworkStatus() {
  const statusEl = document.getElementById('pwaStatus');

  function update() {
    statusEl.textContent = navigator.onLine ? '🟢' : '🔴';
    statusEl.title       = navigator.onLine ? 'Онлайн' : 'Офлайн';

    if (!navigator.onLine) {
      showToast('Нет подключения к интернету. Работаем офлайн.', 'info');
    }
  }

  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ
// ============================================================
async function initApp() {
  try {
    // Инициализация модулей
    initTabs();
    ConfirmModal.init();
    EquipmentModule.init();
    DiaryModule.init();

    // PWA
    registerServiceWorker();
    initNetworkStatus();

    // Загрузка дневника за сегодня при старте
    const today = getTodayString();
    await DiaryModule.loadAndRender(today);

    console.log('[App] Gym Tracker запущен ✅');
  } catch (err) {
    console.error('[App] Ошибка инициализации:', err);
    showToast('Ошибка запуска приложения', 'error');
  }
}

// Запуск после загрузки DOM
document.addEventListener('DOMContentLoaded', initApp);
