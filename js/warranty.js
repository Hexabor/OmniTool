// === Warranty module ===
const MODULE = 'warranty';
const STALE_DAYS = 7;
const LAYOUT_KEY = 'warranty_layout';
const LAYOUT_HEIGHT_KEY = 'warranty_layout_height';
const MIN_BOTTOM_H = 180;
const MAX_BOTTOM_RATIO = 0.9;

let _state = {
    items: [],
    filter: 'all',
    search: '',
    sortKey: 'requestDate',
    sortDir: 'desc',
    selectedId: null,
    editMode: null,
    editBaseline: null,
    layout: 'side',
};

const els = {};

function $(id) { return document.getElementById(id); }

function uuid() {
    return 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function todayISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
}

function nowLocalISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 16);
}

function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const datePart = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timePart = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${datePart} ${timePart}`;
}

// === Flatpickr (Spanish locale → Monday-first calendar, 24h clock, DD/MM/YYYY display) ===
const DATE_PICKER_CFG = {
    locale: 'es',
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'd/m/Y',
    disableMobile: true,
};

const DATETIME_PICKER_CFG = {
    locale: 'es',
    enableTime: true,
    time_24hr: true,
    dateFormat: 'Y-m-d\\TH:i',
    altInput: true,
    altFormat: 'd/m/Y H:i',
    disableMobile: true,
};

function initDatePickers(root) {
    if (typeof flatpickr === 'undefined') return;
    const scope = root || document;
    scope.querySelectorAll('input[type="date"]').forEach(el => flatpickr(el, DATE_PICKER_CFG));
    scope.querySelectorAll('input[type="datetime-local"]').forEach(el => flatpickr(el, DATETIME_PICKER_CFG));
}

function destroyFlatpickrs(root) {
    if (!root) return;
    root.querySelectorAll('input').forEach(el => {
        if (el._flatpickr) el._flatpickr.destroy();
    });
}

function daysSince(iso) {
    if (!iso) return 0;
    const d = new Date(iso);
    if (isNaN(d)) return 0;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Follow the retry chain forward to the leaf (most recent attempt).
// Only fallido items can spawn a retry (via retryOfId), so non-fallido items
// are always leaves. Returns the leaf item.
function getChainLeaf(item) {
    let current = item;
    const seen = new Set([current.id]);
    while (true) {
        const child = _state.items.find(x => x.retryOfId === current.id);
        if (!child || seen.has(child.id)) return current;
        seen.add(child.id);
        current = child;
    }
}

// A case is "resolved" when its chain leaf is cerrado. This means both the
// cerrado item and any fallido ancestors belong to the resolved bucket.
function isResolved(item) {
    return getChainLeaf(item).status === 'cerrado';
}

function statusLabel(s) {
    return ({
        pedido: 'Pedido',
        recibido: 'Recibido',
        entregado: 'Entregado',
        cerrado: 'Cerrado',
        fallido: 'Fallido',
    })[s] || s;
}

function processingTypeLabel(t) {
    return ({
        RMA_EXT: 'RMA — Garantía externa',
        RMA_INT: 'RMA — Garantía interna',
        RTO: 'RTO',
        RMA: 'RMA',
    })[t] || '';
}

async function copyToClipboard(btn) {
    const value = btn.getAttribute('data-copy');
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 900);
    } catch (e) {
        console.warn('Clipboard error:', e);
    }
}

// === Firestore ===
async function load(opts) {
    const data = await loadModuleData(MODULE, opts);
    _state.items = (data && Array.isArray(data.items)) ? data.items : [];
}

async function persist() {
    await saveModuleData(MODULE, { items: _state.items });
}

// === Conflict detection on save ===
// Snapshot an item's updatedAt at the moment the user enters edit mode.
// When they save, we refetch from server and compare — if it has changed,
// someone else edited this warranty and we ask the user how to resolve.
function captureEditBaseline() {
    const it = getItem(_state.selectedId);
    _state.editBaseline = it && it.updatedAt ? it.updatedAt : null;
}

function beginEdit(mode) {
    captureEditBaseline();
    _state.editMode = mode;
    renderDetail();
}

function exitEdit() {
    _state.editMode = null;
    _state.editBaseline = null;
}

// Fetch server copy, detect conflict vs baseline, apply user's mutations, persist.
// Returns true if the save went through, false if aborted (deleted / user cancelled).
async function saveGuarded(mutate) {
    const id = _state.selectedId;
    if (!id) return false;

    let fresh;
    try {
        fresh = await loadModuleData(MODULE, { source: 'server' });
    } catch (e) {
        console.error('[warranty] conflict-check fetch error:', e);
        alert('Error de conexión. Intenta de nuevo.');
        return false;
    }
    const freshItems = (fresh && Array.isArray(fresh.items)) ? fresh.items : [];
    const freshItem = freshItems.find(x => x.id === id);

    if (!freshItem) {
        alert('Esta garantía fue borrada desde otro dispositivo.');
        _state.items = freshItems;
        exitEdit();
        closeDetail();
        renderTable();
        return false;
    }

    const baseline = _state.editBaseline;
    if (freshItem.updatedAt && freshItem.updatedAt !== baseline) {
        const when = fmtDateTime(freshItem.updatedAt);
        const ok = confirm(
            `Alguien modificó esta garantía el ${when}.\n\n` +
            `Aceptar  →  sobrescribir con tus cambios\n` +
            `Cancelar →  recargar y descartar tus cambios`
        );
        if (!ok) {
            _state.items = freshItems;
            exitEdit();
            renderTable();
            renderDetail();
            return false;
        }
    }

    // Replace local item with the fresh server version, then apply the user's
    // mutations on top. This keeps fields the user didn't touch up-to-date.
    const idx = _state.items.findIndex(x => x.id === id);
    if (idx < 0) {
        _state.items = freshItems;
        renderTable();
        return false;
    }
    _state.items[idx] = { ...freshItem };
    const target = _state.items[idx];

    try {
        mutate(target);
    } catch (e) {
        console.error('[warranty] mutation error:', e);
        return false;
    }

    target.updatedAt = new Date().toISOString();
    await persist();
    exitEdit();
    renderTable();
    renderDetail();
    return true;
}

function touchUpdated(it) {
    if (it) it.updatedAt = new Date().toISOString();
}

// Pull fresh data from Firestore and re-render.
// Guard: if the user is in the middle of editing a card (mini-form open),
// we refresh the table and items state but DON'T re-render the detail panel,
// so pending form values stay on screen. On save, getItem(id) finds the
// refreshed item and Object.assign mutates only the fields the form touched.
let _refreshing = false;
async function refresh() {
    if (_refreshing) return;
    _refreshing = true;
    const btn = $('btnRefresh');
    if (btn) btn.classList.add('refreshing');
    const t0 = Date.now();
    try {
        // Force server-side fetch — otherwise Firestore may serve from its local cache
        await load({ source: 'server' });
        console.log(`[warranty] refresh OK · ${_state.items.length} items · ${Date.now() - t0}ms`);
        renderTable();
        if (_state.selectedId) {
            if (!getItem(_state.selectedId)) {
                closeDetail();
            } else if (!_state.editMode) {
                renderDetail();
            }
        }
    } catch (e) {
        console.error('[warranty] refresh error:', e);
    } finally {
        _refreshing = false;
        if (btn) btn.classList.remove('refreshing');
    }
}

// === Render ===
function applyFilters() {
    const q = _state.search.trim().toLowerCase();
    let items = _state.items.slice();
    const f = _state.filter;
    if (f === 'all') {
        // Todos = activos (cadenas no resueltas — leaf no es cerrado)
        items = items.filter(it => !isResolved(it));
    } else if (f === 'cerrado') {
        // Cerrado = cadenas resueltas (el cerrado + sus fallidos antecesores)
        items = items.filter(it => isResolved(it));
    } else if (f === 'fallido') {
        // Sólo fallidos activos — si el chain ya acabó en cerrado, van a "Cerrado"
        items = items.filter(it => it.status === 'fallido' && !isResolved(it));
    } else {
        items = items.filter(it => it.status === f);
    }
    if (q) {
        items = items.filter(it =>
            (it.umid || '').toLowerCase().includes(q) ||
            (it.boxId || '').toLowerCase().includes(q) ||
            (it.boxName || '').toLowerCase().includes(q) ||
            (it.testOrder || '').toLowerCase().includes(q)
        );
    }
    const k = _state.sortKey;
    const dir = _state.sortDir === 'asc' ? 1 : -1;
    items.sort((a, b) => {
        const va = a[k] || '';
        const vb = b[k] || '';
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
    });
    return items;
}

function updateCounts() {
    const counts = { all: 0, pedido: 0, recibido: 0, entregado: 0, cerrado: 0, fallido: 0 };
    _state.items.forEach(it => {
        if (isResolved(it)) {
            counts.cerrado++;
        } else {
            counts.all++;
            counts[it.status] = (counts[it.status] || 0) + 1;
        }
    });
    document.querySelectorAll('.wf-count').forEach(el => {
        const k = el.getAttribute('data-count');
        el.textContent = counts[k] ?? 0;
    });
}

function renderTable() {
    updateCounts();
    const tbody = $('warrantyTbody');
    const items = applyFilters();
    const empty = $('warrantyEmpty');
    const table = $('warrantyTable');
    if (_state.items.length === 0) {
        empty.hidden = false;
        table.style.display = 'none';
        tbody.innerHTML = '';
        return;
    }
    empty.hidden = true;
    table.style.display = '';

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:1.5rem;color:var(--color-text-lighter)">Sin resultados con estos filtros.</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(it => {
        const stale = it.status === 'pedido' && daysSince(it.requestDate) >= STALE_DAYS;
        const incomplete = !it.umid || !it.boxId;
        return `
        <tr class="${stale ? 'stale' : ''}" data-id="${it.id}">
            <td><span class="status-badge status-${it.status}">${statusLabel(it.status)}</span></td>
            <td class="col-copy">${copyCell(it.umid, 'UMID', incomplete)}</td>
            <td>${escapeHtml(it.boxName || '')}</td>
            <td class="col-copy">${copyCell(it.boxId, 'Box ID', incomplete)}</td>
            <td>${it.testOrder ? escapeHtml(it.testOrder) : '<span class="muted">—</span>'}</td>
            <td>${escapeHtml(it.sourceStore || '')}</td>
            <td>${fmtDate(it.requestDate) || '<span class="muted">—</span>'}</td>
            <td>${escapeHtml(it.requestedBy || '')}</td>
            <td>${fmtDate(it.receivedDate) || '<span class="muted">—</span>'}</td>
            <td>${fmtDate(it.deliveredDate) || '<span class="muted">—</span>'}</td>
            <td class="col-icon ${it.comments ? 'has-icon' : ''}" title="${it.comments ? 'Tiene comentarios' : ''}">${it.comments ? ICON_COMMENT : ''}</td>
            <td class="col-icon ${(it.calls && it.calls.length) ? 'has-icon' : ''}" title="${(it.calls && it.calls.length) ? it.calls.length + ' llamada(s)' : ''}">${(it.calls && it.calls.length) ? ICON_PHONE : ''}</td>
        </tr>`;
    }).join('');
}

const ICON_COMMENT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const ICON_PHONE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;

function copyCell(value, label, incomplete) {
    if (!value) {
        return `<span class="copy-missing${incomplete ? ' copy-missing--warn' : ''}" title="${label} sin rellenar">—</span>`;
    }
    const v = escapeHtml(value);
    return `<button class="copy-btn${incomplete ? ' copy-btn--warn' : ''}" data-copy="${v}" title="Copiar ${label}: ${v}" aria-label="Copiar ${label}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
    </button>`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// === Modal: new / edit ===
function openModal(prefill) {
    const form = $('warrantyForm');
    destroyFlatpickrs(form);
    form.reset();
    $('warrantyModalTitle').textContent = prefill && prefill.id ? 'Editar garantía' : 'Nueva garantía';
    form.dataset.editId = prefill && prefill.id ? prefill.id : '';
    form.dataset.retryOf = prefill && prefill.retryOfId ? prefill.retryOfId : '';

    // Populate source store dropdown
    const sel = $('wfSourceStore');
    sel.innerHTML = '<option value="">— Seleccionar —</option>' +
        STORES.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

    if (prefill) {
        form.umid.value = prefill.umid || '';
        form.sourceStore.value = prefill.sourceStore || '';
        form.boxId.value = prefill.boxId || '';
        form.boxName.value = prefill.boxName || '';
        form.requestDate.value = prefill.requestDate || todayISO();
        form.requestedBy.value = prefill.requestedBy || '';
        form.inStore.checked = !!prefill.inStore;
        form.testOrder.value = prefill.testOrder || '';
        form.comments.value = prefill.comments || '';
    } else {
        form.requestDate.value = todayISO();
    }
    toggleTestOrderField();
    $('warrantyModalOverlay').classList.add('open');
    initDatePickers(form);
    setTimeout(() => form.umid.focus(), 50);
}

function closeModal() {
    $('warrantyModalOverlay').classList.remove('open');
}

function toggleTestOrderField() {
    const wrap = $('wfTestOrderWrap');
    wrap.hidden = !$('wfInStore').checked;
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const form = $('warrantyForm');
    const editId = form.dataset.editId;
    const retryOf = form.dataset.retryOf;
    const inStore = form.inStore.checked;
    const data = {
        umid: form.umid.value.trim(),
        sourceStore: form.sourceStore.value,
        boxId: form.boxId.value.trim(),
        boxName: form.boxName.value.trim(),
        requestDate: form.requestDate.value,
        requestedBy: form.requestedBy.value.trim(),
        inStore: inStore,
        testOrder: inStore ? form.testOrder.value.trim() : '',
        comments: form.comments.value.trim(),
    };

    const now = new Date().toISOString();
    if (editId) {
        const idx = _state.items.findIndex(it => it.id === editId);
        if (idx >= 0) _state.items[idx] = { ..._state.items[idx], ...data, updatedAt: now };
    } else {
        const item = {
            id: uuid(),
            status: 'pedido',
            createdAt: now,
            updatedAt: now,
            calls: [],
            ...data,
        };
        if (retryOf) item.retryOfId = retryOf;
        _state.items.push(item);
        _state.selectedId = item.id;
    }

    await persist();
    closeModal();
    renderTable();
    if (_state.selectedId) renderDetail();
}

// === Detail panel ===
function openDetail(id) {
    _state.selectedId = id;
    exitEdit();
    renderDetail();
    $('warrantyDetailOverlay').classList.add('open');
    document.body.classList.add('detail-open');
    // Background refresh so what you see is fresh from Firestore
    refresh();
}

function closeDetail() {
    _state.selectedId = null;
    exitEdit();
    $('warrantyDetailOverlay').classList.remove('open');
    document.body.classList.remove('detail-open');
}

// === Layout (side / bottom) ===
const LAYOUT_ICONS = {
    side: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="15" x2="21" y2="15"/></svg>`,
    bottom: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/></svg>`,
};

function getStoredBottomH() {
    const v = parseInt(localStorage.getItem(LAYOUT_HEIGHT_KEY));
    if (!isNaN(v) && v >= MIN_BOTTOM_H) return v;
    return Math.floor(window.innerHeight * 0.55);
}

function setBottomHeight(h) {
    document.documentElement.style.setProperty('--wd-bottom-h', h + 'px');
}

function applyLayout() {
    if (_state.layout === 'bottom') {
        document.body.classList.add('layout-bottom');
        setBottomHeight(getStoredBottomH());
    } else {
        document.body.classList.remove('layout-bottom');
    }
    const btn = $('layoutToggle');
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
    const handle = $('wdResizeHandle');
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
        const h = $('warrantyDetail').offsetHeight;
        localStorage.setItem(LAYOUT_HEIGHT_KEY, String(h));
    };

    const onDown = (e) => {
        if (_state.layout !== 'bottom') return;
        active = true;
        startY = getY(e);
        startH = $('warrantyDetail').offsetHeight;
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

function getItem(id) {
    return _state.items.find(it => it.id === id);
}

function renderDetail() {
    const id = _state.selectedId;
    const it = getItem(id);
    const wd = $('wdContent');
    destroyFlatpickrs(wd);
    if (!it) { wd.innerHTML = ''; return; }

    const actions = renderActions(it);
    const retryChain = renderRetryChain(it);

    wd.innerHTML = `
        <div class="wd-header">
            <div class="wd-header-left">
                <span class="status-badge status-${it.status}">${statusLabel(it.status)}</span>
                <span class="wd-title">${escapeHtml(it.boxName || '(sin nombre)')}</span>
            </div>
            <button class="wd-close" id="wdClose">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>
        <div class="wd-body">
            ${actions ? `<div class="wd-actions">${actions}</div>` : ''}
            ${retryChain}
            ${renderRequestSection(it)}
            ${renderReceptionSection(it)}
            ${renderCallsSection(it)}
            ${renderDeliverySection(it)}
            ${renderDefectiveSection(it)}
            ${it.status === 'fallido' ? renderFailureSection(it) : ''}
            ${renderCommentsSection(it)}
            <div class="wd-footer">
                <span class="wd-meta">Creado ${fmtDateTime(it.createdAt)}</span>
                <button class="btn-link-danger" id="wdDelete">Eliminar garantía</button>
            </div>
        </div>
    `;

    // Bind events
    $('wdClose').addEventListener('click', closeDetail);
    $('wdDelete').addEventListener('click', () => deleteItem(it.id));
    bindDetailEvents(it);
    initDatePickers(wd);

    // When entering edit mode, scroll the editing card to the top of the panel
    if (_state.editMode) {
        const editingSection = wd.querySelector('.wd-mini-form')?.closest('.wd-section');
        if (editingSection) {
            requestAnimationFrame(() => {
                editingSection.scrollIntoView({ block: 'start', behavior: 'smooth' });
            });
        }
    } else {
        wd.scrollTop = 0;
    }
}

function renderActions(it) {
    const a = [];
    if (it.status === 'pedido') {
        a.push(`<button class="btn btn-accent btn-sm" data-action="mark-received">Marcar recibido</button>`);
        a.push(`<button class="btn btn-secondary btn-sm" data-action="mark-failed">Marcar fallido</button>`);
    } else if (it.status === 'recibido') {
        a.push(`<button class="btn btn-accent btn-sm" data-action="mark-delivered">Marcar entregado</button>`);
    } else if (it.status === 'entregado') {
        a.push(`<button class="btn btn-accent btn-sm" data-action="close-case">Cerrar caso</button>`);
    } else if (it.status === 'fallido') {
        a.push(`<button class="btn btn-accent btn-sm" data-action="retry">Generar nuevo intento</button>`);
    }
    return a.join('');
}

function renderRetryChain(it) {
    if (!it.retryOfId) return '';
    const orig = getItem(it.retryOfId);
    if (!orig) return '';
    return `<div class="wd-section" style="background:#fffbeb;border-color:#fde68a">
        <h4 style="margin-bottom:0.3rem">Reintento de garantía anterior</h4>
        <button class="wd-retry-link" data-action="open-retry-of">Ver intento original (${escapeHtml(orig.sourceStore || '?')}, ${fmtDate(orig.requestDate)})</button>
    </div>`;
}

function renderRequestSection(it) {
    const editing = _state.editMode === 'request';
    if (editing) {
        return `<div class="wd-section">
            <h4>Pedido <button class="wd-section-edit" data-edit-cancel="request">Cancelar</button></h4>
            <div class="wd-mini-form">
                <label class="full">UMID <input type="text" data-edit="umid" value="${escapeHtml(it.umid || '')}"></label>
                <label class="full">Tienda origen
                    <select data-edit="sourceStore">
                        ${STORES.map(s => `<option value="${escapeHtml(s)}" ${s === it.sourceStore ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
                    </select>
                </label>
                <label>Box ID <input type="text" data-edit="boxId" value="${escapeHtml(it.boxId || '')}"></label>
                <label>Box Name <input type="text" data-edit="boxName" value="${escapeHtml(it.boxName || '')}"></label>
                <label>Fecha pedido <input type="date" data-edit="requestDate" value="${it.requestDate || ''}"></label>
                <label>Pedido por <input type="text" data-edit="requestedBy" value="${escapeHtml(it.requestedBy || '')}"></label>
                <div class="wd-mini-actions">
                    <button class="btn btn-accent btn-sm" data-action="save-request">Guardar</button>
                </div>
            </div>
        </div>`;
    }
    return `<div class="wd-section">
        <h4>Pedido <button class="wd-section-edit" data-edit="request">Editar</button></h4>
        <div class="wd-grid">
            <div class="wd-row"><span class="lbl">UMID</span><span class="val">${escapeHtml(it.umid || '—')}</span></div>
            <div class="wd-row"><span class="lbl">Tienda origen</span><span class="val">${escapeHtml(it.sourceStore || '—')}</span></div>
            <div class="wd-row"><span class="lbl">Box ID</span><span class="val">${escapeHtml(it.boxId || '—')}</span></div>
            <div class="wd-row"><span class="lbl">Box Name</span><span class="val">${escapeHtml(it.boxName || '—')}</span></div>
            <div class="wd-row"><span class="lbl">Fecha pedido</span><span class="val">${fmtDate(it.requestDate) || '—'}</span></div>
            <div class="wd-row"><span class="lbl">Pedido por</span><span class="val">${escapeHtml(it.requestedBy || '—')}</span></div>
        </div>
    </div>`;
}

