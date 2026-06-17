// =====================================================
// THE GOJOBSYNC — ADMIN PANEL — admin.js (FIXED v2)
// FIXES:
//   1. Real-time table refresh after every add/edit/delete/reset
//   2. Token fallback (sessionStorage + localStorage)
//   3. Better error display — shows actual server error messages
//   4. Modal properly resets on open
//   5. Status filter + search preserved after reload
//   6. Photo stored per-user correctly
// =====================================================

// ── STATE ─────────────────────────────────────────────
let USERS       = [];
let curTab      = 'all';
let editingId   = null;
let deletingId  = null;
let resetId     = null;
let photoDB     = {};
let toastTimer  = null;

// ── ROLE DISPLAY CONFIG ───────────────────────────────
const ROLE_LABELS = {
  recruiter:   'Recruiter',
  interviewer: 'Interviewer',
  hr:          'HR / Placement',
  client:      'Client',
  admin:       'Admin',
  itadmin:     'IT Admin',
};
const ROLE_BADGE_CLASS = {
  recruiter:   'b-recruiter',
  interviewer: 'b-interviewer',
  hr:          'b-hr',
  client:      'b-client',
  admin:       'b-admin',
  itadmin:     'b-admin',
};

// ── TOKEN HELPER (supports both session & local storage) ──
function getToken() {
  return sessionStorage.getItem('crm_token')
      || localStorage.getItem('crm_token')
      || '';
}

function authHeaders() {
  return {
    'Content-Type':    'application/json',
    'x-session-token': getToken()
  };
}

// ── INIT ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const token = getToken();
  if (!token) { window.location.href = 'login.html'; return; }

  const role = sessionStorage.getItem('crm_role') || localStorage.getItem('crm_role');
  if (role !== 'admin' && role !== 'itadmin') {
    window.location.href = 'login.html';
    return;
  }

  // Sidebar user info
  const name = sessionStorage.getItem('crm_user_name')
            || localStorage.getItem('crm_user_name')
            || 'Admin';
  const sbName = document.getElementById('sb-uname');
  const sbRole = document.getElementById('sb-urole');
  if (sbName) sbName.textContent = name;
  if (sbRole) sbRole.textContent = role === 'itadmin' ? 'IT Admin' : 'Super Admin';

  updateClock();
  setInterval(updateClock, 1000);
  loadUsers();
});

// ── CLOCK ─────────────────────────────────────────────
function updateClock() {
  const now  = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const el = document.getElementById('tb-datetime');
  if (el) {
    el.textContent = days[now.getDay()] + ', ' + now.getDate() + ' ' + mons[now.getMonth()] + ' ' + now.getFullYear()
      + '  ·  ' + pad(h) + ':' + pad(m) + ':' + pad(s) + ' ' + ap;
  }
}

// ── LOAD USERS FROM API ───────────────────────────────
async function loadUsers() {
  try {
    const res = await fetch('/api/users', { headers: authHeaders() });

    // Handle auth errors
    if (res.status === 401 || res.status === 403) {
      window.location.href = 'login.html';
      return;
    }

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || data.message || 'Failed to load users');
    }

    USERS = data.users || [];
    renderTable();
    const ticketSec = document.getElementById('sec-tickets');
    if (ticketSec) ticketSec.style.display = 'none';
    updateCounts();

  } catch (err) {
    console.error('loadUsers error:', err);
    showToast('Failed to load users: ' + err.message, 'err');
    USERS = [];
    renderTable();
    updateCounts();
  }
}

