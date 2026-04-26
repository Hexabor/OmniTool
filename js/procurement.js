// === Procurement module ===
// Stock incidents that the store sends to the procurement department —
// mostly purchase requests for missing accessories or store material.
// State machine: Pedido → Autorizado → Llegando → Recibido → Cerrado.
// Side branch: Cancelado (also covers "rechazado" — the cancel note carries
// the reason, and we treat both as the same terminal state for now).

const MODULE = 'procurement';
const STALE_DAYS = 7;
const LAYOUT_KEY = 'procurement_layout';
const LAYOUT_HEIGHT_KEY = 'procurement_layout_height';
const MIN_BOTTOM_H = 200;
const MAX_BOTTOM_RATIO = 0.9;

const LAYOUT_ICONS = {
    side: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="15" x2="21" y2="15"/></svg>`,
    bottom: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/></svg>`,
};

const STATUS_LABEL = {
    pedido: 'Pedido',
    autorizado: 'Autorizado OPS',
    llegando: 'Llegando',
    recibido: 'Recibido',
    cerrado: 'Cerrado',
    cancelado: 'Cancelado',
};

// Forward transitions only; cancel is special-cased.
const FORWARD = {
    pedido: { to: 'autorizado', label: 'Autorizado OPS' },
    autorizado: { to: 'llegando', label: 'Marcar en camino' },
    llegando: { to: 'recibido', label: 'Recibir' },
    recibido: { to: 'cerrado', label: 'Cerrar' },
};
const TERMINAL = ['cerrado', 'cancelado'];

let _state = {
    items: [],
    staff: [],            // loaded from the checklist module's staff list
    filter: 'all',
    search: '',
    sortKey: 'requestedDate',
    sortDir: 'desc',
    editingId: null,      // form modal: null = creating, otherwise editing this id
    detailId: null,       // request currently shown in the side panel
    transition: null,     // { requestId, toStatus } when the transition modal is open
    layout: 'side',       // 'side' (right panel) or 'bottom' (docked bottom for vertical monitors)
};

let _unsubscribe = null;

// === Helpers ===
function $(id) { return document.getElementById(id); }
function uuid() { return 'pq_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
}
function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('T')[0].split('-');
    if (!y || !m || !d) return iso;
    return `${d}/${m}/${y}`;
}
function fmtDateTime(iso) {
    if (!iso) return '';
    const dt = new Date(iso);
    if (isNaN(dt)) return iso;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
// === Flatpickr config: ISO storage, DD/MM/YYYY display, Monday-first locale ===
const DATE_PICKER_CFG = {
    locale: 'es',
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'd/m/Y',
    disableMobile: true,
};

function initDatePickers(root) {
    if (typeof flatpickr === 'undefined' || !root) return;
    root.querySelectorAll('input[type="date"]').forEach(el => {
        if (el._flatpickr) el._flatpickr.destroy();
        flatpickr(el, DATE_PICKER_CFG);
    });
}

function daysBetween(fromIso, toIso) {
    if (!fromIso || !toIso) return null;
    const a = new Date(fromIso + 'T00:00:00');
    const b = new Date(toIso + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
}
function isStale(it) {
    return it.status === 'pedido' && daysBetween(it.requestedDate, todayISO()) >= STALE_DAYS;
}

// === Layout: side / bottom (mirrored from warranty) ===
function getStoredBottomH() {
    const v = parseInt(localStorage.getItem(LAYOUT_HEIGHT_KEY));
    if (!isNaN(v) && v >= MIN_BOTTOM_H) return v;
    return Math.floor(window.innerHeight * 0.55);
}

function setBottomHeight(h) {
    document.documentElement.style.setProperty('--pq-bottom-h', h + 'px');
}

function applyLayout() {
    if (_state.layout === 'bottom') {
        document.body.classList.add('layout-bottom');
        setBottomHeight(getStoredBottomH());
    } else {
        document.body.classList.remove('layout-bottom');
    }
    const btn = $('pqLayoutToggle');
    if (btn) {
        // Show icon of the OPPOSITE layout (i.e. what clicking would switch to)
        btn.innerHTML = _state.layout === 'side' ? LAYOUT_ICONS.bottom : LAYOUT_ICONS.side;
        btn.title = _state.layout === 'side'
            ? 'Cambiar a panel inferior (monitor vertical)'
            : 'Cambiar a panel lateral (monitor horizontal)';
    }
}

function toggleLayout() {
    _state.layout = _state.layout === 'side' ? 'bottom' : 'side';
    localStorage.setItem(LAYOUT_KEY, _state.layout);
    applyLayout();
}

function bindResizeHandle() {
    const handle = $('pqResizeHandle');
    if (!handle) return;
    let startY = 0, startH = 0, active = false;
    const getY = (e) => e.touches ? e.touches[0].clientY : e.clientY;
    const onMove = (e) => {
        if (!active) return;
        if (e.cancelable && e.touches) e.preventDefault();
        const dy = startY - getY(e);
        const maxH = window.innerHeight * MAX_BOTTOM_RATIO;
        const h = Math.max(MIN_BOTTOM_H, Math.min(maxH, startH + dy));
        setBottomHeight(h);
    };
    const onUp = () => {
        if (!active) return;
        active = false;
        handle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        const h = $('pqDetail').offsetHeight;
        localStorage.setItem(LAYOUT_HEIGHT_KEY, String(h));
    };
    const onDown = (e) => {
        if (_state.layout !== 'bottom') return;
        active = true;
        startY = getY(e);
        startH = $('pqDetail').offsetHeight;
        handle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
    };
    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: true });
}