function renderReceptionSection(it) {
    if (it.status === 'pedido') {
        if (_state.editMode === 'receive') {
            return `<div class="wd-section">
                <h4>Recepción <button class="wd-section-edit" data-edit-cancel="receive">Cancelar</button></h4>
                <div class="wd-mini-form">
                    <label>Fecha recepción <input type="date" data-edit="receivedDate" value="${todayISO()}"></label>
                    <label>Recibido por <input type="text" data-edit="receivedBy" value="" placeholder="Nombre"></label>
                    <div class="wd-mini-actions">
                        <button class="btn btn-accent btn-sm" data-action="save-received">Guardar recepción</button>
                    </div>
                </div>
            </div>`;
        }
        return '';
    }
    const editing = _state.editMode === 'reception';
    if (editing) {
        return `<div class="wd-section">
            <h4>Recepción <button class="wd-section-edit" data-edit-cancel="reception">Cancelar</button></h4>
            <div class="wd-mini-form">
                <label>Fecha recepción <input type="date" data-edit="receivedDate" value="${it.receivedDate || ''}"></label>
                <label>Recibido por <input type="text" data-edit="receivedBy" value="${escapeHtml(it.receivedBy || '')}"></label>
                <div class="wd-mini-actions">
                    <button class="btn btn-accent btn-sm" data-action="save-reception">Guardar</button>
                </div>
            </div>
        </div>`;
    }
    return `<div class="wd-section">
        <h4>Recepción <button class="wd-section-edit" data-edit="reception">Editar</button></h4>
        <div class="wd-grid">
            <div class="wd-row"><span class="lbl">Fecha</span><span class="val">${fmtDate(it.receivedDate) || '—'}</span></div>
            <div class="wd-row"><span class="lbl">Recibido por</span><span class="val">${escapeHtml(it.receivedBy || '—')}</span></div>
        </div>
    </div>`;
}

