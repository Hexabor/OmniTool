// === Store gate ===
const storeGate = document.getElementById('storeGate');
const storeInput = document.getElementById('storeInput');
const storeSubmit = document.getElementById('storeSubmit');

function showApp() {
    if (storeGate) storeGate.classList.remove('active');
    // Update store name in settings
    const storeNameEl = document.getElementById('settingsStoreName');
    if (storeNameEl) storeNameEl.textContent = getStoreCode() || '';
    // Dispatch event so modules can load their data
    window.dispatchEvent(new Event('storeReady'));
}

function showStoreGate() {
    if (storeGate) storeGate.classList.add('active');
}

if (storeGate && storeInput && storeSubmit) {
    function submitStore() {
        const code = storeInput.value.trim().toUpperCase();
        if (!code) return;
        setStoreCode(code);
        showApp();
    }

    storeSubmit.addEventListener('click', submitStore);
    storeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitStore();
    });
}

// Check if store is already selected
if (getStoreCode()) {
    showApp();
} else {
    showStoreGate();
}

// Sidebar toggle (mobile)
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.getElementById('sidebar');

sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
});

// Close sidebar when clicking outside on mobile
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 600 &&
        !sidebar.contains(e.target) &&
        !sidebarToggle.contains(e.target)) {
        sidebar.classList.remove('open');
    }
});

// Settings panel
const btnSettings = document.getElementById('btnSettings');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsClose = document.getElementById('settingsClose');
const btnFactoryReset = document.getElementById('btnFactoryReset');
const btnSwitchStore = document.getElementById('btnSwitchStore');

if (btnSettings && settingsOverlay) {
    btnSettings.addEventListener('click', (e) => {
        e.preventDefault();
        settingsOverlay.classList.add('open');
    });

    settingsClose.addEventListener('click', () => {
        settingsOverlay.classList.remove('open');
    });

    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) {
            settingsOverlay.classList.remove('open');
        }
    });

    // Switch store
    if (btnSwitchStore) {
        btnSwitchStore.addEventListener('click', () => {
            clearStoreCode();
            settingsOverlay.classList.remove('open');
            location.reload();
        });
    }

    // Factory reset
    if (btnFactoryReset) {
        btnFactoryReset.addEventListener('click', async () => {
            if (!confirm('¿Estás seguro de que quieres borrar TODOS los datos de esta tienda en la nube?')) return;
            if (!confirm('Esta acción no se puede deshacer. ¿Confirmar restablecimiento de fábrica?')) return;

            try {
                await deleteAllStoreData();
            } catch (e) {
                console.error('Error deleting store data:', e);
            }

            settingsOverlay.classList.remove('open');
            location.reload();
        });
    }
}

// Changelog panel
const btnChangelog = document.getElementById('btnChangelog');
const changelogOverlay = document.getElementById('changelogOverlay');
const changelogClose = document.getElementById('changelogClose');
const changelogBody = document.getElementById('changelogBody');

if (btnChangelog && changelogOverlay) {
    const TYPE_ICONS = {
        new: '+',
        fix: '~',
        improve: '*',
        ui: '◆'
    };

    function renderChangelog() {
        changelogBody.innerHTML = CHANGELOG.map(session => `
            <div class="changelog-session">
                <div class="changelog-date">
                    ${session.date}
                    <span class="changelog-version">${session.version}</span>
                    ${session.tag ? `<span class="changelog-tag">${session.tag}</span>` : ''}
                </div>
                <ul class="changelog-entries">
                    ${session.entries.map(e => `
                        <li class="changelog-entry">
                            <span class="changelog-entry-icon type-${e.type}">${TYPE_ICONS[e.type] || '·'}</span>
                            ${e.text}
                        </li>
                    `).join('')}
                </ul>
            </div>
        `).join('');
    }

    btnChangelog.addEventListener('click', () => {
        renderChangelog();
        changelogOverlay.classList.add('open');
    });

    changelogClose.addEventListener('click', () => {
        changelogOverlay.classList.remove('open');
    });

    changelogOverlay.addEventListener('click', (e) => {
        if (e.target === changelogOverlay) {
            changelogOverlay.classList.remove('open');
        }
    });
}