// ── TAB SWITCHING ─────────────────────────────────────
function setTab(tab, el) {
  curTab = tab;
  document.querySelectorAll('.sb-item').forEach(x => x.classList.remove('active'));
  if (el) el.classList.add('active');

  const titles = {
    all: 'All Users', recruiter: 'Recruiters', interviewer: 'Interviewers',
    hr: 'HR / Placement', client: 'Clients', admin: 'Admins'
  };
  const subs = {
    all: 'Manage all system accounts', recruiter: 'Talent acquisition recruiters',
    interviewer: 'Interview panel members', hr: 'HR and placement officers',
    client: 'Client portal users', admin: 'System administrators'
  };

  setEl('page-title',  titles[tab] || 'Users');
  setEl('table-title', titles[tab] || 'Users');
  setEl('table-sub',   subs[tab]   || 'Manage user accounts');

  // Clear filters when switching tabs
  const si = document.getElementById('search-input');
  const sf = document.getElementById('status-filter');
  if (si) si.value = '';
  if (sf) sf.value = '';

  const ticketSec = document.getElementById('sec-tickets');
  const userTbl = document.getElementById('user-tbl-card');
  if (tab === 'tickets') {
    if (ticketSec) ticketSec.style.display = 'block';
    if (userTbl) userTbl.style.display = 'none';
    loadTickets();
  } else {
    if (ticketSec) ticketSec.style.display = 'none';
    if (userTbl) userTbl.style.display = '';
    renderTable();
  }
}

// ── COUNTS / KPIs ─────────────────────────────────────
function updateCounts() {
  const roles = ['recruiter', 'interviewer', 'hr', 'client', 'admin'];

  setEl('cnt-all',   USERS.length);
  setEl('s-total',   USERS.length);
  setEl('s-active',  USERS.filter(u => u.status === 'active').length);

  roles.forEach(r => {
    const count = r === 'admin'
      ? USERS.filter(u => u.role === 'admin' || u.role === 'itadmin').length
      : USERS.filter(u => u.role === r).length;
    setEl('cnt-' + r, count);
  });

  setEl('s-rec', USERS.filter(u => u.role === 'recruiter').length);
  setEl('s-int', USERS.filter(u => u.role === 'interviewer').length);
  setEl('s-hr',  USERS.filter(u => u.role === 'hr').length);
  setEl('s-cli', USERS.filter(u => u.role === 'client').length);
  setEl('s-adm', USERS.filter(u => u.role === 'admin' || u.role === 'itadmin').length);
}

// ── AVATAR HTML ───────────────────────────────────────
function avatarHTML(u, size) {
  size = size || 36;
  const src     = photoDB[u.id] || u.img || u.photo || '';
  const initial = esc((u.name || '?').charAt(0).toUpperCase());
  if (src) {
    return `<div class="u-ava" style="width:${size}px;height:${size}px;">
      <img src="${esc(src)}" alt="${initial}" onerror="this.style.display='none';">
    </div>`;
  }
  return `<div class="u-ava" style="width:${size}px;height:${size}px;">${initial}</div>`;
}

// ── FORMAT DATE ───────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '—';
  try {
    const raw = String(iso).split('T')[0]; // handle datetime strings
    if (raw.includes('-')) {
      const [y, m, d] = raw.split('-');
      const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d + ' ' + mons[parseInt(m, 10) - 1] + ' ' + y;
    }
    return iso;
  } catch (e) { return iso; }
}