function renderCallsSection(it) {
    const calls = (it.calls || []).slice().sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''));
    return `<div class="wd-section">
        <h4>Llamadas al cliente <span style="color:var(--color-text-lighter);font-weight:500">${calls.length}</span></h4>
        ${calls.length === 0 ? '<p class="wd-empty-line">Sin llamadas registradas.</p>' : `
        <ul class="wd-calls">
            ${calls.map((c, i) => `
                <li class="wd-call" data-call-i="${i}">
                    <span class="wd-call-time">
                        <input type="datetime-local" data-call-time="${i}" value="${(c.datetime || '').slice(0,16)}">
                    </span>
                    <button class="wd-call-success ${c.success ? 'yes' : 'no'}" data-call-toggle="${i}">${c.success ? 'Sí contactó' : 'No contactó'}</button>
                    <button class="wd-call-del" data-call-del="${i}" title="Eliminar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </li>`).join('')}
        </ul>`}
        <button class="wd-call-add" data-action="add-call">+ Añadir llamada</button>
    </div>`;
}

function renderDeliverySection(it) {
    if (it.status === 'pedido' || it.status === 'fallido') return '';
    if (it.status === 'recibido' && _state.editMode === 'deliver') {
        return `<div class="wd-section">
            <h4>Entrega <button class="wd-section-edit" data-edit-cancel="deliver">Cancelar</button></h4>
            <div class="wd-mini-form">
                <label>Fecha entrega <input type="date" data-edit="deliveredDate" value="${todayISO()}"></label>
                <label>Entregado por <input type="text" data-edit="deliveredBy" value="" placeholder="Nombre"></label>
                <div class="wd-mini-actions">
                    <button class="btn btn-accent btn-sm" data-action="save-delivered">Guardar entrega</button>
                </div>
            </div>
        </div>`;
    }
    if (it.status === 'recibido') return '';
    const editing = _state.editMode === 'delivery';
    if (editing) {
        return `<div class="wd-section">
            <h4>Entrega <button class="wd-section-edit" data-edit-cancel="delivery">Cancelar</button></h4>
            <div class="wd-mini-form">
                <label>Fecha entrega <input type="date" data-edit="deliveredDate" value="${it.deliveredDate || ''}"></label>
                <label>Entregado por <input type="text" data-edit="deliveredBy" value="${escapeHtml(it.deliveredBy || '')}"></label>
                <div class="wd-mini-actions">
                    <button class="btn btn-accent btn-sm" data-action="save-delivery">Guardar</button>
                </div>
            </div>
        </div>`;
    }
    return `<div class="wd-section">
        <h4>Entrega <button class="wd-section-edit" data-edit="delivery">Editar</button></h4>
        <div class="wd-grid">
            <div class="wd-row"><span class="lbl">Fecha</span><span class="val">${fmtDate(it.deliveredDate) || '—'}</span></div>
            <div class="wd-row"><span class="lbl">Entregado por</span><span class="val">${escapeHtml(it.deliveredBy || '—')}</span></div>
        </div>
    </div>`;
}

