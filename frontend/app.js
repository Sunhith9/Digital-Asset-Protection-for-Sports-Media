const API_BASE_URL = window.location.origin + '/api';

// --- STATE ---
let session = null;
let registerFiles = [];
let scanFileContainer = null;
let currentPage = 1;
const assetsPerPage = 8;

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
        showToast('Logged out', 'info');
    });

    // App listeners
    setupNavigation();
    setupDragDrop('register', handleRegisterFileSelect);
    setupDragDrop('scan', handleScanFileSelect);
    document.getElementById('register-btn').addEventListener('click', submitRegistration);
    document.getElementById('scan-btn').addEventListener('click', submitScan);

    // Sidebar toggle (mobile)
    const sidebar = document.querySelector('.sidebar');
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });

    // Theme toggle
    initTheme();
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
});

function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (session && session.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    return headers;
}

// ========================
// AUTHENTICATION
// ========================
async function handleAuth() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    if (!email || !password) {
        showToast('Identification required', 'error');
        return;
    }

    authSubmitBtn.disabled = true;
    authSubmitBtn.innerHTML = 'Authenticating...';

    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        let data = {};
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            data = await response.json();
        } else {
            const text = await response.text();
            if (!response.ok) {
                throw new Error(`Server error (${response.status}): ${text || 'Unknown error'}`);
            }
        }

        if (response.ok) {
            session = {
                access_token: data.access_token,
                user: data.user
            };
            showToast('Login successful', 'success');

            const userEmailEl = document.getElementById('user-email');
            if (userEmailEl) userEmailEl.innerText = data.user?.email || email;
            
            const name = (data.user?.email || email).split('@')[0].replace(/[._]/g, ' ');
            const avatarEl = document.getElementById('user-avatar');
            if (avatarEl) {
                avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=14b8a6&color=fff`;
            }

            authContainer.classList.add('hidden');
            appContainer.classList.remove('hidden');

            currentPage = 1;
            loadAssets();
        } else {
            throw new Error(data.detail || 'Authorization failed');
        }
    } catch (error) {
        console.error('Auth Error:', error);
        const msg = error.message.includes('Unexpected end of JSON input') 
            ? 'Server returned an empty response. Please try again.' 
            : (error.message === 'Failed to fetch' ? 'Cannot connect to server. Please ensure the backend is running.' : error.message);
        showToast(msg, 'error');
    }

    authSubmitBtn.disabled = false;
    authSubmitBtn.innerHTML = '<span>Sign In</span><i class="fa-solid fa-arrow-right"></i>';
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

            // Robust view switching
            views.forEach(v => {
                v.classList.add('hidden');
                v.style.opacity = '1'; // Ensure no visibility conflicts
            });

            const nextView = document.getElementById(target);
            if (nextView) {
                nextView.classList.remove('hidden');
                nextView.style.animation = 'fadeIn 0.3s ease-out';
            }

            if (target === 'dashboard') loadAssets();
            if (target === 'history-log') loadHistory();

            // Close sidebar on mobile after navigation
            document.querySelector('.sidebar').classList.remove('open');
        });
    });
}

// ========================
// ASSET MANAGEMENT
// ========================
async function loadAssets() {
    const list = document.getElementById('assets-list');
    if (!list) return;
    list.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem;"><i class="fa-solid fa-spinner fa-spin fa-2xl"></i></div>';

    try {
        const response = await fetch(`${API_BASE_URL}/assets?page=${currentPage}&limit=${assetsPerPage}`, {
            headers: getAuthHeaders()
        });
        
        let data = {};
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            data = await response.json();
        } else {
            if (!response.ok) throw new Error(`Status ${response.status}`);
        }

        // Match backend keys: data.data and data.pagination.total_items
        const assets = data.data || [];
        const pagination = data.pagination || {};
        const total = (typeof pagination.total_items === 'number') ? pagination.total_items : assets.length;

        document.getElementById('total-assets').innerText = total;
        document.getElementById('total-violations').innerText = 0;

        renderAssets(assets);
        renderPagination(total, pagination.page || 1, pagination.limit || assetsPerPage);
    } catch (err) {
        showToast('Sync error', 'error');
    }
}

function renderAssets(assets) {
    const list = document.getElementById('assets-list');
    if (!assets || assets.length === 0) {
        list.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:4rem; color:var(--text-dim);">No assets registered.</div>';
        return;
    }

    list.innerHTML = assets.map(asset => {
        const thumbSrc = asset.thumbnail || asset.url || '';
        const imgTag = thumbSrc
            ? `<img src="${thumbSrc}" alt="${asset.filename || 'Asset'}" onerror="this.style.display='none'">`
            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-dim);"><i class='fa-solid fa-image fa-2x'></i></div>`;

        let dateStr = 'Unknown';
        if (asset.timestamp) {
            const d = typeof asset.timestamp === 'number' ? new Date(asset.timestamp * 1000) : new Date(asset.timestamp);
            if (!isNaN(d)) dateStr = d.toLocaleDateString();
        } else if (asset.created_at) {
            const d = new Date(asset.created_at);
            if (!isNaN(d)) dateStr = d.toLocaleDateString();
        }

        return `
        <div class="asset-card glass-panel">
            <button class="asset-delete-btn" onclick="deleteAsset('${asset.id}')" 
                    style="position:absolute; top:8px; right:8px; width:24px; height:24px; border-radius:50%; background:rgba(239,68,68,0.1); color:var(--danger); border:none; cursor:pointer; z-index:10;">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <div class="asset-thumb-container">
                ${imgTag}
            </div>
            <div class="asset-details">
                <div class="asset-name" style="font-weight:600; margin-bottom:0.5rem; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${asset.filename || 'Untitled'}</div>
                <div style="font-size:0.75rem; color:var(--text-dim);">${dateStr}</div>
            </div>
        </div>`;
    }).join('');
}

