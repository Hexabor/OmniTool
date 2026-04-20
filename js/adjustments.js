// === Control de ajustes ===
const MODULE = 'adjustments';
const VIEW_KEY = 'adjustments_view';

// Annual adjustment threshold (as fraction of yearly sales).
// Net cumulative adjustments outside this range = failed.
const THRESHOLD_LOWER = -0.0040;   // −0.40 %
const THRESHOLD_UPPER =  0.0010;   // +0.10 %

let _state = {
    items: [],
    filtered: {},          // { id: true } — flagged for exclusion from "real" analysis
    weeklySales: {},       // { "2026-17": 3718.00, ... } — manually entered per week
    view: 'summary',       // 'summary' | 'list' (persisted in localStorage)
    sortKey: 'dateIso',
    sortDir: 'desc',
    filters: {
        search: '',
        week: '',
        month: '',
        category: '',
        type: '',
        costMin: null,
        costMax: null,
        view: 'all',       // 'all' | 'filtered' | 'unfiltered'
    },
};

function $(id) { return document.getElementById(id); }

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
}

// === CSV parser (handles quoted fields with commas / newlines / "" escapes) ===
function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const len = text.length;
    while (i < len) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                inQuotes = false; i++; continue;
            }
            field += c; i++; continue;
        }
        if (c === '"') { inQuotes = true; i++; continue; }
        if (c === ',') { row.push(field); field = ''; i++; continue; }
        if (c === '\n' || c === '\r') {
            if (field !== '' || row.length > 0) {
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            }
            if (c === '\r' && text[i + 1] === '\n') i++;
            i++;
            continue;
        }
        field += c; i++;
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
function parseDate(str) {
    // "20 Apr 2026" → "2026-04-20"
    const m = String(str || '').trim().match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
    if (!m) return '';
    const day = parseInt(m[1]);
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const year = parseInt(m[3]);
    if (!mo) return '';
    return `${year}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function fmtShortDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function fmtMoney(n) {
    const v = Number(n);
    if (isNaN(v)) return '';
    return v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signNum(n) {
    const v = Number(n);
    if (isNaN(v) || v === 0) return v === 0 ? '0' : '';
    return (v > 0 ? '+' : '') + v;
}

// Stable hash so re-uploads dedupe and filter flags survive
function hashAdj(it) {
    const key = [
        it.dateIso, it.boxId, it.serial || '', it.type,
        String(it.adjQty), String(it.adjCostVal),
        (it.notes || '').replace(/\s+/g, ' ').trim(),
        it.orderNumber || ''
    ].join('|').toLowerCase();
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) + hash) + key.charCodeAt(i);
    }
    return 'a_' + (hash >>> 0).toString(36);
}

function rowsToItems(rows) {
    if (rows.length < 2) return [];
    const headers = rows[0].map(h => h.trim());
    const idx = {};
    headers.forEach((h, i) => { idx[h] = i; });
    const get = (row, key) => (idx[key] !== undefined ? (row[idx[key]] || '') : '');

    const items = [];
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (row.length === 0 || (row.length === 1 && !row[0].trim())) continue;
        const dateStr = get(row, 'Date');
        const dateIso = parseDate(dateStr);
        if (!dateIso) continue;

        const it = {
            week: parseInt(get(row, 'Week')) || 0,
            date: dateStr,
            dateIso,
            branch: get(row, 'Branch'),
            location: get(row, 'Location'),
            category: get(row, 'Category'),
            boxName: get(row, 'Box Name'),
            boxId: get(row, 'Box ID'),
            serial: get(row, 'Serial No.'),
            type: get(row, 'StockUpdateType'),
            notes: get(row, 'Notes'),
            unitPrice: parseFloat(get(row, 'Unit Price')) || 0,
            unitCost: parseFloat(get(row, 'Unit Approx Cost Price')) || 0,
            orderNumber: get(row, 'Order Number'),
            fromQty: get(row, 'From QTY'),
            toQty: get(row, 'To QTY'),
            adjQty: parseInt(get(row, 'Adj QTY')) || 0,
            adjSaleVal: parseFloat(get(row, 'Adj Sale Val')) || 0,
            adjCostVal: parseFloat(get(row, 'Adj Cost Val (Approx)')) || 0,
        };
        it.id = hashAdj(it);
        items.push(it);
    }
    return items;
}

// === Company week (Saturday → Friday) ===
// WK1 of any year starts on the Saturday on or before Jan 1 of that year.
// Example: WK1 2026 starts Sat 2025-12-27; WK17 2026 starts Sat 2026-04-18.
function getWk1Saturday(year) {
    const jan1 = new Date(year, 0, 1);
    const dow = jan1.getDay(); // 0=Sun..6=Sat
    const offset = -((dow + 1) % 7); // -1,-2,-3,-4,-5,-6,0 for Sun..Sat
    const sat = new Date(jan1);
    sat.setDate(jan1.getDate() + offset);
    sat.setHours(0, 0, 0, 0);
    return sat;
}

function getCompanyWeek(dateLike) {
    const d = (typeof dateLike === 'string') ? new Date(dateLike) : new Date(dateLike);
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();
    const daysSinceSat = (dow + 1) % 7; // Sat=0, Sun=1, ..., Fri=6
    const sat = new Date(d);
    sat.setDate(d.getDate() - daysSinceSat);
    // Company-year heuristic: a week whose Saturday is late December belongs to the NEXT calendar year
    let year = sat.getFullYear();
    if (sat.getMonth() === 11 && sat.getDate() >= 26) year++;
    let wk1 = getWk1Saturday(year);
    let weeksDiff = Math.round((sat - wk1) / (7 * 86400000));
    if (weeksDiff < 0) {
        year--;
        wk1 = getWk1Saturday(year);
        weeksDiff = Math.round((sat - wk1) / (7 * 86400000));
    }
    return { year, week: weeksDiff + 1, saturday: sat };
}

function weekKey(year, week) { return `${year}-${week}`; }

function weekRange(year, week) {
    const sat = getWk1Saturday(year);
    sat.setDate(sat.getDate() + (week - 1) * 7);
    const fri = new Date(sat);
    fri.setDate(sat.getDate() + 6);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(sat.getDate())}/${pad(sat.getMonth() + 1)} → ${pad(fri.getDate())}/${pad(fri.getMonth() + 1)}`;
}

