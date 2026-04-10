// === Store gate ===
const storeGate = document.getElementById('storeGate');
const storeSelect = document.getElementById('storeSelect');
const storePassword = document.getElementById('storePassword');
const storeError = document.getElementById('storeError');
const storeSubmit = document.getElementById('storeSubmit');
const adminSubmit = document.getElementById('adminSubmit');

let _isAdmin = false;

// Populate dropdown
if (storeSelect) {
    STORES.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        storeSelect.appendChild(opt);
    });
}

function showApp() {
    if (storeGate) storeGate.classList.remove('active');
    const storeNameEl = document.getElementById('settingsStoreName');
    if (storeNameEl) storeNameEl.textContent = _isAdmin ? 'ADMINISTRADOR' : (getStoreCode() || '');
    window.dispatchEvent(new Event('storeReady'));
}

function showStoreGate() {
    if (storeGate) storeGate.classList.add('active');
}

function showError(msg) {
    if (storeError) {
        storeError.textContent = msg;
        storeError.style.display = msg ? '' : 'none';
    }
}

// Store login
if (storeSubmit) {
    storeSubmit.addEventListener('click', async () => {
        showError('');
        const store = storeSelect ? storeSelect.value : '';
        const pwd = storePassword ? storePassword.value.trim() : '';

        if (!store) { showError('Selecciona una tienda'); return; }
        if (!pwd) { showError('Introduce la contraseña'); return; }

        try {
            const storeDoc = await db.collection('stores').doc(store).get();
            if (storeDoc.exists && storeDoc.data().password) {
                // Store has a password — validate
                if (storeDoc.data().password !== pwd) {
                    showError('Contraseña incorrecta');
                    return;
                }
            } else {
                // First login — set password
                await db.collection('stores').doc(store).set({
                    password: pwd,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
            // Record activity
            await db.collection('stores').doc(store).set({
                lastAccess: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            setStoreCode(store);
            showApp();
        } catch (e) {
            console.error('Login error:', e);
            showError('Error de conexión');
        }
    });
}

// Password enter key
if (storePassword) {
    storePassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') storeSubmit.click();
    });
}

// Admin login
if (adminSubmit) {
    adminSubmit.addEventListener('click', () => {
        const pwd = prompt('Contraseña de administrador:');
        if (pwd === null) return;
        if (pwd !== ADMIN_PASSWORD) {
            alert('Contraseña incorrecta');
            return;
        }
        _isAdmin = true;
        setStoreCode('__ADMIN__');
        showApp();
        showAdminPanel();
    });
}

// Check if store is already selected
if (getStoreCode() && getStoreCode() !== '__ADMIN__') {
    showApp();
} else {
    clearStoreCode();
    showStoreGate();
}

// === Admin panel ===
async function showAdminPanel() {
    const settingsOverlay = document.getElementById('settingsOverlay');
    if (!settingsOverlay) return;

    // Build admin view in settings body
    const body = settingsOverlay.querySelector('.settings-body');
    if (!body) return;

    body.innerHTML = `
        <div class="settings-section">
            <h3>Panel de administración</h3>
            <p class="settings-hint">Todas las tiendas registradas y su actividad.</p>
            <div id="adminStoreList" class="admin-store-list">Cargando...</div>
        </div>
    `;

    settingsOverlay.classList.add('open');

    // Load all stores from Firestore
    try {
        const snap = await db.collection('stores').get();
        const list = document.getElementById('adminStoreList');
        if (!list) return;

        const storeData = [];
        snap.forEach(doc => {
            if (doc.id === '__ADMIN__') return;
            const d = doc.data();
            storeData.push({
                name: doc.id,
                password: d.password || '—',
                lastAccess: d.lastAccess ? d.lastAccess.toDate() : null,
                createdAt: d.createdAt ? d.createdAt.toDate() : null
            });
        });

        // Sort: stores with data first, then alphabetically
        storeData.sort((a, b) => a.name.localeCompare(b.name, 'es'));

        // Build the registered stores
        const registered = storeData.filter(s => s.password !== '—');
        const unused = STORES.filter(name => !storeData.find(s => s.name === name));

        let html = '';

        if (registered.length > 0) {
            html += '<table class="admin-table"><thead><tr><th>Tienda</th><th>Contraseña</th><th>Último acceso</th><th></th></tr></thead><tbody>';
            for (const s of registered) {
                const lastStr = s.lastAccess
                    ? s.lastAccess.toLocaleDateString('es-ES') + ' ' + s.lastAccess.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                    : '—';
                html += `<tr>
                    <td class="admin-store-name">${s.name}</td>
                    <td><code class="admin-pwd">${s.password}</code></td>
                    <td class="admin-date">${lastStr}</td>
                    <td><button class="btn btn-danger btn-sm admin-delete" data-store="${s.name}">Borrar</button></td>
                </tr>`;
            }
            html += '</tbody></table>';
        }

        if (unused.length > 0) {
            html += `<p class="admin-unused-title">Sin registrar (${unused.length})</p>`;
            html += `<p class="admin-unused-list">${unused.join(', ')}</p>`;
        }

        list.innerHTML = html;

        // Bind delete buttons
        list.querySelectorAll('.admin-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const storeName = btn.getAttribute('data-store');
                if (!confirm(`¿Borrar TODOS los datos de "${storeName}"?`)) return;
                if (!confirm('Esta acción no se puede deshacer. ¿Confirmar?')) return;

                try {
                    // Delete modules subcollection
                    const modules = await db.collection('stores').doc(storeName).collection('modules').get();
                    const batch = db.batch();
                    modules.forEach(doc => batch.delete(doc.ref));
                    batch.delete(db.collection('stores').doc(storeName));
                    await batch.commit();
                    btn.closest('tr').remove();
                } catch (e) {
                    console.error('Delete error:', e);
                    alert('Error al borrar');
                }
            });
        });

    } catch (e) {
        console.error('Admin load error:', e);
        const list = document.getElementById('adminStoreList');
        if (list) list.textContent = 'Error al cargar datos';
    }
}

// Sidebar toggle (mobile)
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.getElementById('sidebar');

sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
});

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
        if (_isAdmin) {
            showAdminPanel();
        } else {
            settingsOverlay.classList.add('open');
        }
    });

    settingsClose.addEventListener('click', () => {
        settingsOverlay.classList.remove('open');
    });

    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) {
            settingsOverlay.classList.remove('open');
        }
    });

    if (btnSwitchStore) {
        btnSwitchStore.addEventListener('click', () => {
            clearStoreCode();
            settingsOverlay.classList.remove('open');
            location.reload();
        });
    }

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
