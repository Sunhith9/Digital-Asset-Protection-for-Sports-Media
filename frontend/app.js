const API_BASE_URL = 'http://127.0.0.1:8000/api';

// --- STATE ---
let session = null;
let registerFiles = [];
let scanFileContainer = null;

// --- DOM Elements ---
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const navLinks = document.querySelectorAll('.nav-links li');
const views = document.querySelectorAll('.view-section');
const toastEl = document.getElementById('toast');

// --- INITIALIZE ---
document.addEventListener('DOMContentLoaded', () => {
    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        session = null;
        authContainer.classList.remove('hidden');
        appContainer.classList.add('hidden');
        document.getElementById('user-email').innerText = '';
        showToast('Logged out', 'success');
    });

    // App listeners
    setupNavigation();
    setupDragDrop('register', handleRegisterFileSelect);
    setupDragDrop('scan', handleScanFileSelect);
    document.getElementById('register-btn').addEventListener('click', submitRegistration);
    document.getElementById('scan-btn').addEventListener('click', submitScan);

    // Sidebar toggle (mobile)
    document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

    // Theme toggle
    initTheme();
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
});

// ========================
// AUTHENTICATION
// ========================
async function handleAuth() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    if (!email || !password) {
        showToast('Please fill in both fields', 'error');
        return;
    }

    // Show spinner
    authSubmitBtn.disabled = true;
    authSubmitBtn.innerHTML = '<span class="btn-spinner"></span> Signing in...';

    // Small delay to show the spinner animation
    await new Promise(r => setTimeout(r, 600));

    if (email === 'admin@sportsmedia.com' && password === 'password123') {
        session = {
            access_token: 'MOCK_TOKEN',
            user: { email: email }
        };
        showToast('Logged in successfully!', 'success');

        // Update UI with user info
        document.getElementById('user-email').innerText = email;
        const name = email.split('@')[0].replace(/[._]/g, ' ');
        document.getElementById('user-avatar').src =
            `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3b82f6&color=fff`;

        authContainer.classList.add('hidden');
        appContainer.classList.remove('hidden');
        loadAssets();
    } else {
        showToast('Invalid credentials. Use admin@sportsmedia.com / password123', 'error');
    }

    // Reset button
    authSubmitBtn.disabled = false;
    authSubmitBtn.innerHTML = 'Log In';
}

function getAuthHeaders() {
    const headers = {};
    if (session) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    return headers;
}

// ========================
// SIDEBAR (MOBILE)
// ========================
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('active');
}

// ========================
// THEME TOGGLE
// ========================
function initTheme() {
    const saved = localStorage.getItem('dap-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeButton(saved);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('dap-theme', next);
    updateThemeButton(next);
}

function updateThemeButton(theme) {
    const btn = document.getElementById('theme-toggle');
    if (theme === 'dark') {
        btn.innerHTML = '<i class="fa-solid fa-moon"></i> <span>Dark Mode</span>';
    } else {
        btn.innerHTML = '<i class="fa-solid fa-sun"></i> <span>Light Mode</span>';
    }
}

// ========================
// NAVIGATION
// ========================
function setupNavigation() {
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            const target = link.dataset.target;

            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            views.forEach(v => v.classList.add('hidden'));
            document.getElementById(target).classList.remove('hidden');

            if (target === 'dashboard') loadAssets();
            if (target === 'history-log') loadHistory();
            // Note: scraper-tool doesn't need to load data on view

            // Close sidebar on mobile after nav
            closeSidebar();
        });
    });
}

// ========================
// DRAG & DROP
// ========================
function setupDragDrop(prefix, callback) {
    const dropZone = document.getElementById(`${prefix}-drop-zone`);
    const fileInput = document.getElementById(`${prefix}-file-input`);

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            callback(e.dataTransfer.files, prefix);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            callback(e.target.files, prefix);
        }
    });
}