function quarterOfWeek(week) {
    // Q1 = 1-13, Q2 = 14-26, Q3 = 27-39, Q4 = 40-53
    return Math.min(4, Math.ceil(week / 13));
}

// === Firestore ===
async function load(opts) {
    const data = await loadModuleData(MODULE, opts);
    _state.items = (data && Array.isArray(data.items)) ? data.items : [];
    _state.filtered = (data && data.filtered && typeof data.filtered === 'object') ? data.filtered : {};
    _state.weeklySales = (data && data.weeklySales && typeof data.weeklySales === 'object') ? data.weeklySales : {};
}

async function persist() {
    await saveModuleData(MODULE, {
        items: _state.items,
        filtered: _state.filtered,
        weeklySales: _state.weeklySales,
    });
}

// Refresh from Firestore (force server)
let _refreshing = false;
async function refresh() {
    if (_refreshing) return;
    _refreshing = true;
    const btn = $('adjBtnRefresh');
    if (btn) btn.classList.add('refreshing');
    try {
        await load({ source: 'server' });
        renderAll();
    } catch (e) {
        console.error('[adj] refresh error:', e);
    } finally {
        _refreshing = false;
        if (btn) btn.classList.remove('refreshing');
    }
}

// === CSV upload + merge ===
async function handleCSVFile(file) {
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    const fresh = rowsToItems(rows);
    if (fresh.length === 0) {
        alert('No se han encontrado filas válidas en el CSV.');
        return;
    }
    // Merge: replace existing items by hash, keep all unique
    const map = new Map(_state.items.map(it => [it.id, it]));
    let added = 0;
    for (const it of fresh) {
        if (!map.has(it.id)) added++;
        map.set(it.id, it);
    }
    _state.items = Array.from(map.values());
    await persist();
    renderAll();
    console.log(`[adj] CSV procesado: ${fresh.length} filas leídas, ${added} nuevas, total ${_state.items.length}`);
}

