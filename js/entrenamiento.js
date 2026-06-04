// === Entrenamiento (Training) module ===
// Reemplaza la hoja Excel de formación del equipo:
//   Fecha · Staff · Competencia entrenada · Formador · Estado · Notas
// La lista de personas (Staff y Formador) se comparte con el "Equipo" del módulo
// Checklist — aquí es de solo lectura; se gestiona desde Checklist → Equipo.

const MODULE = 'training';

// Estados en orden de progresión, con sus colores definidos en el CSS.
const STATES = ['Pendiente', 'Nociones', 'Iniciado', 'Competente', 'Avanzado', 'Experto / Formador'];

let _state = {
    records: [],   // [{ id, date, staff, competency, trainer, status, notes }]
    staff: [],     // nombres del equipo, leídos del módulo Checklist
    sortKey: 'date',   // columna por la que ordenar
    sortDir: 'desc',   // 'asc' | 'desc' — por defecto fecha más reciente primero
};
let _unsubscribe = null;
let _saveTimer = null;

// === Helpers ===
function $(id) { return document.getElementById(id); }
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}
function uuid() { return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Flatpickr: valor ISO interno (Y-m-d), se muestra dd/mm/aaaa (locale español)
const DATE_PICKER_CFG = {
    locale: 'es', dateFormat: 'Y-m-d', altInput: true, altFormat: 'd/m/Y',
    allowInput: true, disableMobile: true,
};

// === DOM refs ===
const tableEl = () => $('trTable');
const tbodyEl = () => $('trBody');

// === Persistence (full set, no merge — borrar un registro lo elimina de verdad) ===
async function persistNow() {
    const ref = storeDocRef(MODULE);
    if (!ref) return;
    await ref.set({
        records: _state.records,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
}
function persist() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        _saveTimer = null;
        persistNow().catch(e => console.error('[training] save failed:', e));
    }, 600);
}
// Vacía el guardado pendiente al salir/ocultar la pestaña — así nada de lo escrito
// se pierde por el debounce (la lección del módulo Xfer).
function flushPersist() {
    if (!_saveTimer) return;
    clearTimeout(_saveTimer);
    _saveTimer = null;
    persistNow().catch(e => console.error('[training] flush failed:', e));
}

// === Realtime load ===
async function load() {
    const ref = storeDocRef(MODULE);
    if (!ref) return;
    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
    return new Promise((resolve, reject) => {
        let first = true;
        _unsubscribe = ref.onSnapshot(
            { includeMetadataChanges: false },
            snap => {
                // Nuestras propias escrituras pendientes ya están en el DOM/estado.
                if (snap.metadata.hasPendingWrites && !first) return;
                const data = snap.exists ? snap.data() : null;
                _state.records = (data && Array.isArray(data.records)) ? data.records : [];
                if (first) {
                    first = false;
                    resolve();
                } else if (!isEditingTable()) {
                    // Update remoto: no re-render si estamos editando (no pisar el foco)
                    renderTable();
                    applyFilter();
                }
            },
            err => {
                console.error('[training] snapshot error:', err);
                if (first) { first = false; reject(err); }
            }
        );
    });
}

function isEditingTable() {
    const a = document.activeElement;
    const t = tableEl();
    return !!(a && t && t.contains(a));
}

// Equipo compartido con Checklist (solo lectura)
async function loadTeam() {
    try {
        const data = await loadModuleData('checklist');
        _state.staff = (data && Array.isArray(data.staff)) ? data.staff.slice() : [];
    } catch (e) {
        console.warn('[training] no se pudo leer el equipo de Checklist:', e);
        _state.staff = [];
    }
}

// === Render ===
function personSelect(value, cls) {
    const names = _state.staff.slice();
    // Conserva un valor antiguo aunque ya no esté en el equipo
    if (value && !names.includes(value)) names.unshift(value);
    const opts = ['<option value="">—</option>'].concat(
        names.map(n => `<option value="${escapeHtml(n)}"${n === value ? ' selected' : ''}>${escapeHtml(n)}</option>`)
    );
    return `<select class="${cls}">${opts.join('')}</select>`;
}

function statusOptions(value) {
    return ['<option value="">—</option>'].concat(
        STATES.map(s => `<option value="${escapeHtml(s)}"${s === value ? ' selected' : ''}>${escapeHtml(s)}</option>`)
    ).join('');
}

