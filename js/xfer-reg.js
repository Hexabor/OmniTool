// === Cloud persistence ===
const MODULE_ID = 'xfer-reg';
let _saveTimer = null;

function saveState() {
    // Debounce saves to avoid flooding Firestore
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        const statuses = {};
        tableOutput.querySelectorAll('.status-select').forEach(sel => {
            const key = sel.getAttribute('data-key');
            if (key && sel.value) statuses[key] = sel.value;
        });
        saveModuleData(MODULE_ID, {
            csv: _lastCSV || null,
            fileName: _lastFileName || null,
            statuses
        }).catch(e => console.error('Save failed:', e));
    }, 500);
}

let _lastCSV = null;
let _lastFileName = null;

// === DOM refs ===
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const fileBar = document.getElementById('fileBar');
const fileBarInfo = document.getElementById('fileBarInfo');
const fileBarActions = document.getElementById('fileBarActions');
const fileName = document.getElementById('fileName');
const fileCount = document.getElementById('fileCount');
const btnClear = document.getElementById('btnClear');
const tableOutput = document.getElementById('tableOutput');

const STATUS_OPTIONS = [
    '',
    'Enviado',
    'Vendido en tienda',
    'Ya enviado (RMA...)',
    'Printed cover',
    'Buscando no encontrado',
    'No shipeable',
    'REVISAR'
];

// === Upload handling ===
uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
        processFile(file);
    }
});

fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
        processFile(fileInput.files[0]);
    }
});

btnClear.addEventListener('click', () => {
    if (!confirm('¿Borrar el archivo cargado y todos los estados?')) return;
    if (!confirm('Esta acción no se puede deshacer. ¿Confirmar?')) return;
    uploadZone.hidden = false;
    fileBarInfo.hidden = true;
    fileBarActions.hidden = true;
    fileName.textContent = '';
    fileCount.textContent = '';
    tableOutput.innerHTML = '';
    tableOutput.style.height = '';
    fileInput.value = '';
    _lastCSV = null;
    _lastFileName = null;
    _ignorNextSnapshot = true;
    deleteModuleData(MODULE_ID).catch(e => console.error('Clear failed:', e));
});

// === CSV parsing ===
function parseCSV(text) {
    const lines = text.split('\n');
    if (lines.length < 2) return [];

    const headers = parseLine(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = parseLine(line);
        const row = {};
        headers.forEach((h, idx) => {
            row[h.trim()] = (values[idx] || '').trim();
        });
        rows.push(row);
    }

    return rows;
}

function parseLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
    }
    result.push(current);
    return result;
}

// === Expand rows by quantity ===
function expandRows(rows) {
    const expanded = [];
    for (const row of rows) {
        const qty = parseInt(row['Quantity'], 10) || 1;
        for (let i = 0; i < qty; i++) {
            expanded.push({ ...row, Quantity: '1' });
        }
    }
    return expanded;
}

// === Group by destination, sort ===
function groupByDestination(rows) {
    const groups = {};
    for (const row of rows) {
        const dest = row['Destination'] || 'Sin destino';
        if (!groups[dest]) groups[dest] = [];
        groups[dest].push(row);
    }

    // Sort destinations by total cost descending
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        const costA = groups[a].reduce((s, r) => s + (parseFloat(r['Unit Cost Price']) || 0), 0);
        const costB = groups[b].reduce((s, r) => s + (parseFloat(r['Unit Cost Price']) || 0), 0);
        return costB - costA;
    });

    // Sort items within each group by Unit Cost Price descending
    for (const key of sortedKeys) {
        groups[key].sort((a, b) => {
            const priceA = parseFloat(a['Unit Cost Price']) || 0;
            const priceB = parseFloat(b['Unit Cost Price']) || 0;
            return priceB - priceA;
        });
    }

    return sortedKeys.map(key => ({ destination: key, items: groups[key] }));
}

// === Classify items into 3 blocks ===
function isSoftware(category) {
    const cat = (category || '').toLowerCase();
    return cat.includes('juego') || cat.includes('dvd');
}

function classifyItems(expanded, totalCost) {
    const criticos = [];
    const hardware = [];
    const software = [];

    for (const item of expanded) {
        const cost = parseFloat(item['Unit Cost Price']) || 0;
        const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0;

        if (pct > 0.5) {
            criticos.push(item);
        } else if (!isSoftware(item['Box Category'])) {
            hardware.push(item);
        } else {
            software.push(item);
        }
    }

    return [
        { label: 'Críticos', icon: '!', items: criticos },
        { label: '+Hardware', icon: 'H', items: hardware },
        { label: 'Software', icon: 'S', items: software }
    ];
}