// === Filtering ===
function applyFilters() {
    const f = _state.filters;
    let out = _state.items.slice();

    if (f.view === 'filtered')   out = out.filter(it => _state.filtered[it.id]);
    if (f.view === 'unfiltered') out = out.filter(it => !_state.filtered[it.id]);

    if (f.search) {
        const q = f.search.toLowerCase();
        out = out.filter(it =>
            (it.boxName || '').toLowerCase().includes(q) ||
            (it.boxId || '').toLowerCase().includes(q) ||
            (it.notes || '').toLowerCase().includes(q) ||
            (it.orderNumber || '').toLowerCase().includes(q) ||
            (it.serial || '').toLowerCase().includes(q)
        );
    }
    if (f.week !== '') {
        const w = parseInt(f.week);
        out = out.filter(it => it.week === w);
    }
    if (f.month !== '') {
        const mo = String(f.month).padStart(2, '0');
        out = out.filter(it => it.dateIso.slice(5, 7) === mo);
    }
    if (f.category) out = out.filter(it => it.category === f.category);
    if (f.type)     out = out.filter(it => it.type === f.type);
    if (f.costMin !== null) out = out.filter(it => Math.abs(it.adjSaleVal) >= f.costMin);
    if (f.costMax !== null) out = out.filter(it => Math.abs(it.adjSaleVal) <= f.costMax);

    const k = _state.sortKey;
    const dir = _state.sortDir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
        const va = a[k], vb = b[k];
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va || '').localeCompare(String(vb || ''), 'es', { numeric: true }) * dir;
    });

    return out;
}

// === Rendering ===
function renderAll() {
    populateFilterDropdowns();
    renderRange();
    renderSummary();
    renderTable();
    applyViewVisibility();
}

// Gives {year, week} for an item using company week rules (derives year from date)
function itemYearWeek(it) {
    const comp = getCompanyWeek(it.dateIso);
    return { year: comp.year, week: it.week || comp.week };
}

// === Weekly summary aggregation ===
// Cumulatives reset on Quarter boundary (Q1..Q4) AND on Year boundary (WK1).
// Year cumulatives count from the start of WK1 of each company year.
function buildSummary() {
    const weeks = new Map();
    for (const it of _state.items) {
        const yw = itemYearWeek(it);
        const k = weekKey(yw.year, yw.week);
        if (!weeks.has(k)) weeks.set(k, { year: yw.year, week: yw.week, total: 0, filteredTotal: 0 });
        const w = weeks.get(k);
        w.total += it.adjSaleVal || 0;
        if (_state.filtered[it.id]) w.filteredTotal += it.adjSaleVal || 0;
    }
    const asc = Array.from(weeks.values()).sort((a, b) => (a.year - b.year) || (a.week - b.week));

    let prevQKey = null;
    let prevYear = null;
    let netCumQ = 0, salesCumQ = 0;
    let netCumYear = 0, salesCumYear = 0;

    const rows = [];
    for (const w of asc) {
        const q = quarterOfWeek(w.week);
        const qKey = `${w.year}-Q${q}`;

        // Year boundary → reset both year and quarter cumulatives
        if (w.year !== prevYear) {
            netCumYear = 0; salesCumYear = 0;
            netCumQ = 0; salesCumQ = 0;
            prevYear = w.year;
            prevQKey = qKey;
        } else if (qKey !== prevQKey) {
            netCumQ = 0; salesCumQ = 0;
            prevQKey = qKey;
        }

        const neto = w.total - w.filteredTotal;
        const rawSales = _state.weeklySales[weekKey(w.year, w.week)];
        const sales = (rawSales === undefined || rawSales === null || isNaN(rawSales)) ? null : Number(rawSales);

        netCumQ += neto;
        netCumYear += neto;
        if (sales !== null) {
            salesCumQ += sales;
            salesCumYear += sales;
        }

        // Margin (per quarter): how many € of net adjustment can still happen this quarter before
        // falling out of [lower..upper] of quarterly sales. Resets at every new quarter.
        // Positive = room left. Negative = already out of range (failed).
        let margin = null;
        if (salesCumQ > 0) {
            const lower = THRESHOLD_LOWER * salesCumQ;
            const upper = THRESHOLD_UPPER * salesCumQ;
            if (netCumQ < lower) margin = netCumQ - lower;
            else if (netCumQ > upper) margin = upper - netCumQ;
            else margin = Math.min(netCumQ - lower, upper - netCumQ);
        }

        rows.push({
            year: w.year,
            week: w.week,
            quarter: q,
            total: w.total,
            filteredTotal: w.filteredTotal,
            neto,
            netCumQ,
            sales,
            salesCumQ,
            netCumYear,
            salesCumYear,
            pctWk: (sales !== null && sales > 0) ? (neto / sales) * 100 : null,
            pctCumQ: salesCumQ > 0 ? (netCumQ / salesCumQ) * 100 : null,
            pctYear: salesCumYear > 0 ? (netCumYear / salesCumYear) * 100 : null,
            margin,
        });
    }
    return rows;
}

