// === Checklist module (Fase 2) ===
// Multiple named checklists, team-based "done by" dropdown instead of a boolean checkbox.
// Time picker forced to 24 h via flatpickr (Spanish locale).

const MODULE = 'checklist';
const ACTIVE_KEY_PREFIX = 'checklist_active_'; // + storeCode
const NOTE_SIGNER_KEY_PREFIX = 'checklist_note_signer_'; // + storeCode

let _state = {
    checklists: [],     // [{ id, name, manualOrder, cycleDate, items, history }]
    persistent: { items: [] },  // right column: no time, no reset. [{ id, name, doneBy, createdAt }]
    staff: [],          // ["Ana", "Pedro", ...]
    activeId: null,
    editingTaskId: null,
    afterTaskId: null,  // when set on submit: new item is inserted right after this task
    editingPersNoteId: null,  // persistent task whose note is open in the note modal
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

// All date-math helpers take an optional `refDate` = the ISO of the checklist's
// current cycle. Using cycleDate (not wall-clock today) means: until the user
// presses "Iniciar {fecha}", the list is evaluated from the old cycle's frame
// — so a task done yesterday in the unarchived cycle doesn't suddenly report
// "hace 1 día" just because midnight crossed.
function computeDaysSince(task, refDate) {
    const ref = task.lastDoneDate || taskCreationDate(task);
    if (!ref) return null;
    const target = refDate || todayISO();
    const n = daysBetween(ref, target);
    return n == null ? null : Math.max(0, n);
}

// Days since the task was last "processed" — done OR skipped, whichever
// happened most recently across the checklist's history. Falls back to
// lastDoneDate / creation date if nothing in history yet. This drives the
// critical-alarm decision so that explicitly skipping a task counts as
// handling it for the purposes of not raising a red flag later.
function computeDaysSinceProcessed(task, refDate, checklist) {
    let ref = null;
    if (checklist && Array.isArray(checklist.history)) {
        for (const h of checklist.history) {
            if (h.taskId !== task.id) continue;
            if (!h.doneBy && !h.skipped) continue;  // ignore "sin marcar" entries
            if (!ref || h.date > ref) ref = h.date;
        }
    }
    if (!ref) ref = task.lastDoneDate || taskCreationDate(task);
    if (!ref) return null;
    const target = refDate || todayISO();
    const n = daysBetween(ref, target);
    return n == null ? null : Math.max(0, n);
}

function isCritical(task, refDate, checklist) {
    // A task processed in the current cycle isn't critical — it's already done
    // or explicitly skipped for this cycle.
    if (task.doneBy || task.skipped) return false;
    const threshold = Number(task.criticalEveryDays);
    if (!threshold || threshold <= 0) return false;
    // Measure against "last processed" (done OR skipped) so that skipping a
    // task — an explicit decision that it didn't need doing — doesn't let the
    // alarm fire on the next cycle just because the clock moved forward.
    const days = computeDaysSinceProcessed(task, refDate, checklist);
    // Strictly greater than the threshold: "N días sin hacerla ANTES de
    // crítica" means the alarm fires on day N+1 of inactivity. So a daily
    // task (threshold 1) stays neutral on its normal cycle day and only
    // flags red if it's been ignored for 2+ days with no skip either.
    return days != null && days > threshold;
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
// Also skipped when cycleDate !== today: you're looking at a stale cycle, every
// scheduled time has already passed and the list would be all red — noise.
function overdueClass(task, refDate, checklist) {
    if (task.doneBy || task.skipped) return '';
    if (isCritical(task, refDate, checklist)) return '';
    if (refDate && refDate !== todayISO()) return '';
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

// Collapse duplicate history entries for the same (date, taskId). Last one
// wins — which is by design, as archive entries (written by startNewDay) come
// chronologically after per-mark entries from the legacy auto-recorder that
// used to run on every setTaskState call. Returns true if anything collapsed.
function dedupHistory(checklist) {
    if (!Array.isArray(checklist.history)) return false;
    const before = checklist.history.length;
    const seen = new Map();
    for (const h of checklist.history) {
        seen.set(h.date + '|' + h.taskId, h);
    }
    checklist.history = Array.from(seen.values());
    return checklist.history.length !== before;
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
let _unsubscribe = null;

// Map server data into _state. Runs on every snapshot, including our own
// writes after round-trip (they're benign — local state is already correct).
function applyRemoteData(data) {
    if (data && Array.isArray(data.items) && !Array.isArray(data.checklists)) {
        // Migration: Phase 1 stored { items: [...] } at top level.
        _state.checklists = [{
            id: uuid('ck_'),
            name: 'Apertura',
            items: data.items.map(it => ({
                id: it.id || uuid(),
                time: it.time || '',
                name: it.name || '',
                doneBy: '',
            })),
        }];
        _state.staff = [];
    } else {
        _state.checklists = (data && Array.isArray(data.checklists)) ? data.checklists : [];
        _state.staff = (data && Array.isArray(data.staff)) ? data.staff : [];
    }
    _state.persistent = (data && data.persistent && Array.isArray(data.persistent.items))
        ? data.persistent
        : { items: [] };
    if (!Array.isArray(_state.persistent.archive)) _state.persistent.archive = [];
    let migrated = false;
    // Drop obsolete `log` field (replaced by full-task `archive`).
    if (Array.isArray(_state.persistent.log)) { delete _state.persistent.log; migrated = true; }
    // Drop any lingering per-task history arrays (earlier iteration).
    for (const it of _state.persistent.items) {
        if (Array.isArray(it.history)) { delete it.history; migrated = true; }
    }
    // Move any "done-in-items" legacy tasks into the archive so vigentes stays clean.
    const completedLegacy = _state.persistent.items.filter(it => it.doneBy);
    if (completedLegacy.length > 0) {
        for (const it of completedLegacy) {
            _state.persistent.archive.push({
                id: it.id,
                name: it.name || '',
                priority: clampPriority(it.priority),
                note: it.note || '',
                createdAt: it.createdAt,
                completedAt: new Date().toISOString(),
                completedBy: it.doneBy,
            });
        }
        _state.persistent.items = _state.persistent.items.filter(it => !it.doneBy);
        migrated = true;
    }
    if (migrated) persist().catch((e) => console.warn('persistent-archive migration persist failed', e));
    let cleanedAny = false;
    for (const cl of _state.checklists) {
        if (!cl.items) cl.items = [];
        if (!cl.manualOrder) sortItemsByTime(cl.items);
        if (dedupHistory(cl)) cleanedAny = true;
    }
    if (cleanedAny) persist().catch((e) => console.warn('history dedup persist failed', e));
    const storedActive = localStorage.getItem(activeKey());
    if (storedActive && _state.checklists.find(c => c.id === storedActive)) {
        _state.activeId = storedActive;
    } else if (!_state.checklists.find(c => c.id === _state.activeId)) {
        _state.activeId = _state.checklists[0]?.id || null;
    }
}

// Real-time subscription to the checklist module doc. Updates arrive from any
// device on the same store; our own writes also echo back here (filtered via
// hasPendingWrites — the snapshot is local-only until the server confirms).
// This kills the clobber bug where device B, holding stale state, would save
// without device A's recent note and silently delete it.
async function load() {
    const ref = storeDocRef(MODULE);
    if (!ref) return;
    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
    return new Promise((resolve, reject) => {
        let firstSnapshot = true;
        _unsubscribe = ref.onSnapshot(
            { includeMetadataChanges: false },
            snap => {
                // Local pending writes: state already reflects them, skip to
                // avoid re-rendering over in-progress DOM (e.g. open modals).
                if (snap.metadata.hasPendingWrites && !firstSnapshot) return;
                const data = snap.exists ? snap.data() : null;
                applyRemoteData(data);
                if (firstSnapshot) {
                    firstSnapshot = false;
                    resolve();
                } else {
                    // Remote update: refresh all derived UI.
                    renderAll();
                }
            },
            err => {
                console.error('[checklist] snapshot error:', err);
                if (firstSnapshot) { firstSnapshot = false; reject(err); }
            }
        );
    });
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
        // Daily progress: "archivadas hoy / (archivadas hoy + vigentes)".
        // The denominator is the day's workload; it stays stable as tasks
        // move from vigentes to archive over the day.
        const today = todayISO();
        const archive = (_state.persistent && _state.persistent.archive) || [];
        const doneToday = archive.filter(a => {
            const d = new Date(a.completedAt);
            if (isNaN(d)) return false;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            return key === today;
        }).length;
        const totalToday = doneToday + items.length;
        countEl.textContent = `${doneToday} / ${totalToday}`;
        countEl.title = 'Archivadas hoy / total del día (vigentes + archivadas hoy)';
        countEl.classList.toggle('complete', totalToday > 0 && items.length === 0);
    }
    renderPersBriefing();
    if (items.length === 0) {
        list.innerHTML = '<div class="cl-pers-empty">Sin tareas pendientes. Añade una arriba; al marcarla como hecha se moverá al archivo.</div>';
        return;
    }
    // Sort by priority desc (stable within ties).
    const sorted = items.slice().sort((a, b) => clampPriority(b.priority) - clampPriority(a.priority));
    const noStaff = _state.staff.length === 0;
    list.innerHTML = sorted.map(it => {
        const priority = clampPriority(it.priority);
        const hasNote = !!(it.note && it.note.trim());
        const staffOptions = _state.staff.map(s =>
            `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`
        ).join('');
        return `
        <div class="cl-pers-task" data-id="${it.id}">
            <span class="cl-pers-name" title="Doble clic para renombrar">${escapeHtml(it.name)}</span>
            <div class="cl-pers-controls">
                <select class="cl-pers-doneby" data-id="${it.id}" ${noStaff ? 'disabled title="Configura el equipo primero"' : 'title="Marcar como hecha mueve la tarea al archivo"'}>
                    <option value="" selected>${noStaff ? '— añade equipo —' : '— Sin hacer —'}</option>
                    ${staffOptions}
                </select>
                <div class="cl-pers-priority-row">
                    <button class="cl-pers-note ${hasNote ? 'has-note' : ''}" data-id="${it.id}" title="${hasNote ? 'Ver / editar notas' : 'Añadir notas'}" aria-label="Notas">Notas</button>
                    <select class="cl-pers-priority" data-id="${it.id}" title="Prioridad" style="background:${priorityColor(priority).bg};color:${priorityColor(priority).textColor}">
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
                </div>
            </div>
            <button class="cl-pers-delete" data-id="${it.id}" title="Eliminar" aria-label="Eliminar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>`;
    }).join('');
}

// === Persistent task: free-form note modal ===
// Single shared textarea per task. Multiple people can add lines and use the
// "Firmar" button to stamp their name + dd/mm hh:mm at the cursor, so the log
// reads naturally without needing structured comment entries.
function noteSignerKey() { return NOTE_SIGNER_KEY_PREFIX + (getStoreCode() || ''); }

function openNoteModal(task) {
    _state.editingPersNoteId = task.id;
    $('clNoteTitle').textContent = 'Notas · ' + (task.name || '(sin nombre)');
    $('clNoteText').value = task.note || '';
    renderNoteSigners();
    $('clNoteOverlay').classList.add('open');
    setTimeout(() => $('clNoteText').focus(), 60);
}

function closeNoteModal() {
    $('clNoteOverlay').classList.remove('open');
    _state.editingPersNoteId = null;
}

function renderNoteSigners() {
    const sel = $('clNoteSigner');
    const btn = $('clNoteSignBtn');
    if (_state.staff.length === 0) {
        sel.innerHTML = '<option value="">— configura el equipo primero —</option>';
        sel.disabled = true;
        btn.disabled = true;
        return;
    }
    sel.disabled = false;
    btn.disabled = false;
    const stored = localStorage.getItem(noteSignerKey());
    const preselect = (stored && _state.staff.includes(stored)) ? stored : _state.staff[0];
    sel.innerHTML = _state.staff.map(s =>
        `<option value="${escapeHtml(s)}" ${s === preselect ? 'selected' : ''}>${escapeHtml(s)}</option>`
    ).join('');
}

function insertSignature() {
    const signer = $('clNoteSigner').value;
    if (!signer) return;
    localStorage.setItem(noteSignerKey(), signer);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const sig = `— ${signer}, ${stamp}\n`;
    const ta = $('clNoteText');
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.substring(0, start);
    const after = ta.value.substring(end);
    // Ensure the signature starts on its own line
    const needsLead = before && !before.endsWith('\n');
    const insert = (needsLead ? '\n' : '') + sig;
    ta.value = before + insert + after;
    const caret = (before + insert).length;
    ta.setSelectionRange(caret, caret);
    ta.focus();
}

async function saveNote() {
    if (!_state.editingPersNoteId) return;
    const it = _state.persistent && _state.persistent.items.find(x => x.id === _state.editingPersNoteId);
    if (!it) { closeNoteModal(); return; }
    it.note = $('clNoteText').value;
    closeNoteModal();
    renderPersistent();
    await persist();
}

// Small "recently archived" summary under the vigentes list — latest 3 entries.
// Clicking opens the full archive modal.
function renderPersBriefing() {
    const el = $('clPersBriefing');
    if (!el) return;
    const archive = (_state.persistent && Array.isArray(_state.persistent.archive)) ? _state.persistent.archive : [];
    if (archive.length === 0) { el.innerHTML = ''; return; }
    const latest = archive.slice().sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')).slice(0, 3);
    const pad = n => String(n).padStart(2, '0');
    const rows = latest.map(a => {
        const d = new Date(a.completedAt);
        const t = isNaN(d) ? '--:--' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return `<div class="cl-pers-brief-row"><span class="cl-pers-brief-time">${t}</span><span class="cl-pers-brief-name">${escapeHtml(a.name || '(sin nombre)')}</span><span class="cl-pers-brief-who">${escapeHtml(a.completedBy || '—')}</span></div>`;
    }).join('');
    el.innerHTML = `<button class="cl-pers-brief-head" id="clPersBriefOpen" type="button" title="Abrir archivo completo">Recién archivadas ›</button>${rows}`;
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

// Marking a persistent task as done MOVES it from the vigentes list to the
// archive, preserving all its properties (name, priority, note, createdAt)
// and stamping completedAt/completedBy. From the archive it can be restored
// back to vigentes or permanently deleted.
async function setPersistentDoneBy(id, doneBy) {
    if (!doneBy) return;  // "— Sin hacer —" was reselected; nothing to do
    if (!_state.persistent || !Array.isArray(_state.persistent.items)) return;
    const idx = _state.persistent.items.findIndex(x => x.id === id);
    if (idx < 0) return;
    const it = _state.persistent.items[idx];
    if (!Array.isArray(_state.persistent.archive)) _state.persistent.archive = [];
    _state.persistent.archive.push({
        id: it.id,
        name: it.name || '',
        priority: clampPriority(it.priority),
        note: it.note || '',
        createdAt: it.createdAt,
        completedAt: new Date().toISOString(),
        completedBy: doneBy,
    });
    _state.persistent.items.splice(idx, 1);
    renderPersistent();
    await persist();
}

async function restoreFromArchive(id) {
    if (!_state.persistent || !Array.isArray(_state.persistent.archive)) return;
    const idx = _state.persistent.archive.findIndex(x => x.id === id);
    if (idx < 0) return;
    const archived = _state.persistent.archive[idx];
    if (!Array.isArray(_state.persistent.items)) _state.persistent.items = [];
    _state.persistent.items.push({
        id: archived.id,
        name: archived.name || '',
        priority: clampPriority(archived.priority),
        note: archived.note || '',
        doneBy: '',
        createdAt: archived.createdAt || Date.now(),
    });
    _state.persistent.archive.splice(idx, 1);
    renderPersistent();
    renderPersArchive();
    await persist();
}

async function deleteFromArchive(id) {
    if (!_state.persistent || !Array.isArray(_state.persistent.archive)) return;
    const archived = _state.persistent.archive.find(x => x.id === id);
    if (!archived) return;
    if (!confirm(`¿Eliminar "${archived.name || 'esta tarea'}" del archivo? No se puede deshacer.`)) return;
    _state.persistent.archive = _state.persistent.archive.filter(x => x.id !== id);
    renderPersistent();  // briefing may need refresh
    renderPersArchive();
    await persist();
}

async function purgePersArchive() {
    const storeCode = getStoreCode();
    if (!storeCode) return;
    const pwd = prompt('Contraseña de la tienda para borrar TODO el archivo de tareas persistentes:');
    if (pwd == null) return;
    try {
        const doc = await db.collection('stores').doc(storeCode).get();
        if (!doc.exists || doc.data().password !== pwd) { alert('Contraseña incorrecta.'); return; }
    } catch (e) { console.error(e); alert('Error verificando la contraseña.'); return; }
    if (!confirm('Se borrará el archivo completo. ¿Continuar?')) return;
    _state.persistent.archive = [];
    renderPersistent();
    renderPersArchive();
    await persist();
}

async function setPersistentPriority(id, value) {
    const it = _state.persistent && _state.persistent.items.find(x => x.id === id);
    if (!it) return;
    it.priority = clampPriority(value);
    renderPersistent();
    await persist();
}

// Inline rename of a persistent task. Double-click the name span to turn it
// into an input; Enter or blur saves, Escape reverts. A re-render restores
// the row layout cleanly afterwards (simpler than surgically swapping back).
function startPersNameEdit(nameEl, task) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cl-pers-name-edit';
    input.value = task.name || '';
    input.maxLength = 140;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = async (save) => {
        if (done) return;
        done = true;
        if (save) {
            const v = input.value.trim();
            if (v && v !== task.name) {
                task.name = v;
                await persist();
            }
        }
        renderPersistent();
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(true); }
        else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
}

// === Persistent archive modal ===
function openPersArchive() {
    renderPersArchive();
    $('clPersArchiveOverlay').classList.add('open');
}
function closePersArchive() { $('clPersArchiveOverlay').classList.remove('open'); }

function renderPersArchive() {
    const body = $('clPersArchiveBody');
    const archive = (_state.persistent && Array.isArray(_state.persistent.archive)) ? _state.persistent.archive : [];
    if (archive.length === 0) {
        body.innerHTML = '<div class="cl-hist-empty">Sin tareas archivadas. Aquí caerán las persistentes que marques como hechas, con sus propiedades intactas para recuperarlas si hiciera falta.</div>';
        return;
    }
    // Group by local date (YYYY-MM-DD), latest first
    const byDate = new Map();
    for (const a of archive) {
        const d = new Date(a.completedAt);
        if (isNaN(d)) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key).push(a);
    }
    const dates = Array.from(byDate.keys()).sort().reverse();
    const pad = n => String(n).padStart(2, '0');
    const daysHtml = dates.map(date => {
        const entries = byDate.get(date).slice().sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
        const { label, sub, isToday } = formatHistoryDate(date);
        const rowsHtml = entries.map(a => {
            const d = new Date(a.completedAt);
            const time = isNaN(d) ? '--:--' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
            const hasNote = !!(a.note && a.note.trim());
            return `
                <div class="cl-arch-row">
                    <span class="cl-hist-time">${time}</span>
                    <span class="cl-arch-name">${escapeHtml(a.name || '(sin nombre)')}</span>
                    ${hasNote ? `<span class="cl-arch-note" title="${escapeHtml(a.note)}">📝</span>` : ''}
                    <span class="cl-hist-who done">${escapeHtml(a.completedBy || '—')}</span>
                    <button class="cl-arch-action cl-arch-restore" data-id="${a.id}" title="Recuperar a la lista de vigentes">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                    </button>
                    <button class="cl-arch-action cl-arch-delete" data-id="${a.id}" title="Eliminar del archivo">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>`;
        }).join('');
        return `
            <div class="cl-hist-day">
                <div class="cl-hist-day-header">
                    <span class="cl-hist-day-label ${isToday ? 'today' : ''}">${escapeHtml(label)}</span>
                    <span class="cl-hist-day-count">${sub} · ${entries.length} ${entries.length === 1 ? 'tarea' : 'tareas'}</span>
                </div>
                <div class="cl-hist-rows">${rowsHtml}</div>
            </div>`;
    }).join('');
    body.innerHTML = daysHtml;
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

    // Frame everything against the active checklist's cycleDate, not wall-clock
    // today. The list represents one cycle at a time; age/critical/overdue are
    // only meaningful within that frame. See computeDaysSince / isCritical.
    const refDate = active.cycleDate || todayISO();

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
        const critical = isCritical(it, refDate, active);
        const rowState = [
            isDone ? 'done' : (isSkipped ? 'skipped' : ''),
            critical ? 'critical' : '',
            overdueClass(it, refDate, active),
        ].filter(Boolean).join(' ');
        const selValue = isDone ? it.doneBy : (isSkipped ? '__skip__' : '');
        const selectClass = isDone ? 'assigned' : (isSkipped ? 'skipped' : '');
        // Age chip: only shown for PENDING tasks (not done, not skipped)
        // with a criticality threshold configured and more than one day
        // without being processed. Skipped tasks are intentionally skipped
        // (no deadline) and done ones are already handled — neither should
        // carry an alert.
        const daysSince = computeDaysSince(it, refDate);
        const hasCriticality = Number(it.criticalEveryDays) > 0;
        const isPending = !isDone && !isSkipped;
        const ageHtml = (isPending && hasCriticality && daysSince != null && daysSince > 1) ? `
            <span class="cl-age ${critical ? 'cl-age-critical' : ''}" title="Hace ${daysSince} días desde la última vez marcada como hecha · crítica tras ${it.criticalEveryDays} día${it.criticalEveryDays === 1 ? '' : 's'} sin hacer">
                ${critical ? '⚠ ' : ''}hace ${daysSince} días
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
        // Edit/add-after/skip-toggle/delete are only rendered in edit mode (defence in depth on top of the CSS hide)
        const skipAllowed = it.allowSkip === true;
        const actionsHtml = _state.editMode ? `
            <div class="cl-actions">
                <button class="cl-action-btn cl-add-after" data-id="${it.id}" title="Añadir tarea siguiente" aria-label="Añadir tarea siguiente">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                </button>
                <button class="cl-action-btn cl-skip-toggle ${skipAllowed ? '' : 'disallowed'}" data-id="${it.id}" title="${skipAllowed ? 'Se puede saltar — clic para no permitir' : 'No se puede saltar — clic para permitir'}" aria-label="${skipAllowed ? 'No permitir saltar' : 'Permitir saltar'}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="5 4 15 12 5 20 5 4"/>
                        <line x1="17" y1="5" x2="17" y2="19"/>
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
            <div class="cl-time-wrap">
                <span class="cl-time">${escapeHtml(it.time)}</span>
                ${ageHtml}
            </div>
            <div class="cl-name-wrap">
                ${hasName ? `<span class="cl-name">${escapeHtml(it.name)}</span>` : ''}
                ${linkHtml}
            </div>
            <select class="cl-doneby ${selectClass}" data-id="${it.id}" ${noStaff ? 'disabled title="Configura el equipo primero"' : ''}>
                <option value="" ${selValue === '' ? 'selected' : ''}>${noStaff ? '— añade equipo —' : '— Sin hacer —'}</option>
                ${it.allowSkip === true ? `<option value="__skip__" ${selValue === '__skip__' ? 'selected' : ''}>⏭ Saltar</option>` : ''}
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
        // allowSkip defaults to false (most tasks aren't skippable). The user
        // turns it on per-task for the few that should expose the "Saltar"
        // option in the dropdown.
        form.allowSkip.checked = existing.allowSkip === true;
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
    const allowSkip = form.allowSkip.checked;
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
            it.allowSkip = allowSkip;
        }
    } else {
        const newItem = { id: uuid(), time, name, doneBy: '', url, urlLabel, criticalEveryDays, allowSkip };
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
        // We store the cycleDate (not wall-clock today) so marking a task at
        // 01:00 on day N+1 while cycleDate is still N logs it as day N — which
        // matches what the history archive will record.
        if (it.doneBy) it.lastDoneDate = active.cycleDate || todayISO();
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

// Inline toggle in edit mode — flips it.allowSkip without opening the modal.
async function toggleAllowSkip(taskId) {
    const active = getActiveChecklist();
    if (!active) return;
    const it = active.items.find(x => x.id === taskId);
    if (!it) return;
    it.allowSkip = it.allowSkip === false ? true : false;
    renderTasks();
    await persist();
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
        // reflects what actually happened (and didn't). Upsert by (date,taskId)
        // so re-archiving or legacy per-mark entries never double up.
        const keep = cl.history.filter(h => h.date !== cycleDate || !(cl.items || []).some(it => it.id === h.taskId));
        for (const it of (cl.items || [])) {
            keep.push({
                date: cycleDate,
                taskId: it.id,
                doneBy: it.doneBy || '',
                skipped: !!it.skipped,
            });
        }
        cl.history = keep;
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

// TEMPORARY (v0.8): manual history purge behind store-password. Lets the user
// wipe a polluted log (legacy duplicates) without waiting for the next archive
// to overwrite them. Safe to delete once the data is clean.
async function purgeHistory() {
    const storeCode = getStoreCode();
    if (!storeCode) return;
    const pwd = prompt('Contraseña de la tienda para borrar TODO el histórico:');
    if (pwd == null) return;  // user cancelled
    try {
        const doc = await db.collection('stores').doc(storeCode).get();
        if (!doc.exists || doc.data().password !== pwd) {
            alert('Contraseña incorrecta.');
            return;
        }
    } catch (e) {
        console.error(e);
        alert('Error verificando la contraseña.');
        return;
    }
    if (!confirm('Se borrará el histórico de TODAS las checklists de esta tienda. ¿Continuar?')) return;
    for (const cl of _state.checklists) cl.history = [];
    await persist();
    renderHistoryModal();
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

    // Team
    $('btnTeam').addEventListener('click', openTeamModal);
    $('clTeamClose').addEventListener('click', closeTeamModal);
    $('clTeamDone').addEventListener('click', closeTeamModal);
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

    // Skip-info modal
    $('btnSkipInfo').addEventListener('click', () => $('clSkipInfoOverlay').classList.add('open'));
    const closeSkipInfo = () => $('clSkipInfoOverlay').classList.remove('open');
    $('clSkipInfoClose').addEventListener('click', closeSkipInfo);
    $('clSkipInfoOk').addEventListener('click', closeSkipInfo);

    // History modal
    $('btnHistory').addEventListener('click', openHistoryModal);
    $('clHistoryClose').addEventListener('click', closeHistoryModal);
    $('btnPurgeHistory').addEventListener('click', purgeHistory);

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
        const skipBtn = e.target.closest('.cl-skip-toggle');
        if (skipBtn) {
            toggleAllowSkip(skipBtn.getAttribute('data-id'));
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
        const noteBtn = e.target.closest('.cl-pers-note');
        if (noteBtn) {
            const it = _state.persistent && _state.persistent.items.find(x => x.id === noteBtn.getAttribute('data-id'));
            if (it) openNoteModal(it);
            return;
        }
        const delBtn = e.target.closest('.cl-pers-delete');
        if (delBtn) deletePersistentTask(delBtn.getAttribute('data-id'));
    });
    // Double-click the name to rename inline
    $('clPersList').addEventListener('dblclick', (e) => {
        const nameEl = e.target.closest('.cl-pers-name');
        if (!nameEl) return;
        const row = nameEl.closest('.cl-pers-task');
        if (!row) return;
        const it = _state.persistent && _state.persistent.items.find(x => x.id === row.getAttribute('data-id'));
        if (it) startPersNameEdit(nameEl, it);
    });

    // Persistent archive modal
    $('btnPersArchive').addEventListener('click', openPersArchive);
    $('clPersArchiveClose').addEventListener('click', closePersArchive);
    $('btnPurgePersArchive').addEventListener('click', purgePersArchive);
    $('clPersArchiveBody').addEventListener('click', (e) => {
        const restore = e.target.closest('.cl-arch-restore');
        if (restore) { restoreFromArchive(restore.getAttribute('data-id')); return; }
        const del = e.target.closest('.cl-arch-delete');
        if (del) { deleteFromArchive(del.getAttribute('data-id')); }
    });
    // Clicking the briefing header opens the full archive
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'clPersBriefOpen') openPersArchive();
    });

    // Persistent note modal
    $('clNoteClose').addEventListener('click', closeNoteModal);
    $('clNoteCancel').addEventListener('click', closeNoteModal);
    $('clNoteSave').addEventListener('click', saveNote);
    $('clNoteSignBtn').addEventListener('click', insertSignature);

    // ESC closes any open modal
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if ($('clModalOverlay').classList.contains('open')) closeTaskModal();
        else if ($('clNameOverlay').classList.contains('open')) closeNameModal();
        else if ($('clTeamOverlay').classList.contains('open')) closeTeamModal();
        else if ($('clHistoryOverlay').classList.contains('open')) closeHistoryModal();
        else if ($('clNoteOverlay').classList.contains('open')) closeNoteModal();
        else if ($('clPersArchiveOverlay').classList.contains('open')) closePersArchive();
        else if ($('clSkipInfoOverlay').classList.contains('open')) $('clSkipInfoOverlay').classList.remove('open');
    });
}

// Updates just the overdue-related classes on the current rows — avoids a
// full re-render for the clock ticking. Called every minute and on visibility.
function refreshOverdueStyles() {
    const active = getActiveChecklist();
    if (!active) return;
    const refDate = active.cycleDate || todayISO();
    const OVERDUE_CLASSES = ['overdue-yellow', 'overdue-orange', 'overdue-red'];
    for (const it of active.items) {
        const row = document.querySelector(`.cl-task[data-id="${it.id}"]`);
        if (!row) continue;
        row.classList.remove(...OVERDUE_CLASSES);
        const cls = overdueClass(it, refDate, active);
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