// === Render table ===
function renderTable(groups, totalItems, savedStatuses) {
    savedStatuses = savedStatuses || {};
    const allItems = groups.flatMap(g => g.items);
    const totalCost = allItems.reduce((s, item) => s + (parseFloat(item['Unit Cost Price']) || 0), 0);

    const blocks = classifyItems(allItems, totalCost);

    const statusOptions = STATUS_OPTIONS
        .map(s => `<option value="${s}">${s || '—'}</option>`)
        .join('');

    // COL count: spacer + check + status + dest + boxid + name + category + cost + pct + notes + spacer
    const COLS = 11;

    // Build map: destination -> which block icons it appears in
    // and block+destination -> items (for jump button tooltips)
    const destBlockMap = {};
    const destBlockItems = {};
    for (const block of blocks) {
        if (block.items.length === 0) continue;
        for (const item of block.items) {
            const d = item['Destination'] || 'Sin destino';
            if (!destBlockMap[d]) destBlockMap[d] = [];
            const key = `${block.icon}|${d}`;
            if (!destBlockItems[key]) {
                destBlockMap[d].push(block.icon);
                destBlockItems[key] = [];
            }
            destBlockItems[key].push(item);
        }
    }

    const ICON_SLUG = { '!': 'C', 'H': 'H', 'S': 'S' };
    function destId(icon, dest) {
        return `dest-${ICON_SLUG[icon] || icon}-${dest.replace(/[^a-zA-Z0-9]/g, '_')}`;
    }

    const BLOCK_LABELS = { '!': 'C', 'H': 'H', 'S': 'S' };
    const BLOCK_CSS = { '!': 'jump-c', 'H': 'jump-h', 'S': 'jump-s' };

    const colHeaders = `<tr class="col-headers">
                <th class="col-spacer"></th>
                <th class="col-check"></th>
                <th class="col-status">Estado</th>
                <th>Destination</th>
                <th>BoxID</th>
                <th>Box Name</th>
                <th>Box Category</th>
                <th class="col-cost">Unit Cost</th>
                <th class="col-pct">%</th>
                <th class="col-notes col-notes-header">Notas</th>
                <th class="col-spacer"></th>
            </tr>`;

    let html = `<table class="xfer-table">`;

    let firstBlock = true;

    for (const block of blocks) {
        if (block.items.length === 0) continue;

        const destGroups = groupByDestination(block.items);

        const blockPct = block.items.reduce((s, item) => {
            const cost = parseFloat(item['Unit Cost Price']) || 0;
            return s + (totalCost > 0 ? (cost / totalCost) * 100 : 0);
        }, 0);

        // Block header + col headers in their own tbody
        html += `<tbody class="block-thead">
            ${!firstBlock ? `<tr class="block-spacer"><td colspan="${COLS}"></td></tr>` : ''}
            <tr class="block-header-row block-header-${block.icon}">
                <td colspan="${COLS}">
                    <span class="block-label">${block.label}</span>
                    <span class="block-count">${block.items.length} items</span>
                    <span class="block-pct">${blockPct.toFixed(1)}%</span>
                </td>
            </tr>
            ${colHeaders}
        </tbody>`;

        firstBlock = false;

        destGroups.forEach((group, gIdx) => {
            const destPct = group.items.reduce((s, item) => {
                const cost = parseFloat(item['Unit Cost Price']) || 0;
                return s + (totalCost > 0 ? (cost / totalCost) * 100 : 0);
            }, 0);

            const otherBlocks = (destBlockMap[group.destination] || [])
                .filter(icon => icon !== block.icon);
            const jumpBtns = otherBlocks.map(icon => {
                const key = `${icon}|${group.destination}`;
                const items = destBlockItems[key] || [];
                const itemCount = items.length;
                const grpPct = items.reduce((s, it) => {
                    const c = parseFloat(it['Unit Cost Price']) || 0;
                    return s + (totalCost > 0 ? (c / totalCost) * 100 : 0);
                }, 0);
                const rows = items.map(it => {
                    const c = parseFloat(it['Unit Cost Price']) || 0;
                    const p = totalCost > 0 ? (c / totalCost) * 100 : 0;
                    const name = (it['Box Name'] || '—').replace(/"/g, '&quot;').replace(/</g, '&lt;');
                    return `${name}\t${p.toFixed(2)}%`;
                });
                const tipData = `${itemCount}\t${grpPct.toFixed(2)}\t${rows.join('\n')}`;
                return `<a href="#${destId(icon, group.destination)}" class="jump-btn ${BLOCK_CSS[icon]}" data-tip="${tipData.replace(/"/g, '&quot;')}">${BLOCK_LABELS[icon]}</a>`;
            }).join('');

            // Each destination in its own tbody for page-break control
            html += `<tbody class="dest-group">
                ${gIdx > 0 ? `<tr class="destination-spacer"><td colspan="${COLS}"></td></tr>` : ''}
                <tr class="destination-header" id="${destId(block.icon, group.destination)}">
                    <td colspan="${COLS}">
                        ${group.destination}
                        <span class="dest-separator">—</span>
                        <span class="dest-count">${group.items.length} items</span>
                        <span class="dest-separator">—</span>
                        <span class="dest-pct">${destPct.toFixed(2)}%</span>
                        ${jumpBtns}
                    </td>
                </tr>`;

            for (let i = 0; i < group.items.length; i++) {
                const item = group.items[i];
                const cost = parseFloat(item['Unit Cost Price']) || 0;
                const pct = totalCost > 0 ? ((cost / totalCost) * 100) : 0;

                let pctClass = '';
                if (pct >= 2) pctClass = 'pct-tier-3';
                else if (pct >= 1) pctClass = 'pct-tier-2';
                else if (pct >= 0.5) pctClass = 'pct-tier-1';

                const posClass = (i === 0 ? ' dest-first' : '') +
                                 (i === group.items.length - 1 ? ' dest-last' : '');

                const rowKey = `${group.destination}|${item['BoxID'] || ''}|${i}`;

                html += `<tr class="${pctClass}${posClass}">
                    <td class="col-spacer"></td>
                    <td class="col-check"><input type="checkbox"></td>
                    <td class="col-status"><select class="status-select" data-key="${rowKey.replace(/"/g, '&quot;')}">${statusOptions}</select></td>
                    <td>${group.destination}</td>
                    <td class="col-boxid">${item['BoxID'] || ''}</td>
                    <td>${item['Box Name'] || ''}</td>
                    <td>${item['Box Category'] || ''}</td>
                    <td class="col-cost">${cost.toFixed(2)} €</td>
                    <td class="col-pct">${pct.toFixed(2)}%</td>
                    <td class="col-notes"></td>
                    <td class="col-spacer"></td>
                </tr>`;
            }

            html += '</tbody>';
        });
    }

    html += '</table>';
    tableOutput.innerHTML = html;

    // Responsive scaling — shrink table to fit narrow viewports
    fitTableToContainer();

    // Bind status color changes + persistence
    tableOutput.querySelectorAll('.status-select').forEach(select => {
        const key = select.getAttribute('data-key');
        if (key && savedStatuses[key]) {
            select.value = savedStatuses[key];
            select.setAttribute('data-status', select.value);
        }
        select.addEventListener('change', () => {
            select.setAttribute('data-status', select.value);
            saveState();
            // Auto-update summary if open
            if (summaryOverlay && summaryOverlay.classList.contains('open')) {
                renderSummary();
            }
        });
    });

    // Flash on jump
    tableOutput.querySelectorAll('.jump-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(btn.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.remove('flash');
                void target.offsetWidth;
                target.classList.add('flash');
            }
        });

        // Tooltip on hover
        btn.addEventListener('mouseenter', () => {
            const raw = btn.getAttribute('data-tip');
            if (!raw) return;
            const parts = raw.split('\t');
            const count = parts[0];
            const pct = parts[1];
            const rows = parts.slice(2).join('\t').split('\n').filter(Boolean);

            const tip = document.createElement('div');
            tip.className = 'jump-tooltip';
            tip.innerHTML =
                `<div class="jump-tooltip-header">${count} items · ${pct}%</div>` +
                rows.map(r => {
                    const [name, p] = r.split('\t');
                    return `<div class="jump-tooltip-row"><span>${name}</span><span class="jump-tooltip-pct">${p}</span></div>`;
                }).join('');
            btn.appendChild(tip);

            // Flip above if it overflows the viewport bottom
            const tipRect = tip.getBoundingClientRect();
            if (tipRect.bottom > window.innerHeight) {
                tip.classList.add('jump-tooltip-above');
            }
        });

        btn.addEventListener('mouseleave', () => {
            const tip = btn.querySelector('.jump-tooltip');
            if (tip) tip.remove();
        });
    });
}