// Single % colouring rule: red only when outside the acceptable range.
// Inside range or null → no special colour (default text).
function pctClass(p) {
    if (p === null) return 'adj-pct-none';
    const lo = THRESHOLD_LOWER * 100;
    const hi = THRESHOLD_UPPER * 100;
    return (p < lo || p > hi) ? 'adj-pct-bad' : '';
}

function fmtMarginEuro(m) {
    if (m === null) return '<span class="adj-amount-muted">—</span>';
    return (m >= 0 ? '+' : '') + fmtMoney(m) + ' €';
}

function fmtPct(p) {
    if (p === null) return '<span class="adj-amount-muted">—</span>';
    return (p >= 0 ? '+' : '') + p.toFixed(2).replace('.', ',') + ' %';
}

function renderSummary() {
    const el = $('adjSummary');
    if (!_state.items.length) { el.hidden = true; return; }
    el.hidden = false;

    const rowsAsc = buildSummary();
    const rows = rowsAsc.slice().reverse(); // newest on top

    // Missing-sales banner
    const missing = rowsAsc.filter(r => r.sales === null);
    const alert = $('adjSalesAlert');
    if (missing.length > 0) {
        const lastFew = missing.slice(-8).map(r => `WK${r.week}/${String(r.year).slice(-2)}`).join(', ');
        const extra = missing.length > 8 ? '…' : '';
        alert.innerHTML = `<strong>Faltan ventas</strong> en ${missing.length} semana${missing.length === 1 ? '' : 's'}: ${lastFew}${extra}. Introduce la facturación en la columna <strong>Ventas WK</strong>.`;
        alert.hidden = false;
    } else {
        alert.hidden = true;
    }

    // Render with quarter dividers
    let html = '';
    let prevQKey = null;
    for (const r of rows) {
        const qKey = `${r.year}-Q${r.quarter}`;
        if (qKey !== prevQKey) {
            html += `<tr class="q-divider"><td colspan="15">${r.year} · Q${r.quarter}</td></tr>`;
            prevQKey = qKey;
        }
        const key = weekKey(r.year, r.week);
        const salesVal = r.sales !== null ? r.sales.toFixed(2) : '';
        const hasSales = r.sales !== null;
        html += `<tr>
            <td class="col-q">Q${r.quarter}</td>
            <td class="col-wk">WK${r.week}</td>
            <td class="col-range">${weekRange(r.year, r.week)}</td>
            <td class="num">${fmtMoney(r.total)}</td>
            <td class="num adj-amount-muted">${fmtMoney(r.filteredTotal)}</td>
            <td class="num">${fmtMoney(r.neto)}</td>
            <td class="num">
                <input type="number" step="0.01" min="0" class="adj-sales-input ${hasSales ? '' : 'missing'}" data-week-key="${key}" value="${salesVal}" placeholder="— €">
            </td>
            <td class="num ${pctClass(r.pctWk)}">${fmtPct(r.pctWk)}</td>
            <td class="num">${fmtMoney(r.netCumQ)}</td>
            <td class="num ${r.salesCumQ > 0 ? '' : 'adj-amount-muted'}">${r.salesCumQ > 0 ? fmtMoney(r.salesCumQ) : '—'}</td>
            <td class="num ${pctClass(r.pctCumQ)}">${fmtPct(r.pctCumQ)}</td>
            <td class="num">${fmtMarginEuro(r.margin)}</td>
            <td class="num col-year-start">${fmtMoney(r.netCumYear)}</td>
            <td class="num col-year ${r.salesCumYear > 0 ? '' : 'adj-amount-muted'}">${r.salesCumYear > 0 ? fmtMoney(r.salesCumYear) : '—'}</td>
            <td class="num col-year ${pctClass(r.pctYear)}">${fmtPct(r.pctYear)}</td>
        </tr>`;
    }
    $('adjSummaryTbody').innerHTML = html;
}

