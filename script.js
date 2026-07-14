/* ============================================================
   GYM TRACKER — ПОЛНЫЙ СКРИПТ
   Включает: DB, StatsModule, EquipmentModule, DiaryModule,
             ConfirmModal, PWA, Toast, Network Status
   ============================================================

   СТРУКТУРА ДАННЫХ IndexedDB:

   ObjectStore "equipment":
   {
     id:          "uuid",
     name:        "Жим лёжа",
     description: "...",
     photo:       "data:image/jpeg;base64,...",
     createdAt:   "ISO-дата"
   }

   ObjectStore "diary":
   {
     id:          "uuid",
     date:        "2024-01-15",
     equipmentId: "uuid",
     sets: [
       { weight: 80, reps: 10 },
       { weight: 85, reps: 8  }
     ],
     notes:       "...",
     createdAt:   "ISO-дата"
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

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Форматирование большого числа: 1 234 567 */
function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  return Math.round(num).toLocaleString('ru-RU');
}

/** Toast-уведомление */
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============================================================
// СЛОЙ РАБОТЫ С IndexedDB
// ============================================================
const DB = (() => {
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) { resolve(db); return; }

      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const database = e.target.result;

        if (!database.objectStoreNames.contains(STORE_EQ)) {
          const s = database.createObjectStore(STORE_EQ, { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!database.objectStoreNames.contains(STORE_DI)) {
          const s = database.createObjectStore(STORE_DI, { keyPath: 'id' });
          s.createIndex('date',        'date',        { unique: false });
          s.createIndex('equipmentId', 'equipmentId', { unique: false });
        }
      };

      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  function store(name, mode = 'readonly') {
    return db.transaction(name, mode).objectStore(name);
  }

  function wrap(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }

  // ---- Equipment CRUD ----

  async function getAllEquipment() {
    await open();
    const items = await wrap(store(STORE_EQ).getAll());
    return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async function getEquipmentById(id) {
    await open();
    return wrap(store(STORE_EQ).get(id));
  }

  async function saveEquipment(item) {
    await open();
    return wrap(store(STORE_EQ, 'readwrite').put(item));
  }

  async function deleteEquipment(id) {
    await open();
    await wrap(store(STORE_EQ, 'readwrite').delete(id));

    // Каскадное удаление записей дневника
    const all = await wrap(store(STORE_DI).getAll());
    for (const entry of all.filter(e => e.equipmentId === id)) {
      await wrap(store(STORE_DI, 'readwrite').delete(entry.id));
    }
  }

  // ---- Diary CRUD ----

  async function getAllDiary() {
    await open();
    return wrap(store(STORE_DI).getAll());
  }

  async function getDiaryByDate(date) {
    await open();
    const idx   = store(STORE_DI).index('date');
    const items = await wrap(idx.getAll(date));
    return items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  async function getDiaryEntryById(id) {
    await open();
    return wrap(store(STORE_DI).get(id));
  }

  async function saveDiaryEntry(entry) {
    await open();
    return wrap(store(STORE_DI, 'readwrite').put(entry));
  }

  async function deleteDiaryEntry(id) {
    await open();
    return wrap(store(STORE_DI, 'readwrite').delete(id));
  }

  return {
    getAllEquipment, getEquipmentById, saveEquipment, deleteEquipment,
    getAllDiary, getDiaryByDate, getDiaryEntryById, saveDiaryEntry, deleteDiaryEntry
  };
})();

// ============================================================
// СОСТОЯНИЕ ПРИЛОЖЕНИЯ
// ============================================================
const AppState = {
  equipment:       [],
  currentDate:     null,
  diaryEntries:    [],
  editingEquipId:  null,
  editingDiaryId:  null,
  photoBase64:     null,
  confirmCallback: null
};

// ============================================================
// МОДУЛЬ СТАТИСТИКИ
// Считает и отображает агрегированные данные по всему дневнику.
// Вызывается после любого изменения записей дневника.
// ============================================================
const StatsModule = (() => {

  // DOM-элементы значений
  const elWorkouts  = document.getElementById('statWorkoutsValue');
  const elWeight    = document.getElementById('statWeightValue');
  const elExercises = document.getElementById('statExercisesValue');

  /**
   * Анимированное обновление числа в элементе.
   * Добавляет CSS-класс .updating для визуального эффекта.
   */
  function animateValue(el, newText) {
    el.classList.add('updating');
    setTimeout(() => {
      el.textContent = newText;
      el.classList.remove('updating');
    }, 150);
  }

  /**
   * Подсчёт статистики по всем записям дневника.
   *
   * @param {Array} allEntries — все записи из DB.getAllDiary()
   * @returns {{ workouts: number, totalWeight: number, exercises: number }}
   *
   * Алгоритм:
   * - workouts:    уникальные даты среди всех записей
   * - totalWeight: Σ (weight × reps) по каждому подходу каждой записи
   * - exercises:   общее количество записей (строк) в дневнике
   */
  function calculate(allEntries) {
    // Уникальные даты → количество тренировочных дней
    const uniqueDates = new Set(allEntries.map(e => e.date));
    const workouts = uniqueDates.size;

    // Суммарный поднятый вес: weight × reps для каждого подхода
    let totalWeight = 0;
    let exercises   = 0;

    allEntries.forEach(entry => {
      exercises++; // каждая запись = одно упражнение

      if (Array.isArray(entry.sets)) {
        entry.sets.forEach(set => {
          const w = parseFloat(set.weight) || 0;
          const r = parseInt(set.reps)     || 0;
          totalWeight += w * r;
        });
      }
    });

    return { workouts, totalWeight, exercises };
  }

  /**
   * Публичный метод: загружает все записи из БД,
   * считает статистику и обновляет DOM.
   * Вызывается из DiaryModule после сохранения/удаления.
   */
  async function update() {
    try {
      const allEntries = await DB.getAllDiary();
      const stats = calculate(allEntries);

      // Форматирование суммарного веса:
      // до 1000 кг — показываем кг, свыше — тонны
      let weightText;
      if (stats.totalWeight >= 1000) {
        weightText = (stats.totalWeight / 1000).toFixed(1).replace('.', ',') + ' т';
      } else {
        weightText = formatNumber(stats.totalWeight);
      }

      animateValue(elWorkouts,  formatNumber(stats.workouts));
      animateValue(elWeight,    weightText);
      animateValue(elExercises, formatNumber(stats.exercises));

    } catch (err) {
      console.error('[Stats] Ошибка расчёта статистики:', err);
      // При ошибке показываем прочерки
      elWorkouts.textContent  = '—';
      elWeight.textContent    = '—';
      elExercises.textContent = '—';
    }
  }

  /**
   * Инициализация: первичная загрузка статистики при старте.
   */
  function init() {
    update();
  }

  return { init, update };
})();

// ============================================================
// НАВИГАЦИЯ ПО ТАБАМ
// ============================================================
function initTabs() {
  const buttons  = document.querySelectorAll('.tab-btn');
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

      const id = targetTab === 'equipment' ? 'sectionEquipment' : 'sectionDiary';
      const target = document.getElementById(id);
      target.hidden = false;
      target.classList.add('active');
    });
  });
}