function handleRegisterFileSelect(fileList, prefix) {
    registerFiles = Array.from(fileList);
    showRegisterPreviews(prefix);
    document.getElementById(`${prefix}-btn`).classList.remove('hidden');
}

function handleScanFileSelect(fileList, prefix) {
    scanFileContainer = fileList[0];
    showPreview(scanFileContainer, prefix);
    document.getElementById(`${prefix}-btn`).classList.remove('hidden');
}

function showRegisterPreviews(prefix) {
    const previewArea = document.getElementById(`${prefix}-preview`);
    const dropZone = document.getElementById(`${prefix}-drop-zone`);

    dropZone.classList.add('hidden');
    previewArea.classList.remove('hidden');

    let html = '<div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;">';
    registerFiles.forEach(file => {
        const fileUrl = URL.createObjectURL(file);
        const isVideo = file.type.startsWith('video/');
        let mediaHtml = isVideo
            ? `<video src="${fileUrl}" style="height: 100px; width: auto; border-radius: 4px;" muted loop></video>`
            : `<img src="${fileUrl}" style="height: 100px; width: auto; border-radius: 4px;" alt="Preview">`;

        html += `<div style="text-align: center;">
            ${mediaHtml}
            <div style="font-size: 0.75rem; color: var(--text-muted); max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.name}</div>
        </div>`;
    });
    html += '</div>';

    html += `<button class="btn secondary" style="margin-top: 15px;" onclick="resetUpload('${prefix}')">Change Files</button>`;
    previewArea.innerHTML = html;
}

function showPreview(file, prefix) {
    const previewArea = document.getElementById(`${prefix}-preview`);
    const dropZone = document.getElementById(`${prefix}-drop-zone`);

    dropZone.classList.add('hidden');
    previewArea.classList.remove('hidden');

    const fileUrl = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');

    let mediaHtml = isVideo
        ? `<video src="${fileUrl}" controls autoplay muted loop></video>`
        : `<img src="${fileUrl}" alt="Preview">`;

    previewArea.innerHTML = `
        ${mediaHtml}
        <div class="preview-name">${file.name}</div>
        <button class="btn secondary" style="margin-top: 10px;" onclick="resetUpload('${prefix}')">Change File</button>
    `;
}

window.resetUpload = (prefix) => {
    document.getElementById(`${prefix}-drop-zone`).classList.remove('hidden');
    document.getElementById(`${prefix}-preview`).classList.add('hidden');
    document.getElementById(`${prefix}-btn`).classList.add('hidden');
    document.getElementById(`${prefix}-file-input`).value = '';

    if (prefix === 'register') registerFiles = [];
    if (prefix === 'scan') {
        scanFileContainer = null;
        document.getElementById('scan-results').innerHTML = `
            <h3>Scan Results</h3>
            <div class="results-container empty">
                <i class="fa-solid fa-shield"></i>
                <p>Upload media to interrogate database.</p>
            </div>
        `;
    }
};

// ========================
// REGISTER ASSET
// ========================
async function submitRegistration() {
    if (!registerFiles || registerFiles.length === 0) return;

    const btn = document.getElementById('register-btn');
    const ogText = btn.innerText;
    btn.innerHTML = '<span class="btn-spinner"></span> Creating pHash & Securing...';
    btn.disabled = true;

    const formData = new FormData();
    registerFiles.forEach(file => {
        formData.append('files', file);
    });

    try {
        const response = await fetch(`${API_BASE_URL}/upload`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            showToast(`Successfully registered ${data.assets.length} assets!`, 'success');
            resetUpload('register');
        } else {
            throw new Error(data.detail || 'Upload failed');
        }
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        btn.innerText = ogText;
        btn.disabled = false;
    }
}