// === Firestore: real-time subscription ===
async function loadStaff() {
    // Procurement reuses the team list configured in the Checklist module —
    // same store staff. Read-only; if Checklist isn't configured yet we fall
    // back to an empty list (the dropdowns will warn the user).
    try {
        const data = await loadModuleData('checklist');
        return (data && Array.isArray(data.staff)) ? data.staff : [];
    } catch (e) {
        console.warn('[procurement] could not read checklist staff:', e);
        return [];
    }
}

async function load() {
    const ref = storeDocRef(MODULE);
    if (!ref) return;
    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
    return new Promise((resolve, reject) => {
        let firstSnap = true;
        _unsubscribe = ref.onSnapshot(
            { includeMetadataChanges: false },
            snap => {
                if (snap.metadata.hasPendingWrites && !firstSnap) return;
                const data = snap.exists ? snap.data() : null;
                _state.items = (data && Array.isArray(data.items)) ? data.items : [];
                if (firstSnap) { firstSnap = false; resolve(); }
                else renderAll();
            },
            err => {
                console.error('[procurement] snapshot error:', err);
                if (firstSnap) { firstSnap = false; reject(err); }
            }
        );
    });
}

async function persist() {
    const ref = storeDocRef(MODULE);
    if (!ref) return;
    await ref.set({
        items: _state.items,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
}

// === Filtering / search / sort ===
function matchesFilter(it) {
    if (_state.filter === 'all') return true;
    return it.status === _state.filter;
}
function matchesSearch(it) {
    const q = _state.search.trim().toLowerCase();
    if (!q) return true;
    const hay = [it.itemName, it.boxId, it.serialNumber, it.reason, it.requestedBy, it.vendor]
        .map(x => (x || '').toLowerCase()).join(' | ');
    return hay.includes(q);
}
function sortItems(items) {
    const { sortKey, sortDir } = _state;
    const dir = sortDir === 'asc' ? 1 : -1;
    return items.slice().sort((a, b) => {
        const av = a[sortKey] || '';
        const bv = b[sortKey] || '';
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
    });
}
function visibleItems() {
    return sortItems(_state.items.filter(it => matchesFilter(it) && matchesSearch(it)));
}

// === Counts for the filter chips ===
function statusCounts() {
    const counts = { all: _state.items.length };
    for (const k of Object.keys(STATUS_LABEL)) counts[k] = 0;
    for (const it of _state.items) counts[it.status] = (counts[it.status] || 0) + 1;
    return counts;
}

// === Rendering ===
function renderAll() {
    renderFilters();
    renderTable();
    if (_state.detailId) renderDetail();
}

function renderFilters() {
    const counts = statusCounts();
    document.querySelectorAll('#pqFilters .pq-chip').forEach(btn => {
        const f = btn.getAttribute('data-filter');
        const cnt = btn.querySelector('.pq-count');
        if (cnt) cnt.textContent = String(counts[f] || 0);
        btn.classList.toggle('active', f === _state.filter);
    });
}

function renderTable() {
    const tbody = $('pqTbody');
    const empty = $('pqEmpty');
    const items = visibleItems();
    if (items.length === 0) {
        tbody.innerHTML = '';
        empty.hidden = false;
        return;
    }
    empty.hidden = true;
    tbody.innerHTML = items.map(it => `
        <tr data-id="${it.id}" class="${isStale(it) ? 'stale' : ''} ${_state.detailId === it.id ? 'selected' : ''}">
            <td><span class="pq-status ${it.status}">${escapeHtml(STATUS_LABEL[it.status] || it.status)}</span></td>
            <td>${escapeHtml(it.itemName || '')}</td>
            <td class="${it.reason ? '' : 'muted'}">${escapeHtml((it.reason || '').slice(0, 80))}${(it.reason || '').length > 80 ? '…' : ''}</td>
            <td>${escapeHtml(it.requestedBy || '')}</td>
            <td>${fmtDate(it.requestedDate)}</td>
            <td class="${it.expectedArrivalDate ? '' : 'muted'}">${it.expectedArrivalDate ? fmtDate(it.expectedArrivalDate) : '—'}</td>
            <td class="${it.receivedDate ? '' : 'muted'}">${it.receivedDate ? fmtDate(it.receivedDate) : '—'}</td>
        </tr>
    `).join('');
    // sort indicator
    document.querySelectorAll('.pq-table thead th').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.getAttribute('data-sort') === _state.sortKey) {
            th.classList.add(_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });
}

// === Detail panel ===
function openDetail(id) {
    _state.detailId = id;
    $('pqDetailOverlay').classList.add('open');
    document.body.classList.add('detail-open');
    renderDetail();
    renderTable();  // refresh "selected" row highlight
}
function closeDetail() {
    _state.detailId = null;
    $('pqDetailOverlay').classList.remove('open');
    document.body.classList.remove('detail-open');
    renderTable();
}

function renderDetail() {
    const body = $('pqDetailContent');
    const it = _state.items.find(x => x.id === _state.detailId);
    if (!it) { body.innerHTML = '<div class="pqd-empty">Petición no encontrada.</div>'; return; }

    const fwd = FORWARD[it.status];
    const canCancel = !TERMINAL.includes(it.status);
    const canReopen = TERMINAL.includes(it.status);
    const stale = isStale(it);

    const actions = [];
    if (fwd) actions.push(`<button class="btn btn-accent" data-act="advance">${escapeHtml(fwd.label)}</button>`);
    if (canCancel) actions.push(`<button class="btn btn-danger-soft" data-act="cancel">Cancelar / Rechazar</button>`);
    if (canReopen) actions.push(`<button class="btn btn-secondary" data-act="reopen">Reabrir</button>`);
    actions.push(`<button class="btn btn-secondary" data-act="edit">Editar datos</button>`);

    const histRows = (Array.isArray(it.statusHistory) ? it.statusHistory : []).slice().reverse().map(h => `
        <div class="pqd-hist-row">
            <div class="pqd-hist-head">
                <span class="pq-status ${h.from}">${escapeHtml(STATUS_LABEL[h.from] || h.from)}</span>
                <span class="pqd-hist-arrow">→</span>
                <span class="pq-status ${h.to}">${escapeHtml(STATUS_LABEL[h.to] || h.to)}</span>
            </div>
            <div class="pqd-hist-meta">${fmtDateTime(h.at)} · ${escapeHtml(h.by || '—')}</div>
            ${h.note ? `<div class="pqd-hist-note">${escapeHtml(h.note)}</div>` : ''}
        </div>
    `).join('');

    body.innerHTML = `
        <div class="pqd-head">
            <div>
                <div class="pqd-title">${escapeHtml(it.itemName || '(sin nombre)')}</div>
                <div class="pqd-status-line">
                    <span class="pq-status ${it.status}">${escapeHtml(STATUS_LABEL[it.status] || it.status)}</span>
                    ${stale ? '<span style="color:#d97706;font-weight:600">≥ 7 días sin moverse</span>' : ''}
                </div>
            </div>
            <button class="pqd-close" id="pqdClose" aria-label="Cerrar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>

        <div class="pqd-actions">${actions.join('')}</div>

        <div class="pqd-grid">
            <div class="pqd-row full">
                <span class="lbl">Motivo</span>
                <span class="val ${it.reason ? '' : 'muted'}">${it.reason ? escapeHtml(it.reason) : '—'}</span>
            </div>
            <div class="pqd-row">
                <span class="lbl">Pedido por</span>
                <span class="val">${escapeHtml(it.requestedBy || '—')}</span>
            </div>
            <div class="pqd-row">
                <span class="lbl">Fecha pedido</span>
                <span class="val">${fmtDate(it.requestedDate) || '—'}</span>
            </div>
            <div class="pqd-row">
                <span class="lbl">BoxID</span>
                <span class="val ${it.boxId ? '' : 'muted'}">
                    ${escapeHtml(it.boxId || '—')}
                    ${it.boxId ? `<button class="pqd-copy" data-copy="${escapeHtml(it.boxId)}" title="Copiar al portapapeles" aria-label="Copiar BoxID">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>` : ''}
                </span>
            </div>
            <div class="pqd-row">
                <span class="lbl">Nº de serie</span>
                <span class="val ${it.serialNumber ? '' : 'muted'}">
                    ${escapeHtml(it.serialNumber || '—')}
                    ${it.serialNumber ? `<button class="pqd-copy" data-copy="${escapeHtml(it.serialNumber)}" title="Copiar al portapapeles" aria-label="Copiar nº de serie">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>` : ''}
                </span>
            </div>
            <div class="pqd-row">
                <span class="lbl">Proveedor</span>
                <span class="val ${it.vendor ? '' : 'muted'}">${escapeHtml(it.vendor || '—')}</span>
            </div>
            <div class="pqd-row">
                <span class="lbl">Llegada prevista</span>
                <span class="val ${it.expectedArrivalDate ? '' : 'muted'}">${fmtDate(it.expectedArrivalDate) || '—'}</span>
            </div>
            <div class="pqd-row">
                <span class="lbl">Recibido</span>
                <span class="val ${it.receivedDate ? '' : 'muted'}">${it.receivedDate ? fmtDate(it.receivedDate) + (it.receivedBy ? ' · ' + escapeHtml(it.receivedBy) : '') : '—'}</span>
            </div>
            ${it.closedAt ? `
                <div class="pqd-row">
                    <span class="lbl">Cerrado</span>
                    <span class="val">${fmtDateTime(it.closedAt)}${it.closedBy ? ' · ' + escapeHtml(it.closedBy) : ''}</span>
                </div>` : ''}
        </div>

        <div class="pqd-section-title">Historial de estado</div>
        <div class="pqd-history">
            ${histRows || '<div class="pqd-empty">Sin transiciones registradas todavía.</div>'}
        </div>
    `;

    // Wire panel-local actions
    $('pqdClose').addEventListener('click', closeDetail);
    body.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
            const act = btn.getAttribute('data-act');
            if (act === 'advance' && fwd) openTransitionModal(it.id, fwd.to);
            else if (act === 'cancel') openTransitionModal(it.id, 'cancelado');
            else if (act === 'reopen') openTransitionModal(it.id, 'pedido');
            else if (act === 'edit') openFormModal(it.id);
        });
    });
    body.querySelectorAll('.pqd-copy').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const text = btn.getAttribute('data-copy');
            if (!text) return;
            try {
                await navigator.clipboard.writeText(text);
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 1200);
            } catch (err) {
                console.error('clipboard write failed:', err);
            }
        });
    });
}