// ── RENDER TABLE ──────────────────────────────────────
function renderTable() {
  const q  = (document.getElementById('search-input')?.value  || '').toLowerCase().trim();
  const sf = (document.getElementById('status-filter')?.value || '');

  let data = USERS.filter(u => {
    // Tab filter
    if (curTab === 'admin') {
      if (u.role !== 'admin' && u.role !== 'itadmin') return false;
    } else if (curTab !== 'all') {
      if (u.role !== curTab) return false;
    }
    // Status filter
    if (sf && u.status !== sf) return false;
    // Search filter
    if (q && !(
      (u.name     || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.empid    || '').toLowerCase().includes(q)
    )) return false;
    return true;
  });

  const tb = document.getElementById('user-tbody');
  if (!tb) return;

  if (!data.length) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="8">No users found matching your search.</td></tr>`;
    updateCounts();
    return;
  }

  tb.innerHTML = data.map((u, i) => `
    <tr>
      <td style="color:var(--text-muted);font-size:12px;">${i + 1}</td>
      <td>
        <div class="user-ava-cell">
          ${avatarHTML(u, 36)}
          <div>
            <div class="u-name">${esc(u.name || '—')}</div>
            <div class="u-email">${esc(u.empid || '—')}</div>
          </div>
        </div>
      </td>
      <td><span class="badge ${ROLE_BADGE_CLASS[u.role] || ''}">${ROLE_LABELS[u.role] || u.role}</span></td>
      <td style="font-size:13px;font-family:monospace;color:var(--mid-blue);">${esc(u.username)}</td>
      <td style="font-size:12px;color:var(--text-tag);">${esc(u.empid || '—')}</td>
      <td style="font-size:12px;color:var(--text-tag);">${formatDate(u.doj)}</td>
      <td>
        <div class="status-cell">
          <span class="sdot ${u.status === 'active' ? 'sdot-active' : 'sdot-inactive'}"></span>
          <span style="font-size:12px;font-weight:600;color:${u.status === 'active' ? 'var(--suc)' : 'var(--text-muted)'};">
            ${u.status === 'active' ? 'Active' : 'Inactive'}
          </span>
        </div>
      </td>
      <td>
        <div class="action-btns">
          <button class="btn btn-edit btn-sm" onclick="openEditModal(${u.id})">&#9998; Edit</button>
          <button class="btn btn-pwd  btn-sm" onclick="openPwdModal(${u.id})">&#128274; Reset Pwd</button>
          <button class="btn btn-danger btn-sm" onclick="openDelModal(${u.id})">&#128465;</button>
        </div>
      </td>
    </tr>
  `).join('');

  updateCounts();
}

// ── OPEN ADD MODAL ────────────────────────────────────
function openAddModal() {
  editingId = null;
  setEl('modal-title',   'Add New User');

  const btn = document.getElementById('user-save-btn');
  if (btn) btn.textContent = 'Add User';

  // Clear all fields
  ['f-name','f-username','f-empid','f-pwd','f-pwd2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const roleEl   = document.getElementById('f-role');
  const statusEl = document.getElementById('f-status');
  const dojEl    = document.getElementById('f-doj');
  if (roleEl)   roleEl.value   = '';
  if (statusEl) statusEl.value = 'active';
  if (dojEl)    dojEl.value    = new Date().toISOString().split('T')[0];

  // Reset photo
  window._addPhotoData = null;
  const pf = document.getElementById('photo-file');
  if (pf) pf.value = '';
  resetPhotoPreview('?', null);

  // Reset password eye toggles
  resetPwdEye('f-pwd',  'f-pwd-eye');
  resetPwdEye('f-pwd2', 'f-pwd2-eye');
  clearAlert('modal-alert');

  openModal('user-modal');
}

// ── OPEN EDIT MODAL ───────────────────────────────────
function openEditModal(id) {
  const u = USERS.find(x => x.id === id);
  if (!u) { showToast('User not found.', 'err'); return; }

  editingId = id;
  setEl('modal-title', 'Edit — ' + u.name);

  const btn = document.getElementById('user-save-btn');
  if (btn) btn.textContent = 'Update User';

  // Populate fields
  const setVal = (elId, val) => {
    const el = document.getElementById(elId);
    if (el) el.value = val || '';
  };

  setVal('f-name',     u.name);
  setVal('f-role',     u.role);
  setVal('f-username', u.username);
  setVal('f-empid',    u.empid);
  setVal('f-status',   u.status || 'active');

  // Clear passwords (don't pre-fill for security)
  setVal('f-pwd',  '');
  setVal('f-pwd2', '');

  // Date of joining
  const dojEl = document.getElementById('f-doj');
  if (dojEl) {
    if (u.doj) {
      // Handle both ISO and display formats
      const raw = String(u.doj).split('T')[0];
      dojEl.value = raw.includes('-') ? raw : isoFromDisplay(u.doj);
    } else {
      dojEl.value = '';
    }
  }

  // Photo
  window._addPhotoData = null;
  const src = photoDB[id] || u.img || u.photo || '';
  resetPhotoPreview(u.name ? u.name.charAt(0) : '?', src || null);

  resetPwdEye('f-pwd',  'f-pwd-eye');
  resetPwdEye('f-pwd2', 'f-pwd2-eye');
  clearAlert('modal-alert');

  openModal('user-modal');
}

// ── HANDLE PHOTO UPLOAD ───────────────────────────────
function handlePhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    window._addPhotoData = e.target.result;
    resetPhotoPreview('', e.target.result);
  };
  reader.readAsDataURL(file);
}

function resetPhotoPreview(initial, src) {
  const initEl = document.getElementById('photo-initial');
  const imgEl  = document.getElementById('photo-img');
  if (!initEl || !imgEl) return;
  if (src) {
    initEl.textContent   = '';
    imgEl.src            = src;
    imgEl.style.display  = 'block';
  } else {
    initEl.textContent   = initial || '?';
    imgEl.src            = '';
    imgEl.style.display  = 'none';
  }
}

// ── SAVE USER (Add or Edit) ───────────────────────────
async function saveUser() {
  const name     = (document.getElementById('f-name')?.value     || '').trim();
  const role     = (document.getElementById('f-role')?.value     || '');
  const username = (document.getElementById('f-username')?.value || '').trim();
  const pwd      = (document.getElementById('f-pwd')?.value      || '');
  const pwd2     = (document.getElementById('f-pwd2')?.value     || '');
  const empid    = (document.getElementById('f-empid')?.value    || '').trim();
  const doj      = (document.getElementById('f-doj')?.value      || '');
  const status   = (document.getElementById('f-status')?.value   || 'active');

  // Validation
  if (!name)     { showAlert('modal-alert', 'Full name is required.', 'err');     return; }
  if (!role)     { showAlert('modal-alert', 'Please select a role.', 'err');      return; }
  if (!username) { showAlert('modal-alert', 'Username is required.', 'err');      return; }

  if (!editingId && !pwd) {
    showAlert('modal-alert', 'Password is required for new users.', 'err');
    return;
  }
  if (pwd && pwd.length < 4) {
    showAlert('modal-alert', 'Password must be at least 4 characters.', 'err');
    return;
  }
  if (pwd && pwd !== pwd2) {
    showAlert('modal-alert', 'Passwords do not match.', 'err');
    return;
  }

  const btn = document.getElementById('user-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const payload = {
      name,
      role,
      username,
      empid,
      doj,
      status,
      img: window._addPhotoData
        || (editingId ? (USERS.find(u => u.id === editingId)?.img || '') : ''),
    };
    if (pwd) payload.password = pwd;

    let res, data;

    if (editingId !== null) {
      // ── UPDATE existing user ──
      res  = await fetch(`/api/users/${editingId}`, {
        method:  'PUT',
        headers: authHeaders(),
        body:    JSON.stringify(payload)
      });
      data = await res.json();

      if (!data.success) {
        throw new Error(data.error || data.message || 'Update failed');
      }

      // Update local photo cache
      if (window._addPhotoData) {
        photoDB[editingId] = window._addPhotoData;
      }

      showToast('✓ ' + name + ' updated successfully!', 'ok');

    } else {
      // ── CREATE new user ──
      res  = await fetch('/api/users', {
        method:  'POST',
        headers: authHeaders(),
        body:    JSON.stringify(payload)
      });
      data = await res.json();

      if (!data.success) {
        throw new Error(data.error || data.message || 'Create failed');
      }

      if (window._addPhotoData && data.id) {
        photoDB[data.id] = window._addPhotoData;
      }

      showToast('✓ ' + name + ' added successfully!', 'ok');
    }

    closeModal('user-modal');

    // ── Reload users and refresh table in real time ──
    await loadUsers();

  } catch (err) {
    console.error('saveUser error:', err);
    showAlert('modal-alert', err.message || 'Something went wrong. Please try again.', 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = editingId ? 'Update User' : 'Add User';
    }
  }
}

// ── RESET PASSWORD MODAL ──────────────────────────────
function openPwdModal(id) {
  const u = USERS.find(x => x.id === id);
  if (!u) { showToast('User not found.', 'err'); return; }

  resetId = id;
  setEl('pwd-modal-title', 'Reset Password — ' + u.name);
  setEl('pwd-modal-sub',   (ROLE_LABELS[u.role] || u.role) + ' · ' + u.username);

  const np1 = document.getElementById('np-pwd');
  const np2 = document.getElementById('np-pwd2');
  if (np1) np1.value = '';
  if (np2) np2.value = '';

  resetPwdEye('np-pwd',  'np-pwd-eye');
  resetPwdEye('np-pwd2', 'np-pwd2-eye');
  clearAlert('pwd-alert');

  openModal('pwd-modal');
}

async function savePassword() {
  const p  = document.getElementById('np-pwd')?.value  || '';
  const p2 = document.getElementById('np-pwd2')?.value || '';

  if (!p)           { showAlert('pwd-alert', 'Please enter a new password.', 'err');             return; }
  if (p.length < 4) { showAlert('pwd-alert', 'Password must be at least 4 characters.', 'err'); return; }
  if (p !== p2)     { showAlert('pwd-alert', 'Passwords do not match.', 'err');                  return; }

  const btn = document.querySelector('#pwd-modal .btn-teal');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const res  = await fetch(`/api/users/${resetId}/password`, {
      method:  'PUT',
      headers: authHeaders(),
      body:    JSON.stringify({ password: p })
    });
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || data.message || 'Password reset failed');
    }

    const u = USERS.find(x => x.id === resetId);
    showToast('✓ Password updated for ' + (u?.name || 'user') + '!', 'ok');
    closeModal('pwd-modal');

    // Reload to reflect changes
    await loadUsers();

  } catch (err) {
    console.error('savePassword error:', err);
    showAlert('pwd-alert', err.message || 'Failed to reset password. Try again.', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Update Password'; }
  }
}

// ── FORGOT PASSWORD MODAL ─────────────────────────────
function openForgotModal() {
  const searchEl = document.getElementById('forgot-search');
  if (searchEl) searchEl.value = '';
  renderForgotList();
  openModal('forgot-modal');
}

function renderForgotList() {
  const q    = (document.getElementById('forgot-search')?.value || '').toLowerCase();
  const list = document.getElementById('forgot-list');
  if (!list) return;

  const filtered = USERS.filter(u =>
    !q ||
    (u.name     || '').toLowerCase().includes(q) ||
    (u.username || '').toLowerCase().includes(q) ||
    (u.empid    || '').toLowerCase().includes(q)
  );

  if (!filtered.length) {
    list.innerHTML = '<div style="padding:14px;font-size:12px;color:var(--text-muted);text-align:center;">No users found.</div>';
    return;
  }

  list.innerHTML = filtered.map(u => `
    <div class="forgot-item">
      <div class="forgot-user">
        ${avatarHTML(u, 32)}
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--dark-blue);">${esc(u.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${esc(u.username)} &nbsp;·&nbsp;
            <span class="badge ${ROLE_BADGE_CLASS[u.role] || ''}" style="font-size:10px;padding:1px 7px;">
              ${ROLE_LABELS[u.role] || u.role}
            </span>
          </div>
        </div>
      </div>
      <button class="btn btn-pwd btn-sm" onclick="forgotReset(${u.id})">&#128274; Reset</button>
    </div>
  `).join('');
}

function forgotReset(id) {
  closeModal('forgot-modal');
  openPwdModal(id);
}

// ── DELETE MODAL ──────────────────────────────────────
function openDelModal(id) {
  const u = USERS.find(x => x.id === id);
  if (!u) { showToast('User not found.', 'err'); return; }

  deletingId = id;
  setEl('del-user-name', u.name + ' (' + (ROLE_LABELS[u.role] || u.role) + ')');
  openModal('del-modal');
}

async function confirmDelete() {
  if (!deletingId) return;
  const u = USERS.find(x => x.id === deletingId);

  const btn = document.querySelector('#del-modal .btn-danger');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }

  try {
    const res  = await fetch(`/api/users/${deletingId}`, {
      method:  'DELETE',
      headers: authHeaders()
    });
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || data.message || 'Delete failed');
    }

    // Remove from local photo cache
    delete photoDB[deletingId];

    showToast('🗑️ ' + (u?.name || 'User') + ' deleted.', 'err');
    closeModal('del-modal');

    // Reload users and refresh table in real time
    await loadUsers();

  } catch (err) {
    console.error('confirmDelete error:', err);
    showToast(err.message || 'Delete failed. Try again.', 'err');
    closeModal('del-modal');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Yes, Delete'; }
  }
}

// ── PASSWORD EYE TOGGLE ───────────────────────────────
function togglePwd(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!inp) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    if (btn) btn.textContent = 'Hide';
  } else {
    inp.type = 'password';
    if (btn) btn.textContent = 'Show';
  }
}

function resetPwdEye(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (inp) inp.type = 'password';
  if (btn) btn.textContent = 'Show';
}

// ── MODAL HELPERS ─────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// ── ALERT HELPERS ─────────────────────────────────────
function showAlert(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = 'alert-strip ' + (type === 'err' ? 'alert-err' : 'alert-ok');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => { el.className = 'alert-strip'; }, 5000);
}

function clearAlert(id) {
  const el = document.getElementById(id);
  if (el) el.className = 'alert-strip';
}

// ── TOAST ─────────────────────────────────────────────
function showToast(msg, type) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = msg;
  t.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── UTILS ─────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function pad(n) { return String(n).padStart(2, '0'); }

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isoFromDisplay(s) {
  if (!s) return new Date().toISOString().split('T')[0];
  try {
    const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
    const parts  = s.trim().split(' ');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const mon = months[parts[1]];
      const yr  = parseInt(parts[2], 10);
      if (!isNaN(day) && mon !== undefined && !isNaN(yr)) {
        return new Date(yr, mon, day).toISOString().split('T')[0];
      }
    }
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  } catch (e) {}
  return new Date().toISOString().split('T')[0];
}

// ── LOGOUT ────────────────────────────────────────────
function logoutUser() {
  // Fire logout API (fire and forget)
  try {
    fetch('/api/auth/logout', {
      method:  'POST',
      headers: authHeaders()
    }).catch(() => {});
  } catch(e) {}

  // Clear ALL storage
  sessionStorage.clear();
  localStorage.clear();

  // Redirect to login immediately
  window.location.href = 'login.html';
}
// ── IT TICKETS ──────────────────────────────────────────
async function loadTickets() {
  try {
    const res = await fetch('/api/tickets', { headers: { 'x-session-token': getToken() } });
    const data = await res.json();
    const tbody = document.getElementById('tickets-tbody');
    if (!tbody) return;
    if (!data.tickets || data.tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888;">No tickets found</td></tr>';
      return;
    }
    tbody.innerHTML = data.tickets.map((t, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${t.raised_by_name || ''}</td>
        <td>${t.title || ''}</td>
        <td>${t.category || ''}</td>
        <td>${t.priority || ''}</td>
        <td><span style="padding:2px 10px;border-radius:20px;background:${t.status==='Open'?'#ffeaa7':t.status==='Resolved'?'#d4edda':'#e2e3e5'};color:#333;">${t.status || 'Open'}</span></td>
        <td style="font-size:12px;">${t.created_at ? new Date(t.created_at).toLocaleDateString('en-GB') : ''}</td>
        <td><button onclick="resolveTicket(${t.id})" style="padding:4px 12px;background:#1a3c5e;color:#fff;border:none;border-radius:6px;cursor:pointer;">Resolve</button></td>
      </tr>
    `).join('');
  } catch(e) {
    console.error('loadTickets error:', e);
  }
}

async function resolveTicket(id) {
  const response = prompt('Enter resolution message:');
  if (!response) return;
  try {
    await fetch(`/api/tickets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status: 'Resolved', response })
    });
    loadTickets();
  } catch(e) {
    console.error('resolveTicket error:', e);
  }
}