function renderPagination(total, page, limit) {
    const container = document.getElementById('pagination-controls');
    const totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button class="btn ${i === page ? 'primary' : 'secondary'}" 
                        style="padding: 0.4rem 0.8rem; margin: 0 2px;"
                        onclick="changePage(${i})">${i}</button>`;
    }
    container.innerHTML = html;
}

window.changePage = (page) => {
    currentPage = page;
    loadAssets();
};

window.deleteAsset = async (assetId) => {
    if (!confirm('Permanently delete fingerprint?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (response.ok) {
            showToast('Asset purged', 'success');
            loadAssets();
        }
    } catch (err) { showToast('Sync error', 'error'); }
};

// ========================
// UPLOAD & SCAN
// ========================
function setupDragDrop(prefix, callback) {
    const zone = document.getElementById(`${prefix}-drop-zone`);
    const input = document.getElementById(`${prefix}-file-input`);
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--accent-primary)'; });
    zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.style.borderColor = '';
        callback(e.dataTransfer.files);
    });
    input.addEventListener('change', (e) => callback(e.target.files));
}

function handleRegisterFileSelect(files) {
    registerFiles = Array.from(files);
    const preview = document.getElementById('register-preview');
    const btn = document.getElementById('register-btn');
    if (!preview || !btn) return;

    preview.classList.remove('hidden');
    btn.classList.remove('hidden');
    preview.innerHTML = registerFiles.map(f => `<div style="padding:4px; border:1px solid var(--glass-border); border-radius:4px;"><img src="${URL.createObjectURL(f)}" style="width:100%; height:80px; object-fit:cover;"></div>`).join('');
}

async function submitRegistration() {
    const btn = document.getElementById('register-btn');
    btn.disabled = true;
    const formData = new FormData();
    registerFiles.forEach(f => formData.append('files', f));

    try {
        const response = await fetch(`${API_BASE_URL}/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` },
            body: formData
        });
        if (response.ok) {
            showToast('Registration successful', 'success');
            registerFiles = [];
            btn.classList.add('hidden');
            document.getElementById('register-preview').classList.add('hidden');
            document.querySelector('[data-target="dashboard"]').click();
        }
    } catch (err) { showToast('Upload error', 'error'); }
    btn.disabled = false;
}

function handleScanFileSelect(files) {
    if (files.length === 0) return;
    scanFileContainer = files[0];
    const preview = document.getElementById('scan-preview');
    const btn = document.getElementById('scan-btn');
    preview.classList.remove('hidden');
    btn.classList.remove('hidden');
    preview.innerHTML = `<img src="${URL.createObjectURL(scanFileContainer)}" style="max-height:150px; border-radius:8px;">`;
}

async function submitScan() {
    if (!scanFileContainer) return;
    const btn = document.getElementById('scan-btn');
    const threshold = document.getElementById('similarity-threshold').value;
    const container = document.getElementById('scan-results-container');

    btn.disabled = true;
    container.innerHTML = '<div style="text-align:center; padding:2rem;"><i class="fa-solid fa-spinner fa-spin fa-xl"></i></div>';

    const formData = new FormData();
    formData.append('file', scanFileContainer);

    try {
        const response = await fetch(`${API_BASE_URL}/scan?threshold=${threshold}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` },
            body: formData
        });
        const data = await response.json();
        if (response.ok) {
            renderScanResults(data.matches);
        }
    } catch (err) { showToast('Scan error', 'error'); }
    btn.disabled = false;
}

function renderScanResults(matches) {
    const container = document.getElementById('scan-results-container');
    if (matches.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--success);">No violations found.</div>';
        return;
    }
    container.innerHTML = matches.map(m => `
        <div style="display:flex; gap:12px; padding:12px; border:1px solid var(--danger); border-radius:8px; margin-bottom:8px; background:rgba(239,68,68,0.05);">
            <img src="${m.asset.thumbnail || m.asset.url}" style="width:50px; height:50px; border-radius:4px; object-fit:cover;">
            <div>
                <div style="font-weight:600; font-size:0.9rem;">${m.asset.filename}</div>
                <div style="font-size:0.75rem; color:var(--text-dim);">Distance: ${m.distance}</div>
            </div>
        </div>
    `).join('');
}

async function loadHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:2rem;"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';
    try {
        const response = await fetch(`${API_BASE_URL}/history`, { headers: getAuthHeaders() });
        const data = await response.json();
        list.innerHTML = data.reverse().map(e => `
            <tr style="border-bottom:1px solid var(--glass-border);">
                <td style="padding:12px; font-size:0.75rem; color:var(--text-dim);">${e.timestamp}</td>
                <td style="padding:12px;"><span style="font-size:0.7rem; font-weight:700;">${e.type}</span></td>
                <td style="padding:12px; font-size:0.85rem;">${e.url || e.target || '-'}</td>
                <td style="padding:12px; font-weight:700; color:${e.status === 'VIOLATION' ? 'var(--danger)' : 'var(--success)'};">${e.status || e.outcome}</td>
            </tr>
        `).join('');
    } catch (err) { list.innerHTML = ''; }
}

async function startScraping() {
    const url = document.getElementById('scraper-url').value;
    const btn = document.getElementById('scraper-btn');
    if (!url) return;
    btn.disabled = true;
    try {
        const response = await fetch(`${API_BASE_URL}/scraper/jobs`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ url })
        });
        if (response.ok) {
            showToast('Sentinel deployed', 'success');
            document.getElementById('scraper-url').value = '';
        }
    } catch (err) { showToast('Deployment error', 'error'); }
    btn.disabled = false;
}

function showToast(message, type = 'success') {
    toastEl.querySelector('span').innerText = message;
    toastEl.className = `toast ${type}`;
    toastEl.classList.remove('hidden');
    setTimeout(() => toastEl.classList.add('hidden'), 3000);
}

function initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeUI(saved);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const target = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', target);
    localStorage.setItem('theme', target);
    updateThemeUI(target);
}

function updateThemeUI(theme) {
    const btn = document.getElementById('theme-toggle');
    const icon = btn.querySelector('i');
    if (theme === 'dark') { icon.className = 'fa-solid fa-sun'; }
    else { icon.className = 'fa-solid fa-moon'; }
}

// Password visibility toggle
function togglePasswordVisibility() {
    const input = document.getElementById('auth-password');
    const eye = document.getElementById('password-eye');
    if (input.type === 'password') {
        input.type = 'text';
        eye.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password';
        eye.className = 'fa-solid fa-eye';
    }
}