// === Form modal (create / edit base fields) ===
function populateStaffDropdowns() {
    const opts = '<option value="">— Seleccionar —</option>' +
        _state.staff.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    const fields = ['pqRequestedBy', 'pqTransitionBy'];
    fields.forEach(id => {
        const el = $(id);
        if (el) el.innerHTML = opts;
    });
}

function openFormModal(editingId) {
    _state.editingId = editingId || null;
    const form = $('pqForm');
    form.reset();
    populateStaffDropdowns();
    if (editingId) {
        const it = _state.items.find(x => x.id === editingId);
        if (!it) return;
        $('pqModalTitle').textContent = 'Editar petición';
        form.itemName.value = it.itemName || '';
        form.reason.value = it.reason || '';
        form.requestedBy.value = it.requestedBy || '';
        form.requestedDate.value = it.requestedDate || todayISO();
        form.boxId.value = it.boxId || '';
        form.serialNumber.value = it.serialNumber || '';
        form.vendor.value = it.vendor || '';
    } else {
        $('pqModalTitle').textContent = 'Nueva petición';
        form.requestedDate.value = todayISO();
    }
    initDatePickers(form);
    $('pqModalOverlay').classList.add('open');
    setTimeout(() => form.itemName.focus(), 60);
}
function closeFormModal() {
    _state.editingId = null;
    $('pqModalOverlay').classList.remove('open');
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const form = $('pqForm');
    const itemName = form.itemName.value.trim();
    const reason = form.reason.value.trim();
    const requestedBy = form.requestedBy.value.trim();
    const requestedDate = form.requestedDate.value;
    if (!itemName || !reason || !requestedBy || !requestedDate) return;
    const fields = {
        itemName,
        reason,
        requestedBy,
        requestedDate,
        boxId: form.boxId.value.trim(),
        serialNumber: form.serialNumber.value.trim(),
        vendor: form.vendor.value.trim(),
    };
    if (_state.editingId) {
        const it = _state.items.find(x => x.id === _state.editingId);
        if (it) Object.assign(it, fields);
    } else {
        const newItem = {
            id: uuid(),
            status: 'pedido',
            ...fields,
            statusHistory: [{
                at: new Date().toISOString(),
                by: requestedBy,
                from: '',
                to: 'pedido',
                note: 'Petición creada',
            }],
        };
        _state.items.push(newItem);
    }
    closeFormModal();
    renderAll();
    await persist();
}

