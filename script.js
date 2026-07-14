/* ============================================================
   GYM TRACKER — ПОЛНЫЙ СКРИПТ
   Изменения относительно предыдущей версии:
   [NEW]  StatsModule — подсчёт и отображение статистики
   [MOD]  EquipmentModule.loadAndRender → вызывает StatsModule.update()
   [MOD]  DiaryModule.loadAndRender    → вызывает StatsModule.update()
   [MOD]  DB.getAllDiaryEntries        → новый метод для статистики
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
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Форматирование большого числа для отображения в статистике.
 * Например: 1500 → "1 500", 1200000 → "1 200 000"
 */
function formatStatNumber(num) {
  if (num === null || num === undefined) return '0';
  return Math.round(num).toLocaleString('ru-RU');
}

// ============================================================
// СЛОЙ РАБОТЫ С IndexedDB
// ============================================================
const DB = (() => {
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) { resolve(db); return; }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

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

  function transaction(storeName, mode = 'readonly') {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror  = () => reject(request.error);
    });
  }

  // --- CRUD: Тренажеры ---

  async function getAllEquipment() {
    await open();
    const store = transaction(STORE_EQ, 'readonly');
    const items = await promisify(store.getAll());
    return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async function getEquipmentById(id) {
    await open();
    return promisify(transaction(STORE_EQ, 'readonly').get(id));
  }

  async function saveEquipment(item) {
    await open();
    return promisify(transaction(STORE_EQ, 'readwrite').put(item));
  }

  async function deleteEquipment(id) {
    await open();
    await promisify(transaction(STORE_EQ, 'readwrite').delete(id));

    // Каскадное удаление записей дневника
    const allDiary = await getAllDiaryEntries();
    for (const entry of allDiary.filter(e => e.equipmentId === id)) {
      await promisify(
        db.transaction(STORE_DI, 'readwrite').objectStore(STORE_DI).delete(entry.id)
      );
    }
  }

  // --- CRUD: Дневник ---

  async function getDiaryByDate(date) {
    await open();
    const store = transaction(STORE_DI, 'readonly');
    const items = await promisify(store.index('date').getAll(date));
    return items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  async function getDiaryEntryById(id) {
    await open();
    return promisify(transaction(STORE_DI, 'readonly').get(id));
  }

  /**
   * [NEW] Получение ВСЕХ записей дневника — нужно для подсчёта статистики.
   * Используется только в StatsModule, не влияет на остальную логику.
   */
  async function getAllDiaryEntries() {
    await open();
    return promisify(transaction(STORE_DI, 'readonly').getAll());
  }

  async function saveDiaryEntry(entry) {
    await open();
    return promisify(transaction(STORE_DI, 'readwrite').put(entry));
  }

  async function deleteDiaryEntry(id) {
    await open();
    return promisify(transaction(STORE_DI, 'readwrite').delete(id));
  }

  return {
    getAllEquipment,
    getEquipmentById,
    saveEquipment,
    deleteEquipment,
    getDiaryByDate,
    getDiaryEntryById,
    getAllDiaryEntries,   // [NEW]
    saveDiaryEntry,
    deleteDiaryEntry
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
// [NEW] МОДУЛЬ СТАТИСТИКИ
// ============================================================
const StatsModule = (() => {

  // DOM-элементы
  const loadingEl        = document.getElementById('statsLoading');
  const gridEl           = document.getElementById('statsGrid');
  const workoutsValueEl  = document.getElementById('statWorkoutsValue');
  const weightValueEl    = document.getElementById('statWeightValue');
  const exercisesValueEl = document.getElementById('statExercisesValue');

  /**
   * Анимация изменения числа (плавный счётчик).
   * @param {HTMLElement} el   - элемент для обновления
   * @param {number}      from - начальное значение
   * @param {number}      to   - конечное значение
   * @param {number}      ms   - длительность анимации в мс
   */
  function animateCounter(el, from, to, ms = 600) {
    if (from === to) return;

    const startTime = performance.now();
    const diff = to - from;

    function step(currentTime) {
      const elapsed  = currentTime - startTime;
      const progress = Math.min(elapsed / ms, 1);

      // Функция плавности: easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + diff * eased);

      el.textContent = formatStatNumber(current);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = formatStatNumber(to);
        // Добавляем CSS-класс для "прыжка" числа при обновлении
        el.closest('.stat-card__value')?.classList.add('updated');
        setTimeout(() => {
          el.closest('.stat-card__value')?.classList.remove('updated');
        }, 400);
      }
    }

    requestAnimationFrame(step);
  }

  /**
   * Подсчёт статистики из всех записей дневника.
   *
   * Алгоритм:
   * 1. Получаем все записи дневника из IndexedDB
   * 2. Уникальные даты → количество тренировок
   * 3. Сумма (вес * повторения) по всем подходам → суммарный вес
   * 4. Количество записей (строк дневника) → количество упражнений
   *
   * @returns {Promise<{workouts: number, totalWeight: number, exercises: number}>}
   */
  async function calculate() {
    const allEntries = await DB.getAllDiaryEntries();

    if (allEntries.length === 0) {
      return { workouts: 0, totalWeight: 0, exercises: 0 };
    }

    // 1. Уникальные даты = количество дней с тренировками
    const uniqueDates = new Set(allEntries.map(e => e.date));
    const workouts = uniqueDates.size;

    // 2. Суммарный вес: Σ (вес × повторения) по каждому подходу
    let totalWeight = 0;
    allEntries.forEach(entry => {
      if (Array.isArray(entry.sets)) {
        entry.sets.forEach(set => {
          const w = parseFloat(set.weight) || 0;
          const r = parseInt(set.reps)    || 0;
          totalWeight += w * r;
        });
      }
    });

    // 3. Количество упражнений = общее число записей в дневнике
    const exercises = allEntries.length;

    return { workouts, totalWeight, exercises };
  }

  /**
   * Предыдущие значения для анимации счётчика.
   * Хранятся между вызовами update().
   */
  const prevValues = {
    workouts:    0,
    totalWeight: 0,
    exercises:   0
  };

  /**
   * [ПУБЛИЧНЫЙ] Обновление блока статистики.
   * Вызывается после любого изменения данных дневника.
   *
   * Точки вызова в коде:
   * - EquipmentModule: после deleteEquipment (каскадное удаление)
   * - DiaryModule: после saveDiaryEntry и deleteDiaryEntry
   * - initApp: при первом запуске
   */
  async function update() {
    try {
      // Показываем скелетон при первой загрузке
      if (gridEl.hidden) {
        loadingEl.hidden = false;
        gridEl.hidden    = true;
      }

      const stats = await calculate();

      // Анимируем изменение каждого показателя
      animateCounter(workoutsValueEl,  prevValues.workouts,    stats.workouts,    700);
      animateCounter(weightValueEl,    prevValues.totalWeight, stats.totalWeight, 900);
      animateCounter(exercisesValueEl, prevValues.exercises,   stats.exercises,   700);

      // Сохраняем для следующей анимации
      prevValues.workouts    = stats.workouts;
      prevValues.totalWeight = stats.totalWeight;
      prevValues.exercises   = stats.exercises;

      // Скрываем скелетон, показываем данные
      loadingEl.hidden = true;
      gridEl.hidden    = false;

    } catch (err) {
      console.error('[Stats] Ошибка подсчёта статистики:', err);
      // При ошибке всё равно показываем блок с нулями
      loadingEl.hidden = true;
      gridEl.hidden    = false;
    }
  }

  return { update };
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

      const sectionId = targetTab === 'equipment' ? 'sectionEquipment' : 'sectionDiary';
      const target = document.getElementById(sectionId);
      target.hidden = false;
      target.classList.add('active');

      // При переключении на вкладку тренажеров — обновляем статистику
      // (на случай если данные изменились в дневнике)
      if (targetTab === 'equipment') {
        StatsModule.update();
      }
    });
  });
}

