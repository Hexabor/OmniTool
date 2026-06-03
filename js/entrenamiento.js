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
        <td class="tr-comp"><input type="text" class="f-comp" value="${escapeHtml(rec.competency || '')}" placeholder="Competencia entrenada"></td>
        <td class="tr-trainer">${personSelect(rec.trainer || '', 'f-trainer')}</td>
        <td class="tr-status"><select class="f-status" data-status="${escapeHtml(rec.status || '')}">${statusOptions(rec.status || '')}</select></td>
        <td class="tr-notes"><textarea class="f-notes" rows="2" placeholder="Notas…">${escapeHtml(rec.notes || '')}</textarea></td>
        <td class="tr-del"><button type="button" class="tr-del-btn" title="Eliminar registro" aria-label="Eliminar">×</button></td>
    </tr>`;
}

function renderTable() {
    const body = tbodyEl();
    if (!body) return;
    body.innerHTML = _state.records.map(rowHTML).join('');
    initDatePickers(body);
    updateEmptyState();
    updateTeamBanner();
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
    applyFilter();
    persist();
}

function addRecord() {
    // Limpia filtros para que el registro nuevo siempre se vea
    $('trSearch').value = '';
    $('trFilterStaff').value = '';
    $('trFilterStatus').value = '';

    const rec = { id: uuid(), date: todayISO(), staff: '', competency: '', trainer: '', status: '', notes: '' };
    _state.records.unshift(rec);

    const body = tbodyEl();
    const temp = document.createElement('tbody');
    temp.innerHTML = rowHTML(rec);
    const tr = temp.firstElementChild;
    body.prepend(tr);
    initDatePickers(tr);
    updateEmptyState();
    applyFilter();

    const comp = tr.querySelector('.f-comp');
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
    const fStaff = $('trFilterStaff').value || '';
    const fStatus = $('trFilterStatus').value || '';
    let visible = 0;

    tbodyEl().querySelectorAll('tr').forEach(tr => {
        const rec = _state.records.find(r => r.id === tr.dataset.id);
        if (!rec) return;
        let show = true;
        if (fStaff && rec.staff !== fStaff) show = false;
        if (show && fStatus && rec.status !== fStatus) show = false;
        if (show && q) {
            const hay = `${rec.competency} ${rec.notes} ${rec.staff} ${rec.trainer}`.toLowerCase();
            if (!hay.includes(q)) show = false;
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
    const prev = staffSel.value;
    staffSel.innerHTML = '<option value="">Todo el staff</option>' +
        _state.staff.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    staffSel.value = _state.staff.includes(prev) ? prev : '';

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
    $('trFilterStaff').addEventListener('change', applyFilter);
    $('trFilterStatus').addEventListener('change', applyFilter);

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