// ========================
// SCAN ASSET
// ========================
async function submitScan() {
    if (!scanFileContainer) return;

    const btn = document.getElementById('scan-btn');
    const ogText = btn.innerText;
    btn.innerHTML = '<span class="btn-spinner"></span> Analyzing & Matching...';
    btn.disabled = true;

    document.getElementById('scan-results').innerHTML = `
        <h3>Scan Results</h3>
        <div class="results-container">
            <div class="loading-state">
                <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 3rem;"></i>
                <p style="margin-top:1rem;">Computing perceptual hash and querying database...</p>
            </div>
        </div>
    `;

    const formData = new FormData();
    formData.append('file', scanFileContainer);

    try {
        const response = await fetch(`${API_BASE_URL}/scan`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            renderScanResults(data);
            showToast('Scan complete.', 'success');
        } else {
            throw new Error(data.detail || 'Scan failed');
        }
    } catch (error) {
        showToast(error.message, 'error');
        document.getElementById('scan-results').innerHTML = `
            <h3>Scan Results</h3>
            <div class="results-container empty">
                <i class="fa-solid fa-circle-exclamation" style="color:var(--danger)"></i>
                <p>${error.message}</p>
            </div>
        `;
    } finally {
        btn.innerText = ogText;
        btn.disabled = false;
    }
}

function renderScanResults(data) {
    const resultsArea = document.getElementById('scan-results');

    if (!data.matches || data.matches.length === 0) {
        resultsArea.innerHTML = `
            <h3>Scan Results</h3>
            <div class="results-container" style="align-items: center; justify-content: center; text-align: center;">
                <i class="fa-solid fa-check-circle" style="font-size: 3rem; color: var(--success); margin-bottom: 1rem;"></i>
                <h4>No Matches Found</h4>
                <p style="color: var(--text-muted);">This asset does not appear to be an unauthorized copy of your registered media.</p>
            </div>
        `;
        return;
    }

    let matchesHtml = data.matches.map(match => {
        const confNum = parseInt(match.confidence);
        let badgeClass = 'med';
        if (confNum > 80) badgeClass = 'high';
        else if (confNum < 50) badgeClass = 'low';

        return `
            <div class="match-card ${match.violation ? 'violation' : ''}">
                <div style="width: 50px; height: 50px; background: rgba(255,255,255,0.1); border-radius: 4px; display:flex; align-items:center; justify-content:center;">
                    <i class="fa-solid ${match.asset.media_type === 'video' ? 'fa-video' : 'fa-image'}"></i>
                </div>
                <div class="match-info">
                    <div class="match-name">${match.asset.filename}</div>
                    <div class="match-score">Similarity: ${match.confidence} | HD: ${match.distance}</div>
                </div>
                <div class="score-badge ${badgeClass}">${match.confidence} Match</div>
            </div>
        `;
    }).join('');

    resultsArea.innerHTML = `
        <h3>Scan Results</h3>
        <p style="color:var(--danger); margin-bottom:1rem; font-weight:600;">
            <i class="fa-solid fa-triangle-exclamation"></i> Identified ${data.matches_found} potential violation(s)!
        </p>
        <div class="results-list" style="max-height: 400px; overflow-y: auto;">
            ${matchesHtml}
        </div>
    `;
}

// ========================
// LOAD & DELETE ASSETS
// ========================
async function loadAssets() {
    const container = document.getElementById('assets-container');
    container.innerHTML = `
        <div class="loading-state">
            <i class="fa-solid fa-circle-notch fa-spin"></i>
            <p>Loading assets...</p>
        </div>
    `;

    try {
        const response = await fetch(`${API_BASE_URL}/assets`, {
            headers: getAuthHeaders()
        });
        const result = await response.json();

        if (!response.ok) throw new Error(result.detail || 'Failed');

        let assets = result.data || [];

        document.getElementById('total-assets').innerText = assets.length;

        if (assets.length === 0) {
            container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">No assets registered yet.</div>`;
            return;
        }

        container.innerHTML = assets.map(asset => `
            <div class="asset-card">
                <button class="asset-delete-btn" onclick="deleteAsset('${asset.id}')" title="Delete asset">
                    <i class="fa-solid fa-trash"></i>
                </button>
                <div style="height: 150px; background: rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center; border-bottom: 1px solid var(--glass-border); overflow: hidden;">
                    ${asset.thumbnail_url
                ? `<img src="${API_BASE_URL.replace('/api', '')}${asset.thumbnail_url}" style="width: 100%; height: 100%; object-fit: cover;">`
                : `<i class="fa-solid ${asset.media_type === 'video' ? 'fa-video' : 'fa-image'}" style="font-size: 3rem; color: var(--primary);"></i>`
            }
                </div>
                <div class="asset-details">
                    <div class="asset-name" title="${asset.filename}">${asset.filename}</div>
                    <div class="asset-meta">
                        <span>${new Date(asset.created_at).toLocaleDateString()}</span>
                        <span><i class="fa-solid fa-fingerprint"></i> Hashes: ${asset.hashes.length}</span>
                    </div>
                </div>
            </div>
        `).join('');

    } catch (error) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--danger);">Failed to load assets: ${error.message}</div>`;
    }
}