// ============================================================
// МОДУЛЬ: ТРЕНАЖЕРЫ
// ============================================================
const EquipmentModule = (() => {

  const modal            = document.getElementById('modalEquipment');
  const form             = document.getElementById('formEquipment');
  const modalTitle       = document.getElementById('modalEquipmentTitle');
  const inputId          = document.getElementById('equipmentId');
  const inputName        = document.getElementById('equipmentName');
  const inputDesc        = document.getElementById('equipmentDesc');
  const inputPhoto       = document.getElementById('equipmentPhoto');
  const photoPreview     = document.getElementById('photoPreview');
  const photoPlaceholder = document.getElementById('photoPlaceholder');
  const btnRemovePhoto   = document.getElementById('btnRemovePhoto');
  const listEl           = document.getElementById('equipmentList');
  const emptyEl          = document.getElementById('emptyEquipment');
  const errorName        = document.getElementById('errorEquipmentName');

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

    if (item.photo) showPhotoPreview(item.photo);
    else resetPhotoUI();

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

    const reader = new FileReader();
    reader.onload  = (e) => {
      AppState.photoBase64 = e.target.result;
      showPhotoPreview(e.target.result);
    };
    reader.onerror = () => showToast('Ошибка чтения файла', 'error');
    reader.readAsDataURL(file);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!validate()) return;

    const existing = AppState.editingEquipId
      ? await DB.getEquipmentById(AppState.editingEquipId)
      : null;

    const item = {
      id:          AppState.editingEquipId || generateId(),
      name:        inputName.value.trim(),
      description: inputDesc.value.trim(),
      photo:       AppState.photoBase64 || null,
      createdAt:   existing?.createdAt || new Date().toISOString()
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

          if (AppState.currentDate) {
            await DiaryModule.loadAndRender(AppState.currentDate);
          }

          // [MOD] Обновляем статистику после удаления тренажера
          // (каскадно удалились записи дневника → статистика изменилась)
          await StatsModule.update();

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
        <button class="btn btn-secondary btn-sm btn-edit" data-id="${item.id}">
          ✏️ Изменить
        </button>
        <button class="btn btn-danger btn-sm btn-delete" data-id="${item.id}">
          🗑 Удалить
        </button>
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

  // --- Управление подходами ---

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
        min="0" max="9999" step="0.5"
        aria-label="Вес подхода ${setsCount}"
      />
      <input
        type="number"
        class="set-reps"
        placeholder="Повторений"
        value="${reps}"
        min="1" max="9999" step="1"
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

  function renumberSets() {
    setsList.querySelectorAll('.set-row').forEach((row, idx) => {
      row.querySelector('.set-row__num').textContent = idx + 1;
    });
    setsCount = setsList.querySelectorAll('.set-row').length;
  }

  function getSetsData() {
    return Array.from(setsList.querySelectorAll('.set-row')).map(row => ({
      weight: parseFloat(row.querySelector('.set-weight').value) || 0,
      reps:   parseInt(row.querySelector('.set-reps').value)    || 0
    }));
  }

  // --- Модал ---

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
    addSetRow(); addSetRow(); addSetRow();
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
    const existing = AppState.editingDiaryId
      ? await DB.getDiaryEntryById(AppState.editingDiaryId)
      : null;

    const entry = {
      id:          AppState.editingDiaryId || generateId(),
      date:        date,
      equipmentId: selectEquip.value,
      sets:        getSetsData(),
      notes:       inputNotes.value.trim(),
      createdAt:   existing?.createdAt || new Date().toISOString()
    };

    try {
      await DB.saveDiaryEntry(entry);
      await loadAndRender(date);

      // [MOD] Обновляем статистику после сохранения записи дневника
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
    const name  = equip?.name || 'запись';

    ConfirmModal.show(
      `Удалить запись «${name}» из дневника?`,
      async () => {
        try {
          await DB.deleteDiaryEntry(id);
          await loadAndRender(AppState.currentDate);

          // [MOD] Обновляем статистику после удаления записи дневника
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
    entryList.innerHTML  = '';
    diaryHint.hidden     = true;
    dayHeader.hidden     = false;
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
      setsHtml = '<p style="color:var(--color-text-muted);font-size:.85rem">Подходы не указаны</p>';
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
        .catch(err => console.warn('[SW] Ошибка регистрации:', err));
    });
  }
}

// ============================================================
// ОТСЛЕЖИВАНИЕ СТАТУСА СЕТИ
// ============================================================
function initNetworkStatus() {
  const statusEl = document.getElementById('pwaStatus');

  function update() {
    const online = navigator.onLine;
    statusEl.textContent = online ? '🟢' : '🔴';
    statusEl.title       = online ? 'Онлайн' : 'Офлайн';
    if (!online) showToast('Нет подключения. Работаем офлайн.', 'info');
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
    registerServiceWorker();
    initNetworkStatus();

    // Загружаем дневник за сегодня
    const today = getTodayString();
    await DiaryModule.loadAndRender(today);

    // [NEW] Первичная загрузка статистики
    await StatsModule.update();

    console.log('[App] Gym Tracker запущен ✅');
  } catch (err) {
    console.error('[App] Ошибка инициализации:', err);
    showToast('Ошибка запуска приложения', 'error');
  }
}

document.addEventListener('DOMContentLoaded', initApp);
