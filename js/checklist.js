// === Checklist module (Fase 2) ===
// Multiple named checklists, team-based "done by" dropdown instead of a boolean checkbox.
// Time picker forced to 24 h via flatpickr (Spanish locale).

const MODULE = 'checklist';
const ACTIVE_KEY_PREFIX = 'checklist_active_'; // + storeCode

let _state = {
    checklists: [],     // [{ id, name, manualOrder, cycleDate, items, history }]
    persistent: { items: [] },  // right column: no time, no reset. [{ id, name, doneBy, createdAt }]
    staff: [],          // ["Ana", "Pedro", ...]
    activeId: null,
    editingTaskId: null,
    afterTaskId: null,  // when set on submit: new item is inserted right after this task
    renamingChecklistId: null,  // when set: rename flow; null = new-checklist flow
    editMode: false,
    draggedId: null,
};

function $(id) { return document.getElementById(id); }
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
}
function uuid(prefix) { return (prefix || 'c_') + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

// === Date helpers (for "days since last done" tracking) ===
function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function daysBetween(fromIso, toIso) {
    if (!fromIso || !toIso) return null;
    const a = new Date(fromIso + 'T00:00:00');
    const b = new Date(toIso + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
}

// Task ids are `c_<base36-timestamp>_<random>`. Recover the creation date so
// new tasks have a reference even before the first "done" mark.
function taskCreationDate(task) {
    const m = (task.id || '').match(/^[a-z]+_([0-9a-z]+)_/i);
    if (!m) return null;
    const ms = parseInt(m[1], 36);
    if (isNaN(ms)) return null;
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeDaysSince(task) {
    const ref = task.lastDoneDate || taskCreationDate(task);
    if (!ref) return null;
    const n = daysBetween(ref, todayISO());
    return n == null ? null : Math.max(0, n);
}

function isCritical(task) {
    const threshold = Number(task.criticalEveryDays);
    if (!threshold || threshold <= 0) return false;
    const days = computeDaysSince(task);
    return days != null && days >= threshold;
}

// Minutes past the task's scheduled HH:MM (negative = still upcoming).
function overdueMinutes(task) {
    const t = (task && task.time) || '';
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1]), mm = parseInt(m[2]);
    const now = new Date();
    const scheduled = new Date();
    scheduled.setHours(h, mm, 0, 0);
    return (now - scheduled) / 60000;
}

// Only pending tasks get overdue tinting. Critical (by day-threshold) keeps
// its own red styling so we don't stack two reds — skip the tint when critical.
function overdueClass(task) {
    if (task.doneBy || task.skipped) return '';
    if (isCritical(task)) return '';
    const min = overdueMinutes(task);
    if (min == null || min < 0) return '';
    if (min >= 60) return 'overdue-red';
    if (min >= 30) return 'overdue-orange';
    return 'overdue-yellow';
}

// === 14-day history + manual "Iniciar nuevo día" ===
const HISTORY_DAYS = 14;

function isoDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "jueves, 23 de abril" — used for the label under the "Iniciar nuevo día" button
// and inside confirm dialogs.
function formatSpanishDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(n => parseInt(n));
    const dt = new Date(y, m - 1, d);
    if (isNaN(dt)) return iso;
    return dt.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Drop entries older than HISTORY_DAYS (kept inclusive: today + 13 days back).
function pruneHistory(checklist) {
    if (!Array.isArray(checklist.history)) { checklist.history = []; return; }
    const cutoff = isoDaysAgo(HISTORY_DAYS - 1);
    checklist.history = checklist.history.filter(h => h.date >= cutoff);
}

// At least one daily checklist has a cycleDate older than today (or missing).
// Drives the enabled state of the "Iniciar nuevo día" button.
function needsNewDay() {
    const today = todayISO();
    return _state.checklists.some(cl => !cl.cycleDate || cl.cycleDate !== today);
}

// Only allow http(s). Prepend https:// if user typed a bare domain.
// Blocks javascript:, mailto:, and anything else that could be abused.
function sanitizeUrl(raw) {
    const s = (raw || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[a-z][\w+.-]*:/i.test(s)) return '';  // unknown scheme → reject
    return 'https://' + s;
}

function activeKey() { return ACTIVE_KEY_PREFIX + (getStoreCode() || ''); }

// In-place sort by HH:MM ascending. Same-time items keep their existing
// relative order (Array.prototype.sort is stable as of ES2019).
function sortItemsByTime(items) {
    items.sort((a, b) => {
        if (a.time === b.time) return 0;
        return (a.time || '') < (b.time || '') ? -1 : 1;
    });
}

// Insert a task at its time-sorted position. Used on add (convenience).
function insertByTime(items, newItem) {
    let idx = 0;
    while (idx < items.length && (items[idx].time || '') <= (newItem.time || '')) idx++;
    items.splice(idx, 0, newItem);
}

// === Firestore ===
async function load() {
    const data = await loadModuleData(MODULE);
    // Migration: Phase 1 stored { items: [...] } at top level. Wrap into one checklist.
    if (data && Array.isArray(data.items) && !Array.isArray(data.checklists)) {
        _state.checklists = [{
            id: uuid('ck_'),
            name: 'Apertura',
            items: data.items.map(it => ({
                id: it.id || uuid(),
                time: it.time || '',
                name: it.name || '',
                doneBy: '',  // reset: Phase 1 had no staff list to attribute to
            })),
        }];
        _state.staff = [];
    } else {
        _state.checklists = (data && Array.isArray(data.checklists)) ? data.checklists : [];
        _state.staff = (data && Array.isArray(data.staff)) ? data.staff : [];
    }
    // Persistent (right column) list — separate from the daily checklists
    _state.persistent = (data && data.persistent && Array.isArray(data.persistent.items))
        ? data.persistent
        : { items: [] };
    // Normalise: until the user explicitly reorders, array order should follow time.
    // This also migrates older data (which used render-time sort) to an array-is-truth model.
    for (const cl of _state.checklists) {
        if (!cl.items) cl.items = [];
        if (!cl.manualOrder) sortItemsByTime(cl.items);
    }
    // Restore active checklist preference
    const storedActive = localStorage.getItem(activeKey());
    if (storedActive && _state.checklists.find(c => c.id === storedActive)) {
        _state.activeId = storedActive;
    } else {
        _state.activeId = _state.checklists[0]?.id || null;
    }
}

// Full write without merge — mirrors the adjustments module fix so that
// deleting a staff name, task, or checklist actually removes it on the server
// (Firestore's merge: true keeps removed keys inside maps).
async function persist() {
    const ref = storeDocRef(MODULE);
    if (!ref) return;
    // Keep the history array bounded to the last 14 days per checklist
    for (const cl of _state.checklists) pruneHistory(cl);
    await ref.set({
        checklists: _state.checklists,
        persistent: _state.persistent,
        staff: _state.staff,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
}

function setActive(id) {
    _state.activeId = id;
    if (id) localStorage.setItem(activeKey(), id);
}

function getActiveChecklist() {
    return _state.checklists.find(c => c.id === _state.activeId) || null;
}

// === Rendering ===
function renderAll() {
    renderSwitcher();
    renderTasks();
    renderStartDayControl();
    renderPersistent();
}

function renderStartDayControl() {
    const btn = $('btnStartDay');
    if (!btn) return;
    btn.textContent = 'Iniciar ' + formatSpanishDate(todayISO());
    const hasLists = _state.checklists.length > 0;
    btn.disabled = !hasLists || !needsNewDay();
}

// === Persistent list (right column) ===
const PERS_PRIORITY_MIN = 1;
const PERS_PRIORITY_MAX = 100;
const PERS_DEFAULT_PRIORITY = 50;

function clampPriority(n) {
    const v = parseInt(n);
    if (isNaN(v)) return PERS_PRIORITY_MIN;
    return Math.max(PERS_PRIORITY_MIN, Math.min(PERS_PRIORITY_MAX, v));
}

// "001", "042", "100" — 3-digit zero-padded display
function padPriority(n) { return String(clampPriority(n)).padStart(3, '0'); }

// Red gradient: pale at priority 1, strong red at priority 100.
// Hue stays at red; we interpolate saturation and lightness so the
// transition reads naturally (neutral → pink → red).
function priorityColor(n) {
    const p = clampPriority(n);
    const pct = (p - PERS_PRIORITY_MIN) / (PERS_PRIORITY_MAX - PERS_PRIORITY_MIN);  // 0..1
    const sat = Math.round(15 + pct * 70);        // 15% → 85%
    const light = Math.round(95 - pct * 40);      // 95% → 55%
    const bg = `hsl(0, ${sat}%, ${light}%)`;
    const textColor = pct >= 0.55 ? '#ffffff' : '#7f1d1d';
    return { bg, textColor };
}

function renderPersistent() {
    const list = $('clPersList');
    if (!list) return;
    const items = (_state.persistent && _state.persistent.items) || [];
    const countEl = $('clPersCount');
    if (countEl) {
        const done = items.filter(it => it.doneBy).length;
        countEl.textContent = `${done} / ${items.length}`;
        countEl.classList.toggle('complete', items.length > 0 && done === items.length);
    }
    if (items.length === 0) {
        list.innerHTML = '<div class="cl-pers-empty">Sin tareas pendientes. Añade una arriba y quedará guardada hasta que la completes.</div>';
        return;
    }
    // Sort: pending on top; within each group, higher priority first.
    // Array.prototype.sort is stable, so ties preserve insertion order.
    const sorted = items.slice().sort((a, b) => {
        const ad = a.doneBy ? 1 : 0;
        const bd = b.doneBy ? 1 : 0;
        if (ad !== bd) return ad - bd;
        return clampPriority(b.priority) - clampPriority(a.priority);
    });
    const noStaff = _state.staff.length === 0;
    list.innerHTML = sorted.map(it => {
        const isDone = !!it.doneBy;
        const priority = clampPriority(it.priority);
        const staffOptions = _state.staff.map(s =>
            `<option value="${escapeHtml(s)}" ${it.doneBy === s ? 'selected' : ''}>${escapeHtml(s)}</option>`
        ).join('');
        const lostStaffOption = isDone && !_state.staff.includes(it.doneBy)
            ? `<option value="${escapeHtml(it.doneBy)}" selected>${escapeHtml(it.doneBy)} (ya no está)</option>`
            : '';
        return `
        <div class="cl-pers-task ${isDone ? 'done' : ''}" data-id="${it.id}">
            <span class="cl-pers-name">${escapeHtml(it.name)}</span>
            <div class="cl-pers-controls">
                <select class="cl-pers-doneby ${isDone ? 'assigned' : ''}" data-id="${it.id}" ${noStaff ? 'disabled title="Configura el equipo primero"' : ''}>
                    <option value="" ${!isDone ? 'selected' : ''}>${noStaff ? '— añade equipo —' : '— Sin hacer —'}</option>
                    ${lostStaffOption}
                    ${staffOptions}
                </select>
                <label class="cl-pers-priority-row">
                    <span class="cl-pers-priority-label">Prioridad</span>
                    <select class="cl-pers-priority" data-id="${it.id}" style="background:${priorityColor(priority).bg};color:${priorityColor(priority).textColor}">
                        ${(() => {
                            // Highest priority at the top of the rollup, lowest at the bottom
                            const opts = [];
                            for (let i = PERS_PRIORITY_MAX; i >= PERS_PRIORITY_MIN; i--) {
                                const c = priorityColor(i);
                                opts.push(`<option value="${i}" style="background:${c.bg};color:${c.textColor}" ${i === priority ? 'selected' : ''}>${padPriority(i)}</option>`);
                            }
                            return opts.join('');
                        })()}
                    </select>
                </label>
            </div>
            <button class="cl-pers-delete" data-id="${it.id}" title="Eliminar" aria-label="Eliminar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>`;
    }).join('');
}

async function addPersistentTask(name) {
    const clean = (name || '').trim();
    if (!clean) return;
    if (!_state.persistent) _state.persistent = { items: [] };
    _state.persistent.items.push({
        id: uuid('p_'),
        name: clean,
        doneBy: '',
        priority: PERS_DEFAULT_PRIORITY,
        createdAt: Date.now(),
    });
    renderPersistent();
    await persist();
}

async function setPersistentDoneBy(id, doneBy) {
    const it = _state.persistent && _state.persistent.items.find(x => x.id === id);
    if (!it) return;
    it.doneBy = doneBy || '';
    renderPersistent();
    await persist();
}

async function setPersistentPriority(id, value) {
    const it = _state.persistent && _state.persistent.items.find(x => x.id === id);
    if (!it) return;
    it.priority = clampPriority(value);
    renderPersistent();
    await persist();
}

async function deletePersistentTask(id) {
    const it = _state.persistent && _state.persistent.items.find(x => x.id === id);
    if (!it) return;
    if (!confirm(`¿Eliminar la tarea "${it.name}"?`)) return;
    _state.persistent.items = _state.persistent.items.filter(x => x.id !== id);
    renderPersistent();
    await persist();
}

function renderSwitcher() {
    const sel = $('clSwitcher');
    const hasChecklists = _state.checklists.length > 0;
    if (!hasChecklists) {
        sel.innerHTML = '<option value="">— sin checklists —</option>';
        sel.disabled = true;
        $('btnRenameChecklist').disabled = true;
        $('btnDeleteChecklist').disabled = true;
        return;
    }
    sel.disabled = false;
    $('btnRenameChecklist').disabled = false;
    $('btnDeleteChecklist').disabled = false;
    sel.innerHTML = _state.checklists.map(c =>
        `<option value="${c.id}" ${c.id === _state.activeId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');
}

function renderTasks() {
    const list = $('clList');
    const empty = $('clEmpty');
    const emptyFull = $('clEmptyFull');
    const progressEl = $('clProgress');

    const active = getActiveChecklist();

    if (_state.checklists.length === 0) {
        list.innerHTML = '';
        empty.hidden = true;
        emptyFull.hidden = false;
        progressEl.textContent = '0 / 0';
        progressEl.classList.remove('complete');
        return;
    }
    emptyFull.hidden = true;

    if (!active || active.items.length === 0) {
        list.innerHTML = '';
        empty.hidden = false;
        progressEl.textContent = '0 / 0';
        progressEl.classList.remove('complete');
        return;
    }
    empty.hidden = true;

    // In edit mode, the display follows the raw array order so drag-and-drop
    // can work directly on indices. In use mode, group pending on top and
    // processed (done or skipped) at the bottom, preserving the underlying
    // configured order within each group (Array.prototype.sort is stable).
    const items = _state.editMode
        ? active.items
        : active.items.slice().sort((a, b) => {
            const ap = (a.doneBy || a.skipped) ? 1 : 0;
            const bp = (b.doneBy || b.skipped) ? 1 : 0;
            return ap - bp;
        });
    const total = items.length;
    const processed = items.filter(it => it.doneBy || it.skipped).length;
    progressEl.textContent = `${processed} / ${total}`;
    progressEl.classList.toggle('complete', total > 0 && processed === total);

    const staffOptions = _state.staff.map(s =>
        `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`
    ).join('');
    const noStaff = _state.staff.length === 0;

    list.classList.toggle('edit-mode', _state.editMode);

    list.innerHTML = items.map((it, i) => {
        const isDone = !!it.doneBy;
        const isSkipped = !!it.skipped && !isDone;
        // Subtle separator when transitioning from pending to processed (use mode only)
        const prev = i > 0 ? items[i - 1] : null;
        const prevProcessed = prev ? !!(prev.doneBy || prev.skipped) : false;
        const thisProcessed = isDone || isSkipped;
        const separator = (!_state.editMode && thisProcessed && !prevProcessed)
            ? '<div class="cl-separator" aria-hidden="true"></div>'
            : '';
        const critical = isCritical(it);
        const rowState = [
            isDone ? 'done' : (isSkipped ? 'skipped' : ''),
            critical ? 'critical' : '',
            overdueClass(it),
        ].filter(Boolean).join(' ');
        const selValue = isDone ? it.doneBy : (isSkipped ? '__skip__' : '');
        const selectClass = isDone ? 'assigned' : (isSkipped ? 'skipped' : '');
        // Age chip: show when days-since is > 0 (hide "hace 0 días")
        const daysSince = computeDaysSince(it);
        const ageHtml = (daysSince != null && daysSince > 0) ? `
            <span class="cl-age ${critical ? 'cl-age-critical' : ''}" title="Hace ${daysSince} día${daysSince === 1 ? '' : 's'} desde la última vez marcada como hecha${it.criticalEveryDays ? ' · crítica a los ' + it.criticalEveryDays + ' días' : ''}">
                ${critical ? '⚠ ' : ''}hace ${daysSince} ${daysSince === 1 ? 'día' : 'días'}
            </span>` : '';
        const selectedStaffExists = isDone && _state.staff.includes(it.doneBy);
        const lostStaffOption = isDone && !selectedStaffExists
            ? `<option value="${escapeHtml(it.doneBy)}" selected>${escapeHtml(it.doneBy)} (ya no está)</option>`
            : '';
        const draggable = _state.editMode ? 'draggable="true"' : '';
        const url = sanitizeUrl(it.url);
        const linkLabel = (it.urlLabel || '').trim() || (url ? new URL(url).hostname.replace(/^www\./, '') : '');
        const hasName = !!(it.name && it.name.trim());
        const linkHtml = url ? `
            <a class="cl-link ${hasName ? '' : 'cl-link-standalone'}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(url)}" onclick="event.stopPropagation()">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                ${escapeHtml(linkLabel)}
            </a>` : '';
        // Edit/add-after/delete are only rendered in edit mode (defence in depth on top of the CSS hide)
        const actionsHtml = _state.editMode ? `
            <div class="cl-actions">
                <button class="cl-action-btn cl-add-after" data-id="${it.id}" title="Añadir tarea siguiente" aria-label="Añadir tarea siguiente">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                </button>
                <button class="cl-action-btn cl-edit" data-id="${it.id}" title="Editar" aria-label="Editar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                    </svg>
                </button>
                <button class="cl-action-btn cl-delete" data-id="${it.id}" title="Eliminar" aria-label="Eliminar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>` : '';
        return `
        ${separator}
        <div class="cl-task ${rowState}" data-id="${it.id}" data-critical="${critical ? '1' : '0'}" ${draggable}>
            <span class="cl-drag-handle" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="15" cy="18" r="1.3"/></svg>
            </span>
            <span class="cl-time">${escapeHtml(it.time)}</span>
            <div class="cl-name-wrap">
                ${hasName ? `<span class="cl-name">${escapeHtml(it.name)}</span>` : ''}
                ${linkHtml}
                ${ageHtml}
            </div>
            <select class="cl-doneby ${selectClass}" data-id="${it.id}" ${noStaff ? 'disabled title="Configura el equipo primero"' : ''}>
                <option value="" ${selValue === '' ? 'selected' : ''}>${noStaff ? '— añade equipo —' : '— Sin hacer —'}</option>
                <option value="__skip__" ${selValue === '__skip__' ? 'selected' : ''}>⏭ Saltar</option>
                ${lostStaffOption}
                ${_state.staff.map(s =>
                    `<option value="${escapeHtml(s)}" ${selValue === s ? 'selected' : ''}>${escapeHtml(s)}</option>`
                ).join('')}
            </select>
            ${actionsHtml}
        </div>`;
    }).join('');

    if (_state.editMode) bindDragHandlers();
}

// === Task modal (add / edit) ===
const TIME_PICKER_CFG = {
    locale: 'es',
    enableTime: true,
    noCalendar: true,
    dateFormat: 'H:i',
    time_24hr: true,
    allowInput: true,
    disableMobile: true,
};

function initTimePicker() {
    if (typeof flatpickr === 'undefined') return;
    const input = $('clForm').time;
    if (input._flatpickr) input._flatpickr.destroy();
    flatpickr(input, TIME_PICKER_CFG);
}

function openTaskModal(existing, opts) {
    opts = opts || {};
    const form = $('clForm');
    form.reset();
    _state.editingTaskId = existing ? existing.id : null;
    _state.afterTaskId = opts.afterId || null;
    $('clModalTitle').textContent = existing
        ? 'Editar tarea'
        : (_state.afterTaskId ? 'Añadir tarea siguiente' : 'Nueva tarea');
    initTimePicker();
    if (existing) {
        if (form.time._flatpickr) form.time._flatpickr.setDate(existing.time || '', false, 'H:i');
        else form.time.value = existing.time || '';
        form.name.value = existing.name || '';
        form.urlLabel.value = existing.urlLabel || '';
        form.url.value = existing.url || '';
        form.criticalEveryDays.value = existing.criticalEveryDays || '';
    } else if (opts.prefillTime) {
        if (form.time._flatpickr) form.time._flatpickr.setDate(opts.prefillTime, false, 'H:i');
        else form.time.value = opts.prefillTime;
    }
    $('clModalOverlay').classList.add('open');
    // When time is pre-filled (editing or add-after), jump the user straight
    // to the name field; otherwise start on the time picker.
    const focusOn = (existing || opts.prefillTime) ? form.name : form.time;
    setTimeout(() => focusOn.focus(), 60);
}

function closeTaskModal() {
    $('clModalOverlay').classList.remove('open');
    _state.editingTaskId = null;
    _state.afterTaskId = null;
}

async function handleTaskSubmit(e) {
    e.preventDefault();
    const active = getActiveChecklist();
    if (!active) return;
    const form = $('clForm');
    const time = (form.time.value || '').trim();
    const name = (form.name.value || '').trim();
    const url = sanitizeUrl(form.url.value);
    const urlLabel = (form.urlLabel.value || '').trim();
    const criticalRaw = parseInt(form.criticalEveryDays.value);
    const criticalEveryDays = (!isNaN(criticalRaw) && criticalRaw > 0) ? criticalRaw : null;
    if (!time) return;
    if (!name && !url) {
        alert('Añade un nombre para la tarea o un enlace que haga de nombre.');
        return;
    }
    if (_state.editingTaskId) {
        const it = active.items.find(x => x.id === _state.editingTaskId);
        if (it) {
            it.time = time; it.name = name; it.url = url; it.urlLabel = urlLabel;
            it.criticalEveryDays = criticalEveryDays;
        }
    } else {
        const newItem = { id: uuid(), time, name, doneBy: '', url, urlLabel, criticalEveryDays };
        if (_state.afterTaskId) {
            // "Añadir tarea siguiente": drop the new item directly after its
            // parent. This is an explicit placement, so flip manualOrder on.
            const idx = active.items.findIndex(x => x.id === _state.afterTaskId);
            if (idx >= 0) {
                active.items.splice(idx + 1, 0, newItem);
                active.manualOrder = true;
            } else {
                active.items.push(newItem);
            }
        } else if (active.manualOrder) {
            // User has reordered before — append so we don't disturb their layout.
            active.items.push(newItem);
        } else {
            // Fresh list: insert at the correct time-sorted position.
            insertByTime(active.items, newItem);
        }
    }
    closeTaskModal();
    renderTasks();
    await persist();
}

// === Checklist name modal (new / rename) ===
function openNameModal(renamingChecklist) {
    _state.renamingChecklistId = renamingChecklist ? renamingChecklist.id : null;
    $('clNameTitle').textContent = renamingChecklist ? 'Renombrar checklist' : 'Nueva checklist';
    $('clNameInput').value = renamingChecklist ? renamingChecklist.name : '';
    $('clNameOverlay').classList.add('open');
    setTimeout(() => $('clNameInput').focus(), 60);
}

function closeNameModal() {
    $('clNameOverlay').classList.remove('open');
    _state.renamingChecklistId = null;
}

async function handleNameSubmit(e) {
    e.preventDefault();
    const name = ($('clNameInput').value || '').trim();
    if (!name) return;
    if (_state.renamingChecklistId) {
        const cl = _state.checklists.find(c => c.id === _state.renamingChecklistId);
        if (cl) cl.name = name;
    } else {
        const cl = { id: uuid('ck_'), name, items: [], cycleDate: todayISO() };
        _state.checklists.push(cl);
        setActive(cl.id);
    }
    closeNameModal();
    renderAll();
    await persist();
}

// === Team modal ===
function openTeamModal() {
    renderTeamList();
    $('clTeamNewName').value = '';
    $('clTeamOverlay').classList.add('open');
    setTimeout(() => $('clTeamNewName').focus(), 60);
}

function closeTeamModal() { $('clTeamOverlay').classList.remove('open'); }

function renderTeamList() {
    const ul = $('clTeamList');
    if (_state.staff.length === 0) {
        ul.innerHTML = '<li class="cl-team-empty">Aún no hay miembros. Añade el primero arriba.</li>';
        return;
    }
    ul.innerHTML = _state.staff.map(name => `
        <li class="cl-team-item">
            <span class="cl-team-name">${escapeHtml(name)}</span>
            <button class="cl-team-remove" data-name="${escapeHtml(name)}" title="Quitar" aria-label="Quitar ${escapeHtml(name)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </li>
    `).join('');
}

async function addTeamMember(name) {
    const clean = name.trim();
    if (!clean) return;
    if (_state.staff.includes(clean)) return;
    _state.staff.push(clean);
    renderTeamList();
    renderTasks();
    await persist();
}

async function removeTeamMember(name) {
    if (!confirm(`¿Quitar a "${name}" del equipo?`)) return;
    _state.staff = _state.staff.filter(s => s !== name);
    renderTeamList();
    renderTasks();
    await persist();
}

// === Task actions ===
async function setTaskState(taskId, rawValue) {
    const active = getActiveChecklist();
    if (!active) return;
    const it = active.items.find(x => x.id === taskId);
    if (!it) return;
    if (rawValue === '__skip__') {
        it.skipped = true;
        it.doneBy = '';
    } else {
        it.skipped = false;
        it.doneBy = rawValue || '';
        // Last "done" date feeds the age chip + critical threshold.
        // Reverting to "sin hacer" doesn't clear it (we keep the reference).
        if (it.doneBy) it.lastDoneDate = todayISO();
    }
    // History is written only when the user presses "Iniciar nuevo día"
    // (see startNewDay). Marks stay ephemeral within the current cycle.
    renderTasks();
    await persist();
}

function updateProgress() {
    const active = getActiveChecklist();
    const progressEl = $('clProgress');
    if (!active || active.items.length === 0) {
        progressEl.textContent = '0 / 0';
        progressEl.classList.remove('complete');
        return;
    }
    const total = active.items.length;
    // Both done and skipped count as "processed" — the user's mental model is
    // "how many tasks still need attention"
    const processed = active.items.filter(x => x.doneBy || x.skipped).length;
    progressEl.textContent = `${processed} / ${total}`;
    progressEl.classList.toggle('complete', total > 0 && processed === total);
}

async function deleteTask(taskId) {
    const active = getActiveChecklist();
    if (!active) return;
    const it = active.items.find(x => x.id === taskId);
    if (!it) return;
    if (!confirm(`¿Eliminar la tarea "${it.name}"?`)) return;
    active.items = active.items.filter(x => x.id !== taskId);
    renderTasks();
    await persist();
}

async function sortActiveByTime() {
    const active = getActiveChecklist();
    if (!active || active.items.length < 2) return;
    sortItemsByTime(active.items);
    // Reset the manual-order flag: future adds will insert by time again
    active.manualOrder = false;
    renderTasks();
    await persist();
}

// Manually start today's cycle across all daily checklists. Archives the
// previous cycleDate's items into history (including unmarked tasks, which
// are logged as "sin marcar"), then clears the marks.
async function startNewDay() {
    if (_state.checklists.length === 0) return;
    const today = todayISO();
    const pending = _state.checklists.filter(cl => !cl.cycleDate || cl.cycleDate !== today);
    if (pending.length === 0) return;

    // Oldest cycleDate across the pending checklists — used in the confirm text.
    const dates = pending.map(cl => cl.cycleDate).filter(Boolean).sort();
    const oldest = dates[0];
    const msg = oldest
        ? `Se archivará el contenido actual como ${formatSpanishDate(oldest)}${dates.length > 1 ? ' (o anterior)' : ''} y se iniciará el día ${formatSpanishDate(today)}.\n\n¿Continuar?`
        : `Se iniciará el día ${formatSpanishDate(today)} en las checklists. ¿Continuar?`;
    if (!confirm(msg)) return;

    for (const cl of _state.checklists) {
        if (!cl.cycleDate) { cl.cycleDate = today; continue; }
        if (cl.cycleDate === today) continue;

        if (!Array.isArray(cl.history)) cl.history = [];
        const cycleDate = cl.cycleDate;
        // Archive every task, including those without a mark — so the history
        // reflects what actually happened (and didn't).
        for (const it of (cl.items || [])) {
            cl.history.push({
                date: cycleDate,
                taskId: it.id,
                doneBy: it.doneBy || '',
                skipped: !!it.skipped,
            });
        }
        for (const it of (cl.items || [])) {
            it.doneBy = '';
            it.skipped = false;
        }
        cl.cycleDate = today;
    }
    renderAll();
    await persist();
}

// === History modal ===
function formatHistoryDate(iso) {
    const [y, m, d] = iso.split('-').map(n => parseInt(n));
    const dt = new Date(y, m - 1, d);
    const dateStr = `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
    const today = todayISO();
    if (iso === today) return { label: 'Hoy', sub: dateStr, isToday: true };
    if (iso === isoDaysAgo(1)) return { label: 'Ayer', sub: dateStr, isToday: false };
    const weekday = dt.toLocaleDateString('es-ES', { weekday: 'long' });
    return { label: weekday.charAt(0).toUpperCase() + weekday.slice(1), sub: dateStr, isToday: false };
}

let _historyFilter = 'all';  // 'all' | taskId (UI-only, not persisted)

function openHistoryModal() {
    _historyFilter = 'all';
    renderHistoryModal();
    $('clHistoryOverlay').classList.add('open');
}
function closeHistoryModal() { $('clHistoryOverlay').classList.remove('open'); }

function renderHistoryModal() {
    const active = getActiveChecklist();
    const body = $('clHistoryBody');
    const titleEl = $('clHistoryTitle');
    if (!active) {
        body.innerHTML = '<div class="cl-hist-empty">No hay checklist activa.</div>';
        return;
    }
    titleEl.textContent = `Histórico — ${active.name} · últimos ${HISTORY_DAYS} días`;

    const history = Array.isArray(active.history) ? active.history : [];
    const taskById = new Map(active.items.map(t => [t.id, t]));

    // Build the filter select options (current tasks + deleted tasks that still
    // appear in the history so the user can look them up even after removal).
    const currentOpts = active.items.slice()
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
        .map(t => {
            const label = `${t.time || '--:--'} · ${t.name || t.urlLabel || '(sin nombre)'}`;
            return `<option value="${escapeHtml(t.id)}" ${_historyFilter === t.id ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        }).join('');
    const deletedIds = Array.from(new Set(history.map(h => h.taskId))).filter(id => !taskById.has(id));
    const deletedOpts = deletedIds.map(id =>
        `<option value="${escapeHtml(id)}" ${_historyFilter === id ? 'selected' : ''}>(eliminada · ${escapeHtml(id)})</option>`
    ).join('');

    const filterHtml = `
        <div class="cl-hist-filter">
            <label for="clHistFilter">Filtrar:</label>
            <select id="clHistFilter">
                <option value="all" ${_historyFilter === 'all' ? 'selected' : ''}>Todas las tareas</option>
                ${currentOpts ? `<optgroup label="Tareas actuales">${currentOpts}</optgroup>` : ''}
                ${deletedOpts ? `<optgroup label="Tareas eliminadas">${deletedOpts}</optgroup>` : ''}
            </select>
        </div>`;

    if (history.length === 0) {
        body.innerHTML = filterHtml + '<div class="cl-hist-empty">Sin entradas todavía. Marca tareas y aquí se irán acumulando.</div>';
        bindHistoryFilter();
        return;
    }

    // Apply the task filter
    const filtered = _historyFilter === 'all'
        ? history
        : history.filter(h => h.taskId === _historyFilter);

    if (filtered.length === 0) {
        body.innerHTML = filterHtml + '<div class="cl-hist-empty">Esta tarea no tiene entradas en los últimos 14 días.</div>';
        bindHistoryFilter();
        return;
    }

    // Group entries by date (desc)
    const byDate = new Map();
    for (const h of filtered) {
        if (!byDate.has(h.date)) byDate.set(h.date, []);
        byDate.get(h.date).push(h);
    }
    const dates = Array.from(byDate.keys()).sort().reverse();

    const daysHtml = dates.map(date => {
        const entries = byDate.get(date);
        entries.sort((a, b) => {
            const ta = taskById.get(a.taskId);
            const tb = taskById.get(b.taskId);
            if (!ta && tb) return 1;
            if (ta && !tb) return -1;
            if (!ta && !tb) return 0;
            return (ta.time || '').localeCompare(tb.time || '');
        });
        const { label, sub, isToday } = formatHistoryDate(date);
        const rowsHtml = entries.map(h => {
            const t = taskById.get(h.taskId);
            const timeStr = t ? t.time : '';
            const nameClass = t ? '' : 'removed';
            const nameText = t ? (t.name || (t.urlLabel || '— sin nombre —')) : '(tarea eliminada)';
            let who, rowState;
            if (h.skipped) {
                who = `<span class="cl-hist-who skipped">⏭ Saltada</span>`;
                rowState = 'skipped';
            } else if (h.doneBy) {
                who = `<span class="cl-hist-who done">${escapeHtml(h.doneBy)}</span>`;
                rowState = '';
            } else {
                who = `<span class="cl-hist-who unmarked">○ Sin marcar</span>`;
                rowState = 'unmarked';
            }
            return `
                <div class="cl-hist-row ${rowState}">
                    <span class="cl-hist-time">${escapeHtml(timeStr)}</span>
                    <span class="cl-hist-name ${nameClass}">${escapeHtml(nameText)}</span>
                    ${who}
                </div>`;
        }).join('');
        return `
            <div class="cl-hist-day">
                <div class="cl-hist-day-header">
                    <span class="cl-hist-day-label ${isToday ? 'today' : ''}">${escapeHtml(label)}</span>
                    <span class="cl-hist-day-count">${sub} · ${entries.length} entrada${entries.length === 1 ? '' : 's'}</span>
                </div>
                <div class="cl-hist-rows">${rowsHtml}</div>
            </div>`;
    }).join('');

    body.innerHTML = filterHtml + daysHtml;
    bindHistoryFilter();
}

function bindHistoryFilter() {
    const sel = $('clHistFilter');
    if (!sel) return;
    sel.addEventListener('change', (e) => {
        _historyFilter = e.target.value;
        renderHistoryModal();
    });
}

// === Edit mode (CRUD + reorder bundled) ===
function toggleEditMode() {
    _state.editMode = !_state.editMode;
    document.body.classList.toggle('cl-edit-mode', _state.editMode);
    $('btnEditMode').querySelector('.cl-edit-label').textContent = _state.editMode ? 'Listo' : 'Editar';
    renderTasks();
}

function bindDragHandlers() {
    document.querySelectorAll('.cl-task').forEach(row => {
        row.addEventListener('dragstart', onDragStart);
        row.addEventListener('dragover', onDragOver);
        row.addEventListener('dragleave', onDragLeave);
        row.addEventListener('drop', onDrop);
        row.addEventListener('dragend', onDragEnd);
    });
}

function onDragStart(e) {
    _state.draggedId = e.currentTarget.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    // Firefox requires some data to be set for drag to work
    try { e.dataTransfer.setData('text/plain', _state.draggedId); } catch (err) { /* ignore */ }
    e.currentTarget.classList.add('dragging');
}

function onDragOver(e) {
    e.preventDefault();
    if (!_state.draggedId) return;
    e.dataTransfer.dropEffect = 'move';
    const target = e.currentTarget;
    if (target.dataset.id === _state.draggedId) return;
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const above = e.clientY < midY;
    target.classList.toggle('drop-above', above);
    target.classList.toggle('drop-below', !above);
}

function onDragLeave(e) {
    e.currentTarget.classList.remove('drop-above', 'drop-below');
}

async function onDrop(e) {
    e.preventDefault();
    const target = e.currentTarget;
    target.classList.remove('drop-above', 'drop-below');
    const targetId = target.dataset.id;
    const draggedId = _state.draggedId;
    if (!draggedId || draggedId === targetId) return;

    const active = getActiveChecklist();
    if (!active) return;
    const items = active.items;
    const fromIdx = items.findIndex(x => x.id === draggedId);
    if (fromIdx < 0) return;

    // Splice first, then compute the target index in the reduced array
    const [moved] = items.splice(fromIdx, 1);
    let toIdx = items.findIndex(x => x.id === targetId);
    if (toIdx < 0) { items.splice(fromIdx, 0, moved); return; }  // revert

    const rect = target.getBoundingClientRect();
    const dropBelow = e.clientY >= rect.top + rect.height / 2;
    if (dropBelow) toIdx++;
    items.splice(toIdx, 0, moved);

    active.manualOrder = true;  // from now on, this checklist keeps user-defined order
    renderTasks();
    await persist();
}

function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.cl-task.drop-above, .cl-task.drop-below')
        .forEach(el => el.classList.remove('drop-above', 'drop-below'));
    _state.draggedId = null;
}