function renderDefectiveSection(it) {
    // Close-case mini-form (only when entregado + editMode='close')
    if (it.status === 'entregado' && _state.editMode === 'close') {
        return `<div class="wd-section">
            <h4>Cerrar caso <button class="wd-section-edit" data-edit-cancel="close">Cancelar</button></h4>
            <div class="wd-mini-form">
                <label>Fecha cierre <input type="date" data-edit="closedDate" value="${todayISO()}"></label>
                <label>Cerrado por <input type="text" data-edit="closedBy" value="" placeholder="Nombre"></label>
                <div class="wd-mini-actions">
                    <button class="btn btn-accent btn-sm" data-action="save-close">Confirmar cierre</button>
                </div>
            </div>
        </div>`;
    }

    // Edit mode for the defective fields
    if (_state.editMode === 'defective') {
        const t = it.processingType || '';
        return `<div class="wd-section">
            <h4>Defectuoso del cliente <button class="wd-section-edit" data-edit-cancel="defective">Cancelar</button></h4>
            <div class="wd-mini-form">
                <label class="full" style="flex-direction:row;align-items:center;gap:0.5rem;font-weight:500;text-transform:none;letter-spacing:0;font-size:0.82rem;color:var(--color-text);cursor:pointer">
                    <input type="checkbox" data-edit="inStore" ${it.inStore ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
                    <span>El defectuoso queda en tienda</span>
                </label>
                <label class="full">Test Order <input type="text" data-edit="testOrder" value="${escapeHtml(it.testOrder || '')}" placeholder="Solo si queda en tienda"></label>
                <label>Fecha de venta <input type="date" data-edit="saleDate" value="${it.saleDate || ''}"></label>
                <label>Tipo de procesamiento
                    <select data-edit="processingType">
                        <option value="" ${!t ? 'selected' : ''}>—</option>
                        <option value="RMA_EXT" ${t === 'RMA_EXT' ? 'selected' : ''}>RMA — Garantía externa</option>
                        <option value="RMA_INT" ${t === 'RMA_INT' ? 'selected' : ''}>RMA — Garantía interna</option>
                        <option value="RTO" ${t === 'RTO' ? 'selected' : ''}>RTO</option>
                    </select>
                </label>
                <label class="full" title="Solo para casos de RTO a franquicia">Tienda destino RTO <input type="text" data-edit="processingStore" value="${escapeHtml(it.processingStore || '')}" placeholder="Tienda o proveedor"></label>
                <label class="full">Investigado / cubierto por <input type="text" data-edit="investigatedBy" value="${escapeHtml(it.investigatedBy || '')}"></label>
                <label class="full">Descripción del defecto
                    <textarea data-edit="defectDescription" rows="3" placeholder="Detalles para agilizar el procesamiento">${escapeHtml(it.defectDescription || '')}</textarea>
                </label>
                <div class="wd-mini-actions">
                    <button class="btn btn-accent btn-sm" data-action="save-defective">Guardar</button>
                </div>
            </div>
        </div>`;
    }

    // Display mode
    const processingDisplay = it.processingType
        ? processingTypeLabel(it.processingType)
        : (it.defectiveProcessed ? processingTypeLabel(it.defectiveProcessed) : '—');

    const closingBlock = (it.status === 'cerrado')
        ? `<div class="wd-grid" style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px dashed var(--color-border)">
                <div class="wd-row"><span class="lbl">Cerrado</span><span class="val">${fmtDate(it.closedDate || it.defectiveProcessedDate) || '—'}</span></div>
                <div class="wd-row"><span class="lbl">Cerrado por</span><span class="val">${escapeHtml(it.closedBy || it.defectiveProcessedBy || '—')}</span></div>
           </div>`
        : '';

    return `<div class="wd-section">
        <h4>Defectuoso del cliente <button class="wd-section-edit" data-edit="defective">Editar</button></h4>
        <div class="wd-grid">
            <div class="wd-row"><span class="lbl">Queda en tienda</span><span class="val">${it.inStore ? 'Sí' : 'No'}</span></div>
            <div class="wd-row"><span class="lbl">Test Order</span><span class="val ${it.testOrder ? '' : 'muted'}">${escapeHtml(it.testOrder || '—')}</span></div>
            <div class="wd-row"><span class="lbl">Fecha de venta</span><span class="val ${it.saleDate ? '' : 'muted'}">${fmtDate(it.saleDate) || '—'}</span></div>
            <div class="wd-row"><span class="lbl">Tipo</span><span class="val ${it.processingType || it.defectiveProcessed ? '' : 'muted'}">${processingDisplay}</span></div>
            <div class="wd-row" title="Solo para casos de RTO a franquicia"><span class="lbl">Tienda destino RTO</span><span class="val ${it.processingStore ? '' : 'muted'}">${escapeHtml(it.processingStore || '—')}</span></div>
            <div class="wd-row"><span class="lbl">Investigado por</span><span class="val ${it.investigatedBy ? '' : 'muted'}">${escapeHtml(it.investigatedBy || '—')}</span></div>
        </div>
        <div class="wd-row" style="margin-top:0.55rem">
            <span class="lbl">Descripción del defecto</span>
            <div class="wd-comments" style="margin-top:0.3rem">${it.defectDescription ? escapeHtml(it.defectDescription) : '<span class="wd-empty-line">Sin descripción.</span>'}</div>
        </div>
        ${closingBlock}
    </div>`;
}