window.deleteAsset = async (assetId) => {
    if (!confirm('Are you sure you want to delete this asset?')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (response.ok) {
            showToast('Asset deleted successfully.', 'success');
            loadAssets();
        } else {
            const data = await response.json();
            throw new Error(data.detail || 'Delete failed');
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
};

// ========================
// AUTOMATED SCRAPER
// ========================
async function startScraping() {
    const url = document.getElementById('scraper-url').value.trim();
    if (!url) return;

    const btn = document.getElementById('scraper-btn');
    const ogText = btn.innerText;
    btn.innerHTML = '<span class="btn-spinner"></span> Dispatching Worker...';
    btn.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/scraper/jobs`, {
            method: 'POST',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url })
        });

        const data = await response.json();
        if (response.ok) {
            showToast(data.message, 'success');
            document.getElementById('scraper-url').value = '';
        } else {
            throw new Error(data.detail || 'Failed to start scraper');
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.innerText = ogText;
        btn.disabled = false;
    }
}

// ========================
// HELPERS
// ========================
async function loadHistory() {
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = '<tr><td colspan="5" style="padding: 2rem; text-align: center;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</td></tr>';

    try {
        const response = await fetch(`${API_BASE_URL}/history`, {
            headers: getAuthHeaders()
        });
        const result = await response.json();

        if (!response.ok) throw new Error(result.detail || 'Failed to load history');

        const history = result.data || [];
        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="padding: 2rem; text-align: center; color: var(--text-muted);">No scan history found.</td></tr>';
            return;
        }

        tbody.innerHTML = history.map(item => {
            const date = new Date(item.timestamp).toLocaleString();
            let resultBadge = '<span class="score-badge low" style="padding: 0.3rem 0.6rem;"><i class="fa-solid fa-check"></i> Clean</span>';
            if (item.matches_found > 0) {
                resultBadge = `<span class="score-badge high" style="padding: 0.3rem 0.6rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${item.matches_found} Violation(s)</span>`;
            }

            return `
                <tr style="border-bottom: 1px solid var(--glass-border); transition: background 0.2s;">
                    <td style="padding: 1rem; color: var(--text-muted);">${date}</td>
                    <td style="padding: 1rem;">
                        <span style="background: rgba(255,255,255,0.1); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">
                            ${item.source || 'Manual Scan'}
                        </span>
                    </td>
                    <td style="padding: 1rem; font-weight: 500;">${item.suspect_filename}</td>
                    <td style="padding: 1rem;">${item.matches_found}</td>
                    <td style="padding: 1rem;">${resultBadge}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="padding: 2rem; text-align: center; color: var(--danger);">${error.message}</td></tr>`;
    }
}

function showToast(message, type = 'success') {
    toastEl.querySelector('span').innerText = message;
    const icon = toastEl.querySelector('i');
    icon.className = `icon fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`;
    toastEl.className = `toast ${type}`;

    setTimeout(() => {
        toastEl.classList.add('hidden');
    }, 4000);
}