// === Process file ===
function processFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        loadCSV(text, file.name);
    };
    reader.readAsText(file, 'UTF-8');
}

function loadCSV(text, name, savedStatuses) {
    _lastCSV = text;
    _lastFileName = name;

    const rows = parseCSV(text);
    const expanded = expandRows(rows);
    const groups = groupByDestination(expanded);
    const totalItems = expanded.length;

    // Update UI
    uploadZone.hidden = true;
    fileBarInfo.hidden = false;
    fileBarActions.hidden = false;
    fileName.textContent = name;
    fileCount.textContent = `· ${totalItems} items · ${groups.length} destinos`;

    renderTable(groups, totalItems, savedStatuses);
    if (!savedStatuses) saveState(); // only save on new upload, not on restore
}

// === Responsive table scaling ===
function fitTableToContainer() {
    const table = tableOutput.querySelector('.xfer-table');
    if (!table) return;

    // Reset any previous transform so we measure the natural width
    table.style.transform = '';
    table.style.transformOrigin = '';
    tableOutput.style.height = '';

    const containerW = tableOutput.clientWidth;
    const tableW = table.scrollWidth;

    if (tableW > containerW) {
        const scale = containerW / tableW;
        table.style.transformOrigin = 'top left';
        table.style.transform = `scale(${scale})`;
        // Adjust container height so it doesn't leave blank space
        tableOutput.style.height = (table.offsetHeight * scale) + 'px';
    }
}