function renderFailureSection(it) {
    return `<div class="wd-section" style="border-color:#fecaca">
        <h4 style="color:#b91c1c">Motivo del fallo</h4>
        <div class="wd-comments">${escapeHtml(it.failedReason || '—')}</div>
        <p class="wd-meta" style="margin-top:0.4rem">${fmtDate(it.failedDate)}</p>
    </div>`;
}

function renderCommentsSection(it) {
    const editing = _state.editMode === 'comments';
    if (editing) {
        return `<div class="wd-section">
            <h4>Comentarios <button class="wd-section-edit" data-edit-cancel="comments">Cancelar</button></h4>
            <textarea class="wd-comments-edit" rows="3" data-edit="comments">${escapeHtml(it.comments || '')}</textarea>
            <div class="wd-mini-actions" style="margin-top:0.5rem;display:flex;justify-content:flex-end;gap:0.4rem">
                <button class="btn btn-accent btn-sm" data-action="save-comments">Guardar</button>
            </div>
        </div>`;
    }
    return `<div class="wd-section">
        <h4>Comentarios <button class="wd-section-edit" data-edit="comments">Editar</button></h4>
        <div class="wd-comments">${it.comments ? escapeHtml(it.comments) : '<span class="wd-empty-line">Sin comentarios.</span>'}</div>
    </div>`;
}