// === Transition modal ===
function openTransitionModal(requestId, toStatus) {
    const it = _state.items.find(x => x.id === requestId);
    if (!it) return;
    _state.transition = { requestId, toStatus };
    populateStaffDropdowns();
    $('pqTransitionTitle').textContent = `${STATUS_LABEL[it.status] || it.status} → ${STATUS_LABEL[toStatus] || toStatus}`;
    const fields = $('pqTransitionFields');
    // Dynamic fields per target state
    let extra = '';
    if (toStatus === 'llegando') {
        extra = `<label class="pq-field"><span>Llegada prevista *</span><input type="date" name="expectedArrivalDate" required></label>`;
    } else if (toStatus === 'recibido') {
        extra = `<label class="pq-field"><span>Fecha de recepción *</span><input type="date" name="receivedDate" required value="${todayISO()}"></label>`;
    }
    fields.innerHTML = extra;
    $('pqTransitionForm').reset();
    if (toStatus === 'recibido') {
        const r = $('pqTransitionForm').querySelector('[name="receivedDate"]');
        if (r) r.value = todayISO();
    }
    populateStaffDropdowns();  // re-set after reset
    initDatePickers($('pqTransitionForm'));
    $('pqTransitionOverlay').classList.add('open');
    setTimeout(() => $('pqTransitionBy').focus(), 60);
}
function closeTransitionModal() {
    _state.transition = null;
    $('pqTransitionOverlay').classList.remove('open');
}