// ============================================================
// МОДУЛЬ: ТРЕНАЖЕРЫ
// ============================================================
const EquipmentModule = (() => {

  const modal           = document.getElementById('modalEquipment');
  const form            = document.getElementById('formEquipment');
  const modalTitle      = document.getElementById('modalEquipmentTitle');
  const inputId         = document.getElementById('equipmentId');
  const inputName       = document.getElementById('equipmentName');
  const inputDesc       = document.getElementById('equipmentDesc');
  const inputPhoto      = document.getElementById('equipmentPhoto');
  const photoPreview    = document.getElementById('photoPreview');
  const photoPlaceholder = document.getElementById('photoPlaceholder');
  const btnRemovePhoto  = document.getElementById('btnRemovePhoto');
  const listEl          = document.getElementById('equipmentList');
  const emptyEl         = document.getElementById('emptyEquipment');
  const errorName       = document.getElementById('errorEquipmentName');

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

  async function openEditModal(id) {
    const item = await DB.getEquipmentById(id);
    if (!item) return;

    AppState.editingEquipId = id;
    AppState.photoBase64    = item.photo || null;
    modalTitle.textContent  = 'Редактировать тренажер';

    inputId.value   = item.id;
    inputName.value = item.name;
    inputDesc.value = item.description || '';

    item.photo ? showPhotoPreview(item.photo) : resetPhotoUI();

    clearErrors();
    modal.hidden = false;
    inputName.focus();
  }

  function closeModal() {
    modal.hidden = true;
    form.reset();
    resetPhotoUI();
    AppState.editingEquipId = null;
    AppState.photoBase64    = null;
  }

  function showPhotoPreview(src) {
    photoPreview.src        = src;
    photoPreview.hidden     = false;
    photoPlaceholder.hidden = true;
    btnRemovePhoto.hidden   = false;
  }

  function resetPhotoUI() {
    photoPreview.src        = '';
    photoPreview.hidden     = true;
    photoPlaceholder.hidden = false;
    btnRemovePhoto.hidden   = true;
    inputPhoto.value        = '';
  }

  function clearErrors() {
    errorName.textContent       = '';
    inputName.style.borderColor = '';
  }

  function validate() {
    let valid = true;
    clearErrors();

    if (!inputName.value.trim()) {
      errorName.textContent       = 'Введите название тренажера';
      inputName.style.borderColor = 'var(--color-danger)';
      inputName.focus();
      valid = false;
    }

    return valid;
  }

  function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Выберите файл изображения', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast('Файл слишком большой (максимум 5 МБ)', 'error');
      return;
    }

    // FileReader API: читаем файл как base64 Data URL
    const reader = new FileReader();
    reader.onload = (e) => {
      AppState.photoBase64 = e.target.result;
      showPhotoPreview(e.target.result);
    };
    reader.onerror = () => showToast('Ошибка чтения файла', 'error');
    reader.readAsDataURL(file);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!validate()) return;

    const existingCreatedAt = AppState.editingEquipId
      ? (await DB.getEquipmentById(AppState.editingEquipId))?.createdAt
      : null;

    const item = {
      id:          AppState.editingEquipId || generateId(),
      name:        inputName.value.trim(),
      description: inputDesc.value.trim(),
      photo:       AppState.photoBase64 || null,
      createdAt:   existingCreatedAt || new Date().toISOString()
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

  async function handleDelete(id) {
    const item = AppState.equipment.find(e => e.id === id);
    if (!item) return;

    ConfirmModal.show(
      `Удалить тренажер «${item.name}»?\nВсе записи в дневнике с этим тренажером также будут удалены.`,
      async () => {
        try {
          await DB.deleteEquipment(id);
          await loadAndRender();

          // Обновляем дневник и статистику
          if (AppState.currentDate) {
            await DiaryModule.loadAndRender(AppState.currentDate);
          }
          await StatsModule.update(); // ← обновляем статистику

          showToast('Тренажер удалён', 'success');
        } catch (err) {
          console.error('[Equipment] Ошибка удаления:', err);
          showToast('Ошибка удаления', 'error');
        }
      }
    );
  }

  async function loadAndRender() {
    try {
      AppState.equipment = await DB.getAllEquipment();
      renderList();
    } catch (err) {
      console.error('[Equipment] Ошибка загрузки:', err);
      showToast('Ошибка загрузки тренажеров', 'error');
    }
  }

  function renderList() {
    listEl.innerHTML = '';

    if (AppState.equipment.length === 0) {
      emptyEl.hidden = false;
      return;
    }

    emptyEl.hidden = true;
    AppState.equipment.forEach(item => listEl.appendChild(createCard(item)));
  }

  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'equipment-card';
    card.dataset.id = item.id;

    const imgHtml = item.photo
      ? `<img class="equipment-card__img" src="${item.photo}" alt="${escapeHtml(item.name)}" loading="lazy" />`
      : `<span class="equipment-card__img-placeholder">🏋️</span>`;

    card.innerHTML = `
      <div class="equipment-card__img-wrap">${imgHtml}</div>
      <div class="equipment-card__body">
        <div class="equipment-card__name">${escapeHtml(item.name)}</div>
        <div class="equipment-card__desc">
          ${escapeHtml(item.description) || '<em style="opacity:.5">Без описания</em>'}
        </div>
      </div>
      <div class="equipment-card__actions">
        <button class="btn btn-secondary btn-sm btn-edit" data-id="${item.id}">✏️ Изменить</button>
        <button class="btn btn-danger btn-sm btn-delete" data-id="${item.id}">🗑 Удалить</button>
      </div>
    `;

    card.querySelector('.btn-edit').addEventListener('click', () => openEditModal(item.id));
    card.querySelector('.btn-delete').addEventListener('click', () => handleDelete(item.id));

    return card;
  }

  function init() {
    document.getElementById('btnAddEquipment').addEventListener('click', openAddModal);
    document.getElementById('btnAddEquipmentEmpty').addEventListener('click', openAddModal);
    document.getElementById('btnCloseEquipmentModal').addEventListener('click', closeModal);
    document.getElementById('btnCancelEquipment').addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    form.addEventListener('submit', handleSubmit);
    inputPhoto.addEventListener('change', handleFileSelect);

    btnRemovePhoto.addEventListener('click', () => {
      AppState.photoBase64 = null;
      resetPhotoUI();
    });

    loadAndRender();
  }

  return { init, loadAndRender };
})();