function rowHTML(rec) {
    return `<tr data-id="${rec.id}">
        <td class="tr-date"><input type="date" class="f-date" value="${escapeHtml(rec.date || '')}"></td>
        <td class="tr-staff">${personSelect(rec.staff || '', 'f-staff')}</td>
        <td class="tr-comp"><input type="text" class="f-comp" list="trCompList" value="${escapeHtml(rec.competency || '')}" placeholder="Competencia entrenada" autocomplete="off"></td>
        <td class="tr-trainer">${personSelect(rec.trainer || '', 'f-trainer')}</td>
        <td class="tr-status"><select class="f-status" data-status="${escapeHtml(rec.status || '')}">${statusOptions(rec.status || '')}</select></td>
        <td class="tr-notes"><textarea class="f-notes" rows="2" placeholder="Notas…">${escapeHtml(rec.notes || '')}</textarea></td>
        <td class="tr-del"><button type="button" class="tr-del-btn" title="Eliminar registro" aria-label="Eliminar">×</button></td>
    </tr>`;
}

function renderTable() {
    const body = tbodyEl();
    if (!body) return;
    sortRecords();
    body.innerHTML = _state.records.map(rowHTML).join('');
    initDatePickers(body);
    populateCompetencyList();
    updateSortIndicators();
    updateEmptyState();
    updateTeamBanner();
}

// === Sorting ===
function compareRecords(a, b, key) {
    if (key === 'status') {
        // Por orden de progresión (no alfabético); los vacíos van primero
        return STATES.indexOf(a.status || '') - STATES.indexOf(b.status || '');
    }
    const av = (a[key] || '').toString();
    const bv = (b[key] || '').toString();
    if (key === 'date') return av.localeCompare(bv);   // ISO ordena bien como texto
    return av.localeCompare(bv, 'es', { sensitivity: 'base' });
}

function sortRecords() {
    const dir = _state.sortDir === 'desc' ? -1 : 1;
    _state.records.sort((a, b) => {
        const c = compareRecords(a, b, _state.sortKey);
        if (c !== 0) return c * dir;
        // Desempate estable por fecha para que el orden no "salte"
        return (a.date || '').localeCompare(b.date || '') * -1;
    });
}

function updateSortIndicators() {
    const t = tableEl();
    if (!t) return;
    t.querySelectorAll('th.sortable').forEach(th => {
        const active = th.dataset.sort === _state.sortKey;
        th.classList.toggle('sorted', active);
        const ind = th.querySelector('.tr-sort-ind');
        if (ind) ind.textContent = active ? (_state.sortDir === 'desc' ? '↓' : '↑') : '';
    });
}

function onHeaderClick(e) {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const key = th.dataset.sort;
    if (_state.sortKey === key) {
        _state.sortDir = _state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        _state.sortKey = key;
        _state.sortDir = (key === 'date') ? 'desc' : 'asc';
    }
    renderTable();
    applyFilter();
}

// Sugerencias de autorellenado para Competencia: valores únicos ya usados
function populateCompetencyList() {
    const list = $('trCompList');
    if (!list) return;
    const seen = new Map();   // clave en minúsculas -> valor original
    _state.records.forEach(r => {
        const c = (r.competency || '').trim();
        if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
    });
    const vals = Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    list.innerHTML = vals.map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
}

function initDatePickers(scope) {
    if (typeof flatpickr === 'undefined') return;
    (scope || document).querySelectorAll('input.f-date').forEach(el => {
        if (el._flatpickr) return;
        flatpickr(el, DATE_PICKER_CFG);
    });
}

function updateEmptyState() {
    const has = _state.records.length > 0;
    const empty = $('trEmpty');
    const wrap = $('trTableWrap');
    if (empty) empty.hidden = has;
    if (wrap) wrap.hidden = !has;
}

function updateTeamBanner() {
    const banner = $('trTeamBanner');
    if (banner) banner.hidden = _state.staff.length > 0;
}

// === Edits ===
function readRow(tr) {
    const rec = _state.records.find(r => r.id === tr.dataset.id);
    if (!rec) return;
    rec.date = tr.querySelector('.f-date').value || '';
    rec.staff = tr.querySelector('.f-staff').value || '';
    rec.competency = tr.querySelector('.f-comp').value || '';
    rec.trainer = tr.querySelector('.f-trainer').value || '';
    rec.status = tr.querySelector('.f-status').value || '';
    rec.notes = tr.querySelector('.f-notes').value || '';
}

function onCellEdit(e) {
    const tr = e.target.closest('tr');
    if (!tr || !tr.dataset.id) return;
    if (e.target.classList.contains('f-status')) {
        e.target.setAttribute('data-status', e.target.value);
    }
    readRow(tr);
    // Al confirmar (no en cada tecla) una competencia, refresca las sugerencias
    if (e.type === 'change' && e.target.classList.contains('f-comp')) populateCompetencyList();
    applyFilter();
    persist();
}