window.addEventListener('resize', fitTableToContainer);

// === Real-time sync from Firestore ===
let _unsubscribe = null;
let _ignorNextSnapshot = false;

// Flag to skip the snapshot triggered by our own save
const _origSaveState = saveState;
saveState = function () {
    _ignorNextSnapshot = true;
    _origSaveState();
};

function startRealtimeSync() {
    // Detach previous listener if any
    if (_unsubscribe) _unsubscribe();

    const ref = storeDocRef(MODULE_ID);
    if (!ref) return;

    _unsubscribe = ref.onSnapshot(snap => {
        if (_ignorNextSnapshot) {
            _ignorNextSnapshot = false;
            return;
        }

        const data = snap.exists ? snap.data() : null;
        if (data && data.csv) {
            loadCSV(data.csv, data.fileName || 'restored.csv', data.statuses || {});
        } else if (!data || !data.csv) {
            // Remote cleared — reset UI if we had data loaded
            if (_lastCSV) {
                uploadZone.hidden = false;
                fileBarInfo.hidden = true;
                fileBarActions.hidden = true;
                tableOutput.innerHTML = '';
                tableOutput.style.height = '';
                _lastCSV = null;
                _lastFileName = null;
            }
        }
    }, err => {
        console.error('Realtime sync error:', err);
    });
}

// Start sync when store is ready
if (getStoreCode()) {
    startRealtimeSync();
}
window.addEventListener('storeReady', startRealtimeSync);

// === Summary panel ===
const summaryOverlay = document.getElementById('summaryOverlay');
const summaryBody = document.getElementById('summaryBody');
const summaryClose = document.getElementById('summaryClose');
const btnSummary = document.getElementById('btnSummary');

if (btnSummary) {
    btnSummary.addEventListener('click', (e) => {
        e.preventDefault();
        renderSummary();
        summaryOverlay.classList.add('open');
    });
}

if (summaryClose) {
    summaryClose.addEventListener('click', () => {
        summaryOverlay.classList.remove('open');
    });
}

if (summaryOverlay) {
    summaryOverlay.addEventListener('click', (e) => {
        if (e.target === summaryOverlay) summaryOverlay.classList.remove('open');
    });
}