function bindDetailEvents(it) {
    const wd = $('warrantyDetail');

    wd.querySelectorAll('[data-edit]').forEach(btn => {
        if (btn.tagName !== 'BUTTON') return;
        btn.addEventListener('click', () => {
            beginEdit(btn.getAttribute('data-edit'));
        });
    });

    wd.querySelectorAll('[data-edit-cancel]').forEach(btn => {
        btn.addEventListener('click', () => {
            exitEdit();
            renderDetail();
        });
    });

    wd.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => handleDetailAction(e, it));
    });

    wd.querySelectorAll('[data-call-toggle]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const i = parseInt(btn.getAttribute('data-call-toggle'));
            const calls = it.calls || [];
            if (calls[i]) {
                calls[i].success = !calls[i].success;
                touchUpdated(it);
                await persist();
                renderTable();
                renderDetail();
            }
        });
    });

    wd.querySelectorAll('[data-call-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const i = parseInt(btn.getAttribute('data-call-del'));
            it.calls.splice(i, 1);
            touchUpdated(it);
            await persist();
            renderTable();
            renderDetail();
        });
    });

    wd.querySelectorAll('[data-call-time]').forEach(input => {
        input.addEventListener('change', async () => {
            const i = parseInt(input.getAttribute('data-call-time'));
            if (it.calls[i]) {
                it.calls[i].datetime = input.value;
                touchUpdated(it);
                await persist();
            }
        });
    });
}