function addRecord() {
    // Limpia filtros para que el registro nuevo siempre se vea
    $('trSearch').value = '';
    $('trFilterComp').value = '';
    $('trFilterStaff').value = '';
    $('trFilterTrainer').value = '';
    $('trFilterStatus').value = '';

    const rec = { id: uuid(), date: todayISO(), staff: '', competency: '', trainer: '', status: '', notes: '' };
    _state.records.unshift(rec);

    // Re-render para que la fila quede en la posición que le toca según el orden actual
    renderTable();
    applyFilter();

    const tr = tbodyEl().querySelector(`tr[data-id="${rec.id}"]`);
    const comp = tr && tr.querySelector('.f-comp');
    if (comp) comp.focus();
    persistNow().catch(e => console.error('[training] add failed:', e));
}

function deleteRecord(id, tr) {
    const rec = _state.records.find(r => r.id === id);
    const label = rec && (rec.competency || rec.staff)
        ? `"${rec.competency || '(sin competencia)'}"${rec.staff ? ' de ' + rec.staff : ''}`
        : 'este registro';
    if (!confirm(`¿Eliminar ${label}?`)) return;
    _state.records = _state.records.filter(r => r.id !== id);
    tr.remove();
    updateEmptyState();
    applyFilter();
    persistNow().catch(e => console.error('[training] delete failed:', e));
}

// === Filtering ===
function applyFilter() {
    const q = ($('trSearch').value || '').trim().toLowerCase();
    const fComp = ($('trFilterComp').value || '').trim().toLowerCase();
    const fStaff = $('trFilterStaff').value || '';
    const fTrainer = $('trFilterTrainer').value || '';
    const fStatus = $('trFilterStatus').value || '';
    let visible = 0;

    tbodyEl().querySelectorAll('tr').forEach(tr => {
        const rec = _state.records.find(r => r.id === tr.dataset.id);
        if (!rec) return;
        let show = true;
        if (fComp && !(rec.competency || '').toLowerCase().includes(fComp)) show = false;
        if (show && fStaff && rec.staff !== fStaff) show = false;
        if (show && fTrainer && rec.trainer !== fTrainer) show = false;
        if (show && fStatus && rec.status !== fStatus) show = false;
        if (show && q) {
            // El buscador libre se centra en las notas (competencia/staff/formador tienen su propio filtro)
            if (!(rec.notes || '').toLowerCase().includes(q)) show = false;
        }
        tr.hidden = !show;
        if (show) visible++;
    });

    const count = $('trCount');
    if (count) {
        const total = _state.records.length;
        count.textContent = (visible === total)
            ? `${total} ${total === 1 ? 'registro' : 'registros'}`
            : `${visible} de ${total}`;
    }
}

function populateFilters() {
    const staffSel = $('trFilterStaff');
    const prevStaff = staffSel.value;
    staffSel.innerHTML = '<option value="">Todo el staff</option>' +
        _state.staff.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    staffSel.value = _state.staff.includes(prevStaff) ? prevStaff : '';

    const trainerSel = $('trFilterTrainer');
    const prevTrainer = trainerSel.value;
    trainerSel.innerHTML = '<option value="">Todos los formadores</option>' +
        _state.staff.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    trainerSel.value = _state.staff.includes(prevTrainer) ? prevTrainer : '';

    const statusSel = $('trFilterStatus');
    if (!statusSel.dataset.built) {
        statusSel.innerHTML = '<option value="">Todos los estados</option>' +
            STATES.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
        statusSel.dataset.built = '1';
    }
}

// === Wiring ===
function bindUI() {
    $('btnAddRecord').addEventListener('click', addRecord);
    $('trSearch').addEventListener('input', applyFilter);
    $('trFilterComp').addEventListener('input', applyFilter);
    $('trFilterStaff').addEventListener('change', applyFilter);
    $('trFilterTrainer').addEventListener('change', applyFilter);
    $('trFilterStatus').addEventListener('change', applyFilter);

    const thead = tableEl() && tableEl().querySelector('thead');
    if (thead) thead.addEventListener('click', onHeaderClick);

    const body = tbodyEl();
    ['input', 'change'].forEach(ev => body.addEventListener(ev, onCellEdit));
    body.addEventListener('click', (e) => {
        const del = e.target.closest('.tr-del-btn');
        if (!del) return;
        const tr = del.closest('tr');
        if (tr) deleteRecord(tr.dataset.id, tr);
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushPersist();
    });
    window.addEventListener('pagehide', flushPersist);
}

let _booted = false;
async function init() {
    if (!_booted) { bindUI(); _booted = true; }
    await loadTeam();
    populateFilters();
    await load();
    renderTable();
    applyFilter();
}

if (getStoreCode() && getStoreCode() !== '__ADMIN__') {
    init();
}
window.addEventListener('storeReady', init);