async function handleTransitionSubmit(e) {
    e.preventDefault();
    if (!_state.transition) return;
    const { requestId, toStatus } = _state.transition;
    const it = _state.items.find(x => x.id === requestId);
    if (!it) { closeTransitionModal(); return; }
    const form = $('pqTransitionForm');
    const by = form.by.value.trim();
    const note = form.note.value.trim();
    if (!by) return;

    const fromStatus = it.status;
    const now = new Date().toISOString();

    // Apply per-target side-effects
    if (toStatus === 'llegando') {
        const dateInput = form.querySelector('[name="expectedArrivalDate"]');
        if (!dateInput || !dateInput.value) return;
        it.expectedArrivalDate = dateInput.value;
    } else if (toStatus === 'recibido') {
        const dateInput = form.querySelector('[name="receivedDate"]');
        if (!dateInput || !dateInput.value) return;
        it.receivedDate = dateInput.value;
        it.receivedBy = by;
    } else if (toStatus === 'cerrado') {
        it.closedAt = now;
        it.closedBy = by;
    }

    it.status = toStatus;
    if (!Array.isArray(it.statusHistory)) it.statusHistory = [];
    it.statusHistory.push({
        at: now,
        by,
        from: fromStatus,
        to: toStatus,
        note: note || '',
    });

    closeTransitionModal();
    renderAll();
    await persist();
}