function getEditValues() {
    const wd = $('warrantyDetail');
    const out = {};
    wd.querySelectorAll('[data-edit]').forEach(el => {
        if (el.tagName === 'BUTTON') return;
        const key = el.getAttribute('data-edit');
        if (el.type === 'checkbox') {
            out[key] = el.checked;
        } else {
            out[key] = el.value;
        }
    });
    return out;
}

async function handleDetailAction(e, it) {
    const action = e.currentTarget.getAttribute('data-action');

    // === Edit-mode transitions (capture baseline for conflict detection) ===
    if (action === 'mark-received')  { beginEdit('receive'); return; }
    if (action === 'mark-delivered') { beginEdit('deliver'); return; }
    if (action === 'close-case')     { beginEdit('close'); return; }

    // === Prompt-based transitions ===
    if (action === 'mark-failed') {
        captureEditBaseline();
        const reason = prompt('Motivo del fallo (la tienda origen no lo enviará, etc.):');
        if (!reason) return;
        await saveGuarded(target => {
            target.status = 'fallido';
            target.failedReason = reason.trim();
            target.failedDate = todayISO();
        });
        return;
    }

    // === Mini-form saves (with conflict detection) ===
    if (action === 'save-received') {
        const v = getEditValues();
        await saveGuarded(target => {
            target.receivedDate = v.receivedDate || todayISO();
            target.receivedBy = (v.receivedBy || '').trim();
            target.status = 'recibido';
        });
        return;
    }
    if (action === 'save-delivered') {
        const v = getEditValues();
        await saveGuarded(target => {
            target.deliveredDate = v.deliveredDate || todayISO();
            target.deliveredBy = (v.deliveredBy || '').trim();
            target.status = 'entregado';
        });
        return;
    }
    if (action === 'save-close') {
        const v = getEditValues();
        await saveGuarded(target => {
            target.closedDate = v.closedDate || todayISO();
            target.closedBy = (v.closedBy || '').trim();
            target.status = 'cerrado';
        });
        return;
    }
    if (action === 'save-defective') {
        const v = getEditValues();
        await saveGuarded(target => {
            target.inStore = !!v.inStore;
            target.testOrder = target.inStore ? (v.testOrder || '').trim() : '';
            target.saleDate = v.saleDate || '';
            target.processingType = v.processingType || '';
            target.processingStore = (v.processingStore || '').trim();
            target.investigatedBy = (v.investigatedBy || '').trim();
            target.defectDescription = (v.defectDescription || '').trim();
        });
        return;
    }
    if (action === 'save-request') {
        const v = getEditValues();
        await saveGuarded(target => {
            target.umid = (v.umid || '').trim();
            target.sourceStore = v.sourceStore || '';
            target.boxId = (v.boxId || '').trim();
            target.boxName = (v.boxName || '').trim();
            target.requestDate = v.requestDate || target.requestDate;
            target.requestedBy = (v.requestedBy || '').trim();
        });
        return;
    }
    if (action === 'save-reception') {
        const v = getEditValues();
        await saveGuarded(target => {
            target.receivedDate = v.receivedDate || target.receivedDate;
            target.receivedBy = (v.receivedBy || '').trim();
        });
        return;
    }
    if (action === 'save-delivery') {
        const v = getEditValues();
        await saveGuarded(target => {
            target.deliveredDate = v.deliveredDate || target.deliveredDate;
            target.deliveredBy = (v.deliveredBy || '').trim();
        });
        return;
    }
    if (action === 'save-comments') {
        const v = getEditValues();
        await saveGuarded(target => {
            target.comments = (v.comments || '').trim();
        });
        return;
    }

    // === Navigation / modal openers ===
    if (action === 'retry') {
        openModal({
            umid: it.umid,
            boxId: it.boxId,
            boxName: it.boxName,
            sourceStore: '',
            requestDate: todayISO(),
            requestedBy: '',
            inStore: it.inStore,
            testOrder: it.testOrder,
            comments: '',
            retryOfId: it.id,
        });
        return;
    }
    if (action === 'open-retry-of' && it.retryOfId) {
        openDetail(it.retryOfId);
        return;
    }

    // === Instant mutations (append-only, low collision risk — no conflict check) ===
    if (action === 'add-call') {
        if (!it.calls) it.calls = [];
        it.calls.push({ datetime: nowLocalISO(), success: false });
        touchUpdated(it);
        await persist(); renderTable(); renderDetail();
        return;
    }
}