// ============================================================
// МОДУЛЬ: ДНЕВНИК ТРЕНИРОВОК
// ============================================================
const DiaryModule = (() => {

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

  // ---- Управление подходами ----

  function addSetRow(weight = '', reps = '') {
    setsCount++;
    const row = document.createElement('div');
    row.className = 'set-row';

    row.innerHTML = `
      <span class="set-row__num">${setsCount}</span>
      <input type="number" class="set-weight" placeholder="Вес (кг)"
             value="${weight}" min="0" max="9999" step="0.5"
             aria-label="Вес подхода ${setsCount}" />
      <input type="number" class="set-reps" placeholder="Повторений"
             value="${reps}" min="1" max="9999" step="1"
             aria-label="Повторений в подходе ${setsCount}" />
      <button type="button" class="btn-icon btn-remove-set" aria-label="Удалить подход">✕</button>
    `;

    row.querySelector('.btn-remove-set').addEventListener('click', () => {
      row.remove();
      renumberSets();
    });

    setsList.appendChild(row);
  }

  function renumberSets() {
    setsList.querySelectorAll('.set-row').forEach((row, idx) => {
      row.querySelector('.set-row__num').textContent = idx + 1;
    });
    setsCount = setsList.querySelectorAll('.set-row').length;
  }

  function getSetsData() {
    return Array.from(setsList.querySelectorAll('.set-row')).map(row => ({
      weight: parseFloat(row.querySelector('.set-weight').value) || 0,
      reps:   parseInt(row.querySelector('.set-reps').value)     || 0
    }));
  }

  // ---- Модал ----

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

  function openAddModal(date) {
    AppState.editingDiaryId = null;
    modalTitle.textContent  = 'Добавить запись';
    form.reset();
    setsList.innerHTML = '';
    setsCount = 0;
    inputEntryDate.value = date;
    populateEquipmentSelect();
    clearErrors();
    addSetRow(); addSetRow(); addSetRow(); // 3 подхода по умолчанию
    modal.hidden = false;
    selectEquip.focus();
  }

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

    if (entry.sets?.length > 0) {
      entry.sets.forEach(s => addSetRow(s.weight, s.reps));
    } else {
      addSetRow();
    }

    clearErrors();
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
    form.reset();
    setsList.innerHTML = '';
    setsCount = 0;
    AppState.editingDiaryId = null;
  }

  function clearErrors() {
    errorEquip.textContent        = '';
    selectEquip.style.borderColor = '';
  }

  function validate() {
    let valid = true;
    clearErrors();

    if (!selectEquip.value) {
      errorEquip.textContent        = 'Выберите тренажер';
      selectEquip.style.borderColor = 'var(--color-danger)';
      selectEquip.focus();
      valid = false;
    }

    return valid;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!validate()) return;

    const date = inputEntryDate.value || AppState.currentDate;

    const existingCreatedAt = AppState.editingDiaryId
      ? (await DB.getDiaryEntryById(AppState.editingDiaryId))?.createdAt
      : null;

    const entry = {
      id:          AppState.editingDiaryId || generateId(),
      date:        date,
      equipmentId: selectEquip.value,
      sets:        getSetsData(),
      notes:       inputNotes.value.trim(),
      createdAt:   existingCreatedAt || new Date().toISOString()
    };

    try {
      await DB.saveDiaryEntry(entry);
      await loadAndRender(date);

      // ← КЛЮЧЕВОЙ МОМЕНТ: обновляем статистику после сохранения записи
      await StatsModule.update();

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

  async function handleDelete(id) {
    const entry = AppState.diaryEntries.find(e => e.id === id);
    const equip = AppState.equipment.find(e => e.id === entry?.equipmentId);

    ConfirmModal.show(
      `Удалить запись «${equip?.name || 'упражнение'}» из дневника?`,
      async () => {
        try {
          await DB.deleteDiaryEntry(id);
          await loadAndRender(AppState.currentDate);

          // ← обновляем статистику после удаления записи
          await StatsModule.update();

          showToast('Запись удалена', 'success');
        } catch (err) {
          console.error('[Diary] Ошибка удаления:', err);
          showToast('Ошибка удаления', 'error');
        }
      }
    );
  }

  async function loadAndRender(date) {
    if (!date) return;
    AppState.currentDate = date;

    try {
      AppState.diaryEntries = await DB.getDiaryByDate(date);
      renderEntries();
    } catch (err) {
      console.error('[Diary] Ошибка загрузки:', err);
      showToast('Ошибка загрузки дневника', 'error');
    }
  }

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
      entryList.appendChild(createEntryCard(entry, equip));
    });
  }

  function createEntryCard(entry, equip) {
    const card = document.createElement('div');
    card.className = 'diary-entry-card';

    const thumbHtml = equip?.photo
      ? `<img class="diary-entry-card__thumb" src="${equip.photo}" alt="${escapeHtml(equip.name)}" loading="lazy" />`
      : `<div class="diary-entry-card__thumb-placeholder">🏋️</div>`;

    // Таблица подходов
    let setsHtml = '';
    if (entry.sets?.length > 0) {
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
            <tr><th>#</th><th>Вес</th><th>Повторения</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } else {
      setsHtml = `<p style="color:var(--color-text-muted);font-size:.85rem">Подходы не указаны</p>`;
    }

    const notesHtml = entry.notes
      ? `<div class="diary-entry-card__notes">💬 ${escapeHtml(entry.notes)}</div>`
      : '';

    card.innerHTML = `
      <div class="diary-entry-card__header">
        ${thumbHtml}
        <span class="diary-entry-card__name">
          ${escapeHtml(equip?.name || 'Тренажер удалён')}
        </span>
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

  function init() {
    dateInput.value = getTodayString();

    dateInput.addEventListener('change', () => {
      if (dateInput.value) loadAndRender(dateInput.value);
    });

    document.getElementById('btnAddDiaryEntry').addEventListener('click', () => {
      if (AppState.equipment.length === 0) {
        showToast('Сначала добавьте тренажеры в раздел «Тренажеры»', 'info');
        return;
      }
      openAddModal(AppState.currentDate);
    });

    document.getElementById('btnAddSet').addEventListener('click', () => addSetRow());
    document.getElementById('btnCloseDiaryModal').addEventListener('click', closeModal);
    document.getElementById('btnCancelDiary').addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    form.addEventListener('submit', handleSubmit);
  }

  return { init, loadAndRender };
})();

// ============================================================
// МОДУЛЬ: ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ
// ============================================================
const ConfirmModal = (() => {
  const modal     = document.getElementById('modalConfirm');
  const message   = document.getElementById('confirmMessage');
  const btnOk     = document.getElementById('btnConfirmOk');
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
    modal.addEventListener('click', (e) => { if (e.target === modal) hide(); });
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
        .then(reg => console.log('[SW] Зарегистрирован:', reg.scope))
        .catch(err => console.warn('[SW] Ошибка:', err));
    });
  }
}

// ============================================================
// СТАТУС СЕТИ
// ============================================================
function initNetworkStatus() {
  const el = document.getElementById('pwaStatus');

  function update() {
    el.textContent = navigator.onLine ? '🟢' : '🔴';
    el.title       = navigator.onLine ? 'Онлайн' : 'Офлайн';
    if (!navigator.onLine) showToast('Нет подключения. Работаем офлайн.', 'info');
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
    initTabs();
    ConfirmModal.init();
    EquipmentModule.init();
    DiaryModule.init();

    // Загружаем дневник за сегодня
    await DiaryModule.loadAndRender(getTodayString());

    // Инициализируем статистику (загружает данные из БД)
    StatsModule.init();

    registerServiceWorker();
    initNetworkStatus();

    console.log('[App] Gym Tracker запущен ✅');
  } catch (err) {
    console.error('[App] Ошибка инициализации:', err);
    showToast('Ошибка запуска приложения', 'error');
  }
}

document.addEventListener('DOMContentLoaded', initApp);