// === Wiring ===
function bindUI() {
    // Filter chips
    document.querySelectorAll('#pqFilters .pq-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            _state.filter = btn.getAttribute('data-filter');
            renderAll();
        });
    });

    // Search (no debounce — small datasets, fine to render on each keystroke)
    $('pqSearch').addEventListener('input', (e) => {
        _state.search = e.target.value || '';
        renderTable();
    });

    // Sort headers
    document.querySelectorAll('.pq-table thead th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-sort');
            if (_state.sortKey === key) {
                _state.sortDir = _state.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                _state.sortKey = key;
                _state.sortDir = 'asc';
            }
            renderTable();
        });
    });

    // Row click → detail
    $('pqTbody').addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        openDetail(tr.getAttribute('data-id'));
    });

    // Layout toggle (side ↔ bottom)
    $('pqLayoutToggle').addEventListener('click', toggleLayout);
    bindResizeHandle();

    // New request
    $('btnNewRequest').addEventListener('click', () => openFormModal(null));
    $('pqModalClose').addEventListener('click', closeFormModal);
    $('pqFormCancel').addEventListener('click', closeFormModal);
    $('pqForm').addEventListener('submit', handleFormSubmit);

    // Transition modal
    $('pqTransitionClose').addEventListener('click', closeTransitionModal);
    $('pqTransitionCancel').addEventListener('click', closeTransitionModal);
    $('pqTransitionForm').addEventListener('submit', handleTransitionSubmit);

    // ESC closes whatever modal is open (form, transition, detail)
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if ($('pqTransitionOverlay').classList.contains('open')) closeTransitionModal();
        else if ($('pqModalOverlay').classList.contains('open')) closeFormModal();
        else if ($('pqDetailOverlay').classList.contains('open')) closeDetail();
    });
}

async function init() {
    _state.layout = localStorage.getItem(LAYOUT_KEY) === 'bottom' ? 'bottom' : 'side';
    bindUI();
    applyLayout();
    _state.staff = await loadStaff();
    populateStaffDropdowns();
    await load();
    renderAll();
}

if (getStoreCode()) init();
window.addEventListener('storeReady', init);