async function deleteActiveChecklist() {
    const active = getActiveChecklist();
    if (!active) return;
    if (!confirm(`¿Eliminar la checklist "${active.name}" y todas sus tareas? No se puede deshacer.`)) return;
    _state.checklists = _state.checklists.filter(c => c.id !== active.id);
    setActive(_state.checklists[0]?.id || null);
    renderAll();
    await persist();
}

// === Wiring ===
function bindUI() {
    // Add / edit task
    $('btnAddTask').addEventListener('click', () => {
        if (!getActiveChecklist()) {
            alert('Crea o selecciona una checklist primero.');
            return;
        }
        openTaskModal();
    });
    $('clModalClose').addEventListener('click', closeTaskModal);
    $('clCancel').addEventListener('click', closeTaskModal);
    $('clForm').addEventListener('submit', handleTaskSubmit);
    $('clModalOverlay').addEventListener('click', (e) => {
        if (e.target === $('clModalOverlay')) closeTaskModal();
    });

    // Switcher
    $('clSwitcher').addEventListener('change', (e) => {
        setActive(e.target.value);
        renderTasks();
    });

    // Checklist management
    $('btnNewChecklist').addEventListener('click', () => openNameModal(null));
    $('btnRenameChecklist').addEventListener('click', () => {
        const active = getActiveChecklist();
        if (active) openNameModal(active);
    });
    $('btnDeleteChecklist').addEventListener('click', deleteActiveChecklist);
    $('btnCreateFirst').addEventListener('click', () => openNameModal(null));

    $('clNameClose').addEventListener('click', closeNameModal);
    $('clNameCancel').addEventListener('click', closeNameModal);
    $('clNameForm').addEventListener('submit', handleNameSubmit);
    $('clNameOverlay').addEventListener('click', (e) => {
        if (e.target === $('clNameOverlay')) closeNameModal();
    });

    // Team
    $('btnTeam').addEventListener('click', openTeamModal);
    $('clTeamClose').addEventListener('click', closeTeamModal);
    $('clTeamDone').addEventListener('click', closeTeamModal);
    $('clTeamOverlay').addEventListener('click', (e) => {
        if (e.target === $('clTeamOverlay')) closeTeamModal();
    });
    $('clTeamAddForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $('clTeamNewName').value;
        $('clTeamNewName').value = '';
        await addTeamMember(name);
    });
    $('clTeamList').addEventListener('click', (e) => {
        const btn = e.target.closest('.cl-team-remove');
        if (!btn) return;
        removeTeamMember(btn.getAttribute('data-name'));
    });

    // Sort by time (edit mode)
    $('btnSortByTime').addEventListener('click', sortActiveByTime);

    // Start new day (archives previous cycle to history, clears marks)
    $('btnStartDay').addEventListener('click', startNewDay);

    // History modal
    $('btnHistory').addEventListener('click', openHistoryModal);
    $('clHistoryClose').addEventListener('click', closeHistoryModal);
    $('clHistoryOverlay').addEventListener('click', (e) => {
        if (e.target === $('clHistoryOverlay')) closeHistoryModal();
    });

    // Edit mode toggle
    $('btnEditMode').addEventListener('click', toggleEditMode);

    // Delegated events on the task list
    $('clList').addEventListener('change', (e) => {
        const sel = e.target.closest('.cl-doneby');
        if (!sel) return;
        setTaskState(sel.getAttribute('data-id'), sel.value);
    });
    $('clList').addEventListener('click', (e) => {
        const addAfterBtn = e.target.closest('.cl-add-after');
        if (addAfterBtn) {
            const active = getActiveChecklist();
            const parent = active && active.items.find(x => x.id === addAfterBtn.getAttribute('data-id'));
            if (parent) openTaskModal(null, { afterId: parent.id, prefillTime: parent.time });
            return;
        }
        const editBtn = e.target.closest('.cl-edit');
        if (editBtn) {
            const active = getActiveChecklist();
            const it = active && active.items.find(x => x.id === editBtn.getAttribute('data-id'));
            if (it) openTaskModal(it);
            return;
        }
        const delBtn = e.target.closest('.cl-delete');
        if (delBtn) {
            deleteTask(delBtn.getAttribute('data-id'));
        }
    });

    // Persistent list (right column)
    $('clPersAddForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = $('clPersNewName');
        const name = input.value;
        input.value = '';
        await addPersistentTask(name);
    });
    $('clPersList').addEventListener('change', (e) => {
        const sel = e.target.closest('.cl-pers-doneby');
        if (sel) {
            setPersistentDoneBy(sel.getAttribute('data-id'), sel.value);
            return;
        }
        const prio = e.target.closest('.cl-pers-priority');
        if (prio) {
            setPersistentPriority(prio.getAttribute('data-id'), prio.value);
        }
    });
    $('clPersList').addEventListener('click', (e) => {
        const delBtn = e.target.closest('.cl-pers-delete');
        if (!delBtn) return;
        deletePersistentTask(delBtn.getAttribute('data-id'));
    });

    // ESC closes any open modal
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if ($('clModalOverlay').classList.contains('open')) closeTaskModal();
        else if ($('clNameOverlay').classList.contains('open')) closeNameModal();
        else if ($('clTeamOverlay').classList.contains('open')) closeTeamModal();
        else if ($('clHistoryOverlay').classList.contains('open')) closeHistoryModal();
    });
}

// Updates just the overdue-related classes on the current rows — avoids a
// full re-render for the clock ticking. Called every minute and on visibility.
function refreshOverdueStyles() {
    const active = getActiveChecklist();
    if (!active) return;
    const OVERDUE_CLASSES = ['overdue-yellow', 'overdue-orange', 'overdue-red'];
    for (const it of active.items) {
        const row = document.querySelector(`.cl-task[data-id="${it.id}"]`);
        if (!row) continue;
        row.classList.remove(...OVERDUE_CLASSES);
        const cls = overdueClass(it);
        if (cls) row.classList.add(cls);
    }
}

let _overdueInterval = null;

async function init() {
    bindUI();
    await load();
    renderAll();
    if (_overdueInterval) clearInterval(_overdueInterval);
    _overdueInterval = setInterval(refreshOverdueStyles, 60000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshOverdueStyles();
    });
}

if (getStoreCode()) {
    init();
}
window.addEventListener('storeReady', init);