function renderRange() {
    if (!_state.items.length) {
        $('adjRangeFrom').textContent = '—';
        $('adjRangeTo').textContent = '—';
        $('adjRangeCount').textContent = '0 ajustes';
        return;
    }
    const dates = _state.items.map(it => it.dateIso).sort();
    $('adjRangeFrom').textContent = fmtShortDate(dates[0]);
    $('adjRangeTo').textContent = fmtShortDate(dates[dates.length - 1]);
    $('adjRangeCount').textContent = `${_state.items.length} ajuste${_state.items.length === 1 ? '' : 's'}`;
}

function populateFilterDropdowns() {
    const weeks = new Set();
    const months = new Set();
    const categories = new Set();
    const types = new Set();
    _state.items.forEach(it => {
        if (it.week) weeks.add(it.week);
        if (it.dateIso) months.add(it.dateIso.slice(5, 7));
        if (it.category) categories.add(it.category);
        if (it.type) types.add(it.type);
    });
    fillSelect($('adjFilterWeek'), Array.from(weeks).sort((a, b) => b - a), v => `Semana ${v}`, 'Todas las semanas');
    fillSelect($('adjFilterMonth'), Array.from(months).sort(), v => monthLabel(v), 'Todos los meses');
    fillSelect($('adjFilterCategory'), Array.from(categories).sort(), v => v, 'Todas categorías');
    fillSelect($('adjFilterType'), Array.from(types).sort(), v => v, 'Todos los types');
}

function fillSelect(el, values, labelFn, allLabel) {
    if (!el) return;
    const current = el.value;
    el.innerHTML = `<option value="">${allLabel}</option>` +
        values.map(v => `<option value="${escapeHtml(v)}" ${String(v) === current ? 'selected' : ''}>${escapeHtml(labelFn(v))}</option>`).join('');
}

function monthLabel(mm) {
    const labels = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return labels[parseInt(mm)] || mm;
}