function renderSummary() {
    if (!summaryBody || !_lastCSV) {
        if (summaryBody) summaryBody.innerHTML = '<p style="color:var(--color-text-lighter);text-align:center;padding:2rem 0">No hay datos cargados</p>';
        return;
    }

    const rows = parseCSV(_lastCSV);
    const expanded = expandRows(rows);
    const totalItems = expanded.length;
    const totalCost = expanded.reduce((s, r) => s + (parseFloat(r['Unit Cost Price']) || 0), 0);

    // Read current statuses from the DOM
    const statusMap = {};
    tableOutput.querySelectorAll('.status-select').forEach(sel => {
        const key = sel.getAttribute('data-key');
        if (key) statusMap[key] = sel.value;
    });

    // Assign status to each expanded item
    const groups = groupByDestination(expanded);
    const allItemsWithStatus = [];
    const allBlocks = classifyItems(expanded, totalCost);

    for (const block of allBlocks) {
        if (block.items.length === 0) continue;
        const destGroups = groupByDestination(block.items);
        for (const group of destGroups) {
            for (let i = 0; i < group.items.length; i++) {
                const item = group.items[i];
                const key = `${group.destination}|${item['BoxID'] || ''}|${i}`;
                allItemsWithStatus.push({
                    ...item,
                    _status: statusMap[key] || '',
                    _cost: parseFloat(item['Unit Cost Price']) || 0
                });
            }
        }
    }

    // Statuses that discount items (REVISAR = no status effectively)
    const DISCOUNT_STATUSES = ['Printed cover', 'Vendido en tienda', 'Ya enviado (RMA...)', 'No shipeable'];
    const COVERED_STATUS = 'Enviado';
    const SEARCHING_STATUS = 'Buscando no encontrado';

    // Compute discount breakdown
    const discountRows = DISCOUNT_STATUSES.map(status => {
        const items = allItemsWithStatus.filter(it => it._status === status);
        const count = items.length;
        const cost = items.reduce((s, it) => s + it._cost, 0);
        const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0;
        return { status, count, cost, pct };
    });

    const totalDiscountCount = discountRows.reduce((s, r) => s + r.count, 0);
    const totalDiscountCost = discountRows.reduce((s, r) => s + r.cost, 0);
    const totalDiscountPct = totalCost > 0 ? (totalDiscountCost / totalCost) * 100 : 0;

    // Effective values
    const effectiveItems = totalItems - totalDiscountCount;
    const effectiveCost = totalCost - totalDiscountCost;

    // Covered (Enviado)
    const coveredItems = allItemsWithStatus.filter(it => it._status === COVERED_STATUS);
    const coveredCount = coveredItems.length;
    const coveredCost = coveredItems.reduce((s, it) => s + it._cost, 0);
    const coveredPctCost = effectiveCost > 0 ? (coveredCost / effectiveCost) * 100 : 0;
    const coveredPctItems = effectiveItems > 0 ? (coveredCount / effectiveItems) * 100 : 0;

    // Searching
    const searchingItems = allItemsWithStatus.filter(it => it._status === SEARCHING_STATUS);
    const searchingCount = searchingItems.length;
    const searchingCost = searchingItems.reduce((s, it) => s + it._cost, 0);
    const searchingPct = effectiveCost > 0 ? (searchingCost / effectiveCost) * 100 : 0;

    // Progress bar color
    let pctClass = 'pct-green';
    if (coveredPctCost < 85) pctClass = 'pct-red';
    else if (coveredPctCost < 95) pctClass = 'pct-yellow';

    const storeName = getStoreCode() || 'Tienda';

    summaryBody.innerHTML = `
        <div class="summary-store">${storeName}</div>
        <div class="summary-total">${totalItems} items · ${totalCost.toFixed(2)} €</div>

        <div class="summary-section-title">Descontado por estado</div>
        <table class="summary-table">
            ${discountRows.map(r => `
                <tr>
                    <td class="s-label">${r.status}</td>
                    <td class="s-count">${r.count}</td>
                    <td class="s-cost">${r.cost.toFixed(2)} €</td>
                    <td class="s-pct">${r.pct.toFixed(2)}%</td>
                </tr>
            `).join('')}
            <tr class="s-total-row">
                <td class="s-label">Total no penalizado</td>
                <td class="s-count">${totalDiscountCount}</td>
                <td class="s-cost">${totalDiscountCost.toFixed(2)} €</td>
                <td class="s-pct">${totalDiscountPct.toFixed(2)}%</td>
            </tr>
        </table>

        <div class="summary-section-title">Valor efectivo</div>
        <div class="summary-effective">${effectiveItems} items · ${effectiveCost.toFixed(2)} €</div>

        <div class="summary-section-title">Cubierto (Enviado)</div>
        <div class="summary-progress-wrap">
            <div class="summary-progress-bar">
                <div class="summary-progress-fill ${pctClass}" style="width: ${Math.min(coveredPctCost, 100)}%"></div>
            </div>
            <div class="summary-progress-labels">
                <span class="summary-progress-main">${coveredPctCost.toFixed(2)}% coste</span>
                <span class="summary-progress-secondary">${coveredPctItems.toFixed(2)}% items</span>
            </div>
        </div>

        ${searchingCount > 0 ? `
            <div class="summary-alert summary-alert-warn">
                Buscando no encontrado: ${searchingCount} items · ${searchingCost.toFixed(2)} € · ${searchingPct.toFixed(2)}%
            </div>
        ` : `
            <div class="summary-alert summary-alert-ok">
                No hay items pendientes de buscar
            </div>
        `}
    `;
}