async function deleteItem(id) {
    const it = getItem(id);
    if (!it) return;
    if (!confirm(`¿Eliminar la garantía de ${it.boxName || it.boxId || it.umid}?`)) return;
    _state.items = _state.items.filter(x => x.id !== id);
    await persist();
    closeDetail();
    renderTable();
}

// === Wiring ===
function bindUI() {
    // Filters
    document.querySelectorAll('.wf-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.wf-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            _state.filter = chip.getAttribute('data-filter');
            renderTable();
        });
    });

    // Search
    $('warrantySearch').addEventListener('input', (e) => {
        _state.search = e.target.value;
        renderTable();
    });

    // Sort
    document.querySelectorAll('.warranty-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const k = th.getAttribute('data-sort');
            if (_state.sortKey === k) {
                _state.sortDir = _state.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                _state.sortKey = k;
                _state.sortDir = 'desc';
            }
            document.querySelectorAll('.warranty-table th').forEach(x => x.classList.remove('sorted-asc', 'sorted-desc'));
            th.classList.add(_state.sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
            renderTable();
        });
    });

    // New
    $('btnNewWarranty').addEventListener('click', () => openModal());

    // Layout toggle
    $('layoutToggle').addEventListener('click', toggleLayout);

    // Manual refresh
    $('btnRefresh').addEventListener('click', refresh);

    // Auto-refresh when tab regains focus / visibility
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && getStoreCode()) refresh();
    });

    // Row click → detail (or copy if click was on a copy-btn)
    $('warrantyTbody').addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.copy-btn');
        if (copyBtn) {
            e.stopPropagation();
            copyToClipboard(copyBtn);
            return;
        }
        const tr = e.target.closest('tr');
        if (!tr || !tr.dataset.id) return;
        openDetail(tr.dataset.id);
    });

    // Modal
    $('warrantyModalClose').addEventListener('click', closeModal);
    $('warrantyFormCancel').addEventListener('click', closeModal);
    $('warrantyForm').addEventListener('submit', handleFormSubmit);
    $('wfInStore').addEventListener('change', toggleTestOrderField);


    // ESC closes panels
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if ($('warrantyModalOverlay').classList.contains('open')) closeModal();
        else if ($('warrantyDetailOverlay').classList.contains('open')) closeDetail();
    });
}

async function init() {
    _state.layout = localStorage.getItem(LAYOUT_KEY) || 'side';
    bindUI();
    bindResizeHandle();
    applyLayout();
    await load();
    renderTable();
}

if (getStoreCode()) {
    init();
}
window.addEventListener('storeReady', init);
