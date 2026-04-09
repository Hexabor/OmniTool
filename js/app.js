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

// Changelog panel
const btnChangelog = document.getElementById('btnChangelog');
const changelogOverlay = document.getElementById('changelogOverlay');
const changelogClose = document.getElementById('changelogClose');
const changelogBody = document.getElementById('changelogBody');

if (btnChangelog && changelogOverlay) {
    const TYPE_ICONS = {
        new: '+',
        fix: '~',
        improve: '*'
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