function renderTable() {
    const tbody = $('adjTbody');
    const empty = $('adjEmpty');
    const stats = $('adjStats');
    if (!_state.items.length) {
        tbody.innerHTML = '';
        empty.hidden = false;
        stats.hidden = true;
        return;
    }
    empty.hidden = true;
    stats.hidden = false;

    const items = applyFilters();
    updateStats(items);

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="19" style="text-align:center;padding:1.5rem;color:var(--color-text-lighter)">Sin resultados con estos filtros.</td></tr>`;
        return;
    }
    tbody.innerHTML = items.map(renderRow).join('');
}

function renderRow(it) {
    const isFiltered = !!_state.filtered[it.id];
    const sv = it.adjSaleVal;
    const saleClass = sv > 0 ? 'adj-cost-pos' : (sv < 0 ? 'adj-cost-neg' : '');
    const orderNum = (it.orderNumber && it.orderNumber !== 'null') ? escapeHtml(it.orderNumber) : '';
    const fromQ = (it.fromQty === 'null' || it.fromQty === '') ? '—' : escapeHtml(it.fromQty);
    const toQ = (it.toQty === 'null' || it.toQty === '') ? '—' : escapeHtml(it.toQty);

    return `<tr class="${isFiltered ? 'is-filtered' : ''}" data-id="${it.id}">
        <td class="col-filter">
            <input type="checkbox" class="adj-filter-check" data-id="${it.id}" ${isFiltered ? 'checked' : ''}>
        </td>
        <td class="col-week">${it.week || '—'}</td>
        <td class="col-date">${fmtShortDate(it.dateIso)}</td>
        <td>${escapeHtml(it.branch)}</td>
        <td>${escapeHtml(it.location)}</td>
        <td class="col-category">${escapeHtml(it.category)}</td>
        <td class="col-boxname">${escapeHtml(it.boxName)}</td>
        <td class="col-boxid">${escapeHtml(it.boxId)}</td>
        <td class="col-serial" title="${escapeHtml(it.serial)}">${escapeHtml(it.serial)}</td>
        <td class="col-type">${escapeHtml(it.type)}</td>
        <td class="col-notes">${escapeHtml(it.notes)}</td>
        <td class="num">${fmtMoney(it.unitPrice)}</td>
        <td class="num">${fmtMoney(it.unitCost)}</td>
        <td>${orderNum}</td>
        <td class="num">${fromQ}</td>
        <td class="num">${toQ}</td>
        <td class="num">${signNum(it.adjQty)}</td>
        <td class="num ${saleClass}">${fmtMoney(it.adjSaleVal)}</td>
        <td class="num">${fmtMoney(it.adjCostVal)}</td>
    </tr>`;
}

function updateStats(visibleItems) {
    const sumVis = visibleItems.reduce((s, it) => s + (it.adjSaleVal || 0), 0);
    const filteredAll = _state.items.filter(it => _state.filtered[it.id]);
    const sumFiltered = filteredAll.reduce((s, it) => s + (it.adjSaleVal || 0), 0);
    $('adjStatCount').textContent = visibleItems.length.toLocaleString('es-ES');
    $('adjStatSum').textContent = fmtMoney(sumVis) + ' €';
    $('adjStatFiltered').textContent = filteredAll.length.toLocaleString('es-ES');
    $('adjStatFilteredSum').textContent = fmtMoney(sumFiltered) + ' €';
}

// === Filter checkbox toggle ===
async function toggleFilter(id, checked) {
    if (checked) _state.filtered[id] = true;
    else delete _state.filtered[id];
    // Update row class without full re-render
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    if (tr) tr.classList.toggle('is-filtered', checked);
    // Update stats live
    updateStats(applyFilters());
    // If a view filter is active that hides this row, re-render
    if (_state.filters.view !== 'all') renderTable();
    // Recompute weekly summary (filtered totals, neto, cumulatives, %, margin)
    renderSummary();
    await persist();
}

// === Wiring ===
function bindUI() {
    // Upload zone
    const zone = $('adjUploadZone');
    const fileInput = $('adjFileInput');
    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const f = e.dataTransfer.files[0];
        if (f) handleCSVFile(f);
    });
    fileInput.addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (f) handleCSVFile(f);
        fileInput.value = '';
    });

    // Refresh
    $('adjBtnRefresh').addEventListener('click', refresh);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && getStoreCode()) refresh();
    });

    // Filters
    $('adjSearch').addEventListener('input', (e) => { _state.filters.search = e.target.value.trim(); renderTable(); });
    $('adjFilterWeek').addEventListener('change', (e) => { _state.filters.week = e.target.value; renderTable(); });
    $('adjFilterMonth').addEventListener('change', (e) => { _state.filters.month = e.target.value; renderTable(); });
    $('adjFilterCategory').addEventListener('change', (e) => { _state.filters.category = e.target.value; renderTable(); });
    $('adjFilterType').addEventListener('change', (e) => { _state.filters.type = e.target.value; renderTable(); });
    $('adjFilterCostMin').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        _state.filters.costMin = isNaN(v) ? null : v;
        renderTable();
    });
    $('adjFilterCostMax').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        _state.filters.costMax = isNaN(v) ? null : v;
        renderTable();
    });

    // View toggle (Todos / Solo filtrados / Sin filtrar)
    document.querySelectorAll('.adj-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.adj-toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _state.filters.view = btn.getAttribute('data-view');
            renderTable();
        });
    });

    // Clear filters
    $('adjBtnClearFilters').addEventListener('click', () => {
        _state.filters = {
            search: '', week: '', month: '', category: '', type: '',
            costMin: null, costMax: null, view: 'all',
        };
        $('adjSearch').value = '';
        $('adjFilterWeek').value = '';
        $('adjFilterMonth').value = '';
        $('adjFilterCategory').value = '';
        $('adjFilterType').value = '';
        $('adjFilterCostMin').value = '';
        $('adjFilterCostMax').value = '';
        document.querySelectorAll('.adj-toggle-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-view') === 'all'));
        renderTable();
    });

    // Sort
    document.querySelectorAll('.adj-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const k = th.getAttribute('data-sort');
            if (_state.sortKey === k) {
                _state.sortDir = _state.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                _state.sortKey = k;
                _state.sortDir = 'desc';
            }
            document.querySelectorAll('.adj-table th').forEach(x => x.classList.remove('sorted-asc', 'sorted-desc'));
            th.classList.add(_state.sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
            renderTable();
        });
    });

    // Filter checkbox (delegated)
    $('adjTbody').addEventListener('change', (e) => {
        const cb = e.target.closest('.adj-filter-check');
        if (!cb) return;
        toggleFilter(cb.getAttribute('data-id'), cb.checked);
    });

    // Weekly sales input (delegated)
    $('adjSummaryTbody').addEventListener('change', async (e) => {
        const inp = e.target.closest('.adj-sales-input');
        if (!inp) return;
        const key = inp.getAttribute('data-week-key');
        const raw = inp.value.trim();
        if (raw === '') {
            delete _state.weeklySales[key];
        } else {
            const v = parseFloat(raw.replace(',', '.'));
            if (isNaN(v) || v < 0) { inp.value = ''; return; }
            _state.weeklySales[key] = v;
        }
        await persist();
        renderSummary();
    });

    // Main view tabs (Resumen / Listado)
    document.querySelectorAll('.adj-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const v = btn.getAttribute('data-mainview');
            if (v) setView(v);
        });
    });
}

function setView(v) {
    _state.view = v;
    localStorage.setItem(VIEW_KEY, v);
    document.body.classList.toggle('adj-view-summary', v === 'summary');
    document.body.classList.toggle('adj-view-list', v === 'list');
    document.querySelectorAll('.adj-tab').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-mainview') === v);
    });
}

function applyViewVisibility() {
    // Show/hide the tabs themselves: only relevant once data is loaded
    const hasData = _state.items.length > 0;
    const tabs = $('adjViewTabs');
    if (tabs) tabs.hidden = !hasData;
    if (!hasData) {
        // No data → reset body classes so the empty state shows
        document.body.classList.remove('adj-view-summary', 'adj-view-list');
    } else {
        setView(_state.view);
    }
}

async function init() {
    _state.view = localStorage.getItem(VIEW_KEY) || 'summary';
    bindUI();
    await load();
    renderAll();
}

if (getStoreCode()) {
    init();
}
window.addEventListener('storeReady', init);
