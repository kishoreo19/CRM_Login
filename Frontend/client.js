// =====================================================
// THE GOJOBSYNC — CLIENT DASHBOARD — client.js (v3 FIXED)
// FIXES:
//   1. All Clients: removed Work Orders column,
//      added Date Posted + Last Date to Apply
//   2. Action buttons (View / Edit / Delete) now work
//   3. Interview Scheduled: removed Interview Location
//      and Client/Company columns; date always visible;
//      old scheduled data always loaded from DB
//   4. Ongoing Interviews: correctly fetches from
//      /api/clients/ongoing-interviews (all recruiters)
//   5. Feedbacks: correctly fetches from dashboard-stats
//      feedbackPending array with all fields
// =====================================================

// ── SESSION ───────────────────────────────────────────
function getToken() { return sessionStorage.getItem('crm_token') || ''; }
function getHeaders() {
  return { 'Content-Type': 'application/json', 'x-session-token': getToken() };
}

// ── STATE ─────────────────────────────────────────────
let CLIENTS        = [];
let WORK_ORDERS    = [];
let INTERVIEWS     = [];
let ONGOING        = [];
let FEEDBACK_LIST  = [];
let COMPLETED      = [];
let editingClientId    = null;
let editingWorkOrderId = null;
let actionInterviewId  = null;
let deletingType       = null;
let deletingId         = null;
let completedFilter    = 'all';
let toastTm            = null;
let pollingInterval    = null;

// ── INIT ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  if (!getToken()) { window.location.href = 'login.html'; return; }

  updateClock();
  setInterval(updateClock, 1000);

  await loadAllData();
  renderAll();
  updateSidebarCounts();
  showView('dashboard');

  // Real-time polling every 8 seconds
  pollingInterval = setInterval(async () => {
    await loadDashboardStats();
    await loadTodayInterviews();
    await loadOngoingInterviews();
    updateSidebarCounts();
    const activeView = document.querySelector('.view.active');
    if (activeView) {
      const id = activeView.id.replace('view-', '');
      if (id === 'scheduled')  renderScheduledTable(INTERVIEWS);
      if (id === 'ongoing')    renderOngoingTable(ONGOING);
      if (id === 'feedbacks')  renderFeedbackTable(FEEDBACK_LIST);
      if (id === 'dashboard')  renderDashboard();
    }
  }, 8000);

  document.addEventListener('click', e => {
    const wrap = document.getElementById('profile-wrap');
    if (wrap && !wrap.contains(e.target)) closeProfileDrop();
  });
});

// ── LOAD DATA ─────────────────────────────────────────
async function loadAllData() {
  await Promise.all([
    loadClients(),
    loadDashboardStats(),
    loadTodayInterviews(),
    loadOngoingInterviews()
  ]);
}

async function loadClients() {
  try {
    const res  = await fetch('/api/clients', { headers: { 'x-session-token': getToken() } });
    const data = await res.json();
    if (data.success) CLIENTS = data.clients || [];
  } catch(e) { console.error('Load clients:', e); }
}

async function loadDashboardStats() {
  try {
    const res  = await fetch('/api/clients/dashboard-stats', { headers: { 'x-session-token': getToken() } });
    const data = await res.json();
    if (data.success) {
      setEl('k-total-clients', data.totalClients || 0);
      setEl('k-openings',      data.currentOpenings || 0);
      setEl('k-placed',        data.placedCandidates || 0);
      setEl('k-bounced',       data.bouncedWorkOrders || 0);
      setEl('k-scheduled',     data.todayScheduled || 0);
      setEl('k-ongoing',       data.ongoingInterviews || 0);
      setEl('k-placed-ps',     data.placedCandidates || 0);

      // ── FEEDBACK: always reload from dashboard-stats ──
      if (data.feedbackPending && data.feedbackPending.length) {
        FEEDBACK_LIST = data.feedbackPending;
      } else {
        FEEDBACK_LIST = [];
      }
      setEl('k-feedbacks',     FEEDBACK_LIST.length);
      setEl('sb-cnt-feedbacks', FEEDBACK_LIST.length);
      renderFeedbackTable(FEEDBACK_LIST);
      updateFollowupBadge();
    }
  } catch(e) { console.error('Dashboard stats:', e); }
}

// ── LOAD SCHEDULED INTERVIEWS ─────────────────────────
// Always fetches ALL scheduled candidates (all recruiters)
// Falls back to /api/candidates?status=scheduled if needed
async function loadTodayInterviews() {
  try {
    const res  = await fetch('/api/clients/today-interviews', { headers: { 'x-session-token': getToken() } });
    const data = await res.json();
    if (data.success && Array.isArray(data.interviews)) {
      INTERVIEWS = data.interviews;
      renderScheduledTable(INTERVIEWS);
      setEl('sb-cnt-scheduled', INTERVIEWS.length);
      updateFollowupBadge();
      return;
    }
  } catch(e) { /* fall through to fallback */ }

  // Fallback: load from general candidates endpoint
  try {
    const res  = await fetch('/api/candidates', { headers: { 'x-session-token': getToken() } });
    const data = await res.json();
    if (data.candidates) {
      const rows = data.candidates.filter(c => c.status === 'scheduled');
      INTERVIEWS = rows.map(c => ({
        id:            c.id,
        name:          c.name || '',
        contact:       c.contact || '',
        role:          c.job || c.role || '—',
        followupDate:  c.followupDate || '—',
        followupTime:  c.followupTime || '',
        recruiterName: c.recruiter_name || c.recruiterName || '—',
        status:        c.status,
        notes:         c.notes || '',
        round:         c.round || 1,
        companyName:   c.clientName || c.companyName || '—',
        interviewLocation: c.interviewLocation || '—'
      }));
      renderScheduledTable(INTERVIEWS);
      setEl('sb-cnt-scheduled', INTERVIEWS.length);
      updateFollowupBadge();
    }
  } catch(e) { console.error('Scheduled interviews fallback:', e); }
}

// ── LOAD ONGOING INTERVIEWS ───────────────────────────
async function loadOngoingInterviews() {
  try {
    const res  = await fetch('/api/clients/ongoing-interviews', { headers: { 'x-session-token': getToken() } });
    const data = await res.json();
    if (data.success && Array.isArray(data.interviews)) {
      ONGOING = data.interviews;
      renderOngoingTable(ONGOING);
      setEl('sb-cnt-ongoing', ONGOING.length);
      updateFollowupBadge();
      return;
    }
  } catch(e) { /* fall through */ }

  // Fallback
  try {
    const res  = await fetch('/api/candidates', { headers: { 'x-session-token': getToken() } });
    const data = await res.json();
    if (data.candidates) {
      const rows = data.candidates.filter(c =>
        c.status === 'ongoing' || c.interview_status === 'ongoing'
      );
      ONGOING = rows.map(c => ({
        id:          c.id,
        name:        c.name || '',
        contact:     c.contact || '',
        companyName: c.clientName || c.companyName || '—',
        role:        c.job || c.role || '—',
        round:       c.round || 1,
        followupDate: c.followupDate || '—',
        status:      'ongoing',
        notes:       c.notes || '',
        recruiterName: c.recruiter_name || '—'
      }));
      renderOngoingTable(ONGOING);
      setEl('sb-cnt-ongoing', ONGOING.length);
      updateFollowupBadge();
    }
  } catch(e) { console.error('Ongoing interviews fallback:', e); }
}

// ── CLOCK + GREETING ──────────────────────────────────
function updateClock() {
  const now  = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  const ap = h >= 12 ? 'PM' : 'AM'; const hD = h % 12 || 12;
  const el = document.getElementById('tb-datetime');
  if (el) el.textContent = days[now.getDay()]+', '+now.getDate()+' '+mons[now.getMonth()]+' '+now.getFullYear()+'  ·  '+pad(hD)+':'+pad(m)+':'+pad(s)+' '+ap;
  const greetEl = document.getElementById('tb-greeting');
  if (greetEl) {
    let greet = h < 12 ? '🌤️ Good Morning, Anitha Mam!' : h < 16 ? '☀️ Good Afternoon, Anitha Mam!' : '🌙 Good Evening, Anitha Mam!';
    greetEl.textContent = greet;
  }
}

// ── PROFILE DROPDOWN ──────────────────────────────────
function toggleProfileDrop() {
  const drop  = document.getElementById('profile-drop');
  const caret = document.getElementById('profile-caret');
  const isOpen = drop.style.display === 'block';
  drop.style.display  = isOpen ? 'none' : 'block';
  if (caret) caret.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
}
function closeProfileDrop() {
  const drop  = document.getElementById('profile-drop');
  const caret = document.getElementById('profile-caret');
  if (drop)  drop.style.display = 'none';
  if (caret) caret.style.transform = 'rotate(0deg)';
}
function logoutUser() {
  if (confirm('Are you sure you want to logout?')) {
    fetch('/api/auth/logout', { method: 'POST', headers: { 'x-session-token': getToken() } });
    sessionStorage.clear();
    showToast('Logging out…', 'ok');
    setTimeout(() => { window.location.href = 'login.html'; }, 900);
  }
}

// ── VIEW ROUTING ──────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-'+name);
  if (el) el.classList.add('active');

  const addBtn = document.getElementById('topbar-add-btn');
  if (addBtn) addBtn.style.display = name === 'clients' ? 'flex' : 'none';

  document.querySelectorAll('.sb-item,.sb-sub-item').forEach(x => x.classList.remove('active'));
  const navEl = document.getElementById('nav-'+name) || document.getElementById('nav-main-'+name);
  if (navEl) navEl.classList.add('active');

  if (['clients','workorders'].includes(name)) ensureSbDrop('client');
  if (['scheduled','ongoing','feedbacks'].includes(name)) ensureSbDrop('followup');

  switch(name) {
    case 'dashboard':  renderDashboard(); loadDashboardStats(); break;
    case 'clients':    renderClientsTable(); break;
    case 'workorders': renderWorkOrdersTable(); break;
    case 'scheduled':  loadTodayInterviews(); break;
    case 'ongoing':    loadOngoingInterviews(); break;
    case 'feedbacks':  loadDashboardStats(); break;
    case 'completed':  renderCompletedTable(); break;
  }
}

// ── SIDEBAR DROPDOWNS ─────────────────────────────────
const sbDropState = {client:false, followup:false};
function toggleSbDrop(key) {
  sbDropState[key] = !sbDropState[key];
  document.getElementById('sb-'+key+'-toggle')?.classList.toggle('open', sbDropState[key]);
  document.getElementById('sb-'+key+'-items')?.classList.toggle('open', sbDropState[key]);
}
function ensureSbDrop(key) { if (!sbDropState[key]) toggleSbDrop(key); }

function updateFollowupBadge() {
  const total = INTERVIEWS.length + ONGOING.length + FEEDBACK_LIST.length;
  const badge = document.getElementById('sb-followup-total-badge');
  if (badge) {
    badge.textContent = total;
    badge.style.display = total > 0 ? 'inline-flex' : 'none';
  }
}

// ── RENDER ALL ────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderClientsTable();
  updateSidebarCounts();
}

function updateSidebarCounts() {
  setEl('sb-cnt-clients',   CLIENTS.length);
  setEl('sb-cnt-scheduled', INTERVIEWS.length);
  setEl('sb-cnt-ongoing',   ONGOING.length);
  setEl('sb-cnt-feedbacks', FEEDBACK_LIST.length);
  updateFollowupBadge();
}

// ── DASHBOARD ─────────────────────────────────────────
function renderDashboard() {
  const tb = document.getElementById('recent-clients-tbody');
  if (!tb) return;
  const recent = CLIENTS.slice(0, 5);
  if (!recent.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty"><p>No clients yet.</p></div></td></tr>';
    return;
  }
  tb.innerHTML = recent.map(c => `<tr>
    <td><strong style="color:var(--dark-blue);">${esc(c.companyName)}</strong>${c.tagline?`<div style="font-size:11px;color:var(--text-muted);font-style:italic;">${esc(c.tagline.substring(0,50))}</div>`:''}</td>
    <td>${typeBadge(c.type)}</td>
    <td style="font-size:12px;">${esc(c.contactPerson)}</td>
    <td><span class="badge b-teal">${c.openings||0} open</span></td>
    <td><span class="badge b-green">Active</span></td>
  </tr>`).join('');
}

// ── CLIENTS TABLE ─────────────────────────────────────
// CHANGES:
//   • Removed "Work Orders" column
//   • Added "Date Posted" and "Last Date to Apply" columns
//   • Fixed action buttons — using onclick with actual JS calls
function renderClientsTable() {
  const search = (document.getElementById('client-search')?.value||'').toLowerCase();
  const typeF  = document.getElementById('client-type-filter')?.value||'';
  const data   = CLIENTS.filter(c => {
    const ms = !search || c.companyName.toLowerCase().includes(search) || (c.contactPerson||'').toLowerCase().includes(search);
    const mt = !typeF || c.type === typeF;
    return ms && mt;
  });

  const tb = document.getElementById('clients-tbody'); if (!tb) return;
  if (!data.length) {
    tb.innerHTML = `<tr><td colspan="12"><div class="empty"><p>No clients found.</p></div></td></tr>`;
    return;
  }
  tb.innerHTML = data.map((c, i) => `<tr>
    <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
    <td><strong style="color:var(--dark-blue);">${esc(c.companyName)}</strong></td>
    <td>${typeBadge(c.type)}</td>
    <td style="font-size:12px;">${esc(c.contactPerson)}</td>
    <td style="font-size:12px;">${esc(c.contactNumber)}</td>
    <td style="font-size:12px;">${esc(c.emergencyContact||'—')}</td>
    <td style="font-size:12px;">${buildReqTags(c.requirements, true)}</td>
    <td style="text-align:center;">${c.openings>0?`<span class="badge b-teal">${c.openings}</span>`:'—'}</td>
    <td style="font-size:12px;color:var(--text-tag);">
      ${c.datePosted
        ? `<span style="background:#e8f4fd;color:#1a5276;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">📅 ${esc(c.datePosted)}</span>`
        : '<span style="color:var(--text-muted);">—</span>'}
    </td>
    <td style="font-size:12px;color:var(--text-tag);">
      ${c.lastDateToApply
        ? `<span style="background:#fdf0f0;color:#a93226;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">⏰ ${esc(c.lastDateToApply)}</span>`
        : '<span style="color:var(--text-muted);">—</span>'}
    </td>
    <td style="font-size:12px;color:var(--text-tag);">${esc(c.workLocation||'—')}</td>
    <td>
      <div class="action-btns">
        <button class="btn-view" onclick="openViewClientModal(${c.id})">👁 View</button>
        <button class="btn-edit" onclick="openEditClientModal(${c.id})">✏️ Edit</button>
        <button class="btn-del"  onclick="openDeleteModal('client',${c.id},'${esc(c.companyName).replace(/'/g,"\\'")}')">🗑</button>
      </div>
    </td>
  </tr>`).join('');
}

// ── CLIENT MODAL ──────────────────────────────────────
function openAddClientModal() {
  editingClientId = null;
  setEl('client-modal-ttl', 'Add New Client');
  document.getElementById('client-modal-body').innerHTML = buildClientForm(null);
  document.getElementById('client-save-btn').textContent = 'Add Client';
  document.getElementById('client-save-btn').onclick = doSaveClient;
  document.getElementById('client-modal-overlay').classList.add('open');
}

function openEditClientModal(id) {
  const c = CLIENTS.find(x => x.id === id); if (!c) return;
  editingClientId = id;
  setEl('client-modal-ttl', 'Edit — '+c.companyName);
  document.getElementById('client-modal-body').innerHTML = buildClientForm(c);
  document.getElementById('client-save-btn').textContent = 'Update Client';
  document.getElementById('client-save-btn').onclick = doSaveClient;
  document.getElementById('client-modal-overlay').classList.add('open');
  document.getElementById('view-client-overlay')?.classList.remove('open');
}

function closeClientModal() {
  document.getElementById('client-modal-overlay').classList.remove('open');
  editingClientId = null;
}

function buildClientForm(c) {
  const v = c||{};
  return `
    <div class="alert-strip" id="client-alert"></div>
    <div class="f-grid">
      <div class="f-grp full"><label>Company Name <span class="req">*</span></label>
        <input type="text" id="cf-company" value="${esc(v.companyName||'')}" placeholder="e.g. Infosys Technologies"/></div>
      <div class="f-grp"><label>Industry Type <span class="req">*</span></label>
        <select id="cf-type">
          ${['IT','Non-IT'].map(t=>`<option value="${t}"${(v.type||'IT')===t?' selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="f-grp"><label>Openings</label>
        <input type="number" id="cf-openings" value="${v.openings||''}" placeholder="0" min="0"/></div>
      <div class="f-grp"><label>Contact Person <span class="req">*</span></label>
        <input type="text" id="cf-contact-person" value="${esc(v.contactPerson||'')}" placeholder="HR / Manager name"/></div>
      <div class="f-grp"><label>Contact Number <span class="req">*</span></label>
        <input type="tel" id="cf-contact-number" value="${esc(v.contactNumber||'')}" placeholder="10-digit number" maxlength="10" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,10)"/></div>
      <div class="f-grp"><label>Emergency Contact Number</label>
        <input type="tel" id="cf-emergency" value="${esc(v.emergencyContact||'')}" placeholder="Alternative number" maxlength="10" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,10)"/></div>
      <div class="f-grp"><label>Department</label>
        <input type="text" id="cf-department" value="${esc(v.department||'')}" placeholder="e.g. HR, Engineering"/></div>
      <div class="f-grp"><label>Date Posted</label>
        <input type="date" id="cf-date-posted" value="${v.datePosted||''}"/></div>
      <div class="f-grp"><label>Last Date to Apply</label>
        <input type="date" id="cf-last-date" value="${v.lastDateToApply||''}"/></div>
      <div class="f-grp full"><label>Job Requirements / Roles <span class="req">*</span></label>
        <input type="text" id="cf-requirements" value="${esc(v.requirements||'')}" placeholder="e.g. Java Developer, UI/UX Designer (comma-separated)"/></div>
      <div class="f-grp full"><label>Company Address</label>
        <textarea id="cf-address" style="min-height:56px;">${esc(v.address||'')}</textarea></div>
      <div class="f-grp"><label>Interview Location</label>
        <input type="text" id="cf-interview-location" value="${esc(v.interviewLocation||'')}" placeholder="e.g. Chennai Office, Block A"/></div>
      <div class="f-grp"><label>Work Location</label>
        <input type="text" id="cf-work-location" value="${esc(v.workLocation||'')}" placeholder="e.g. Bangalore, Remote"/></div>
      <div class="f-grp full"><label>Tagline</label>
        <input type="text" id="cf-tagline" value="${esc(v.tagline||'')}" placeholder="Company tagline or description"/></div>
      <div class="f-grp full"><label>Notes</label>
        <textarea id="cf-notes">${esc(v.notes||'')}</textarea></div>
    </div>`;
}

async function doSaveClient() {
  const companyName        = val('cf-company');
  const type               = val('cf-type') || 'IT';
  const contactPerson      = val('cf-contact-person');
  const contactNumber      = val('cf-contact-number');
  const emergencyContact   = val('cf-emergency');
  const requirements       = val('cf-requirements');
  const openings           = parseInt(val('cf-openings')||'0',10)||0;
  const department         = val('cf-department');
  const address            = val('cf-address');
  const interviewLocation  = val('cf-interview-location');
  const workLocation       = val('cf-work-location');
  const tagline            = val('cf-tagline');
  const notes              = val('cf-notes');
  const datePosted         = val('cf-date-posted');
  const lastDateToApply    = val('cf-last-date');

  if (!companyName)   { showModalAlert('client-alert','Company name is required.'); return; }
  if (!contactPerson) { showModalAlert('client-alert','Contact person is required.'); return; }
  if (!contactNumber || contactNumber.length!==10) { showModalAlert('client-alert','Contact number must be 10 digits.'); return; }
  if (!requirements)  { showModalAlert('client-alert','Job requirements are required.'); return; }

  const payload = {
    companyName, type, contactPerson, contactNumber, emergencyContact,
    requirements, openings, department, address, interviewLocation,
    workLocation, tagline, notes, datePosted, lastDateToApply
  };

  try {
    let res, data;
    if (editingClientId !== null) {
      res  = await fetch(`/api/clients/${editingClientId}`, { method:'PUT', headers: getHeaders(), body: JSON.stringify(payload) });
      data = await res.json();
      if (data.success) {
        const idx = CLIENTS.findIndex(c=>c.id===editingClientId);
        if (idx!==-1) CLIENTS[idx] = { ...CLIENTS[idx], ...payload };
        showToast(companyName+' updated!', 'ok');
      }
    } else {
      res  = await fetch('/api/clients', { method:'POST', headers: getHeaders(), body: JSON.stringify(payload) });
      data = await res.json();
      if (data.success) {
        CLIENTS.unshift({ id: data.id, ...payload, created_at: new Date().toISOString() });
        showToast(companyName+' added!', 'ok');
      }
    }
    if (!data.success) { showModalAlert('client-alert', data.error || 'Failed to save.'); return; }
  } catch(e) {
    showModalAlert('client-alert', 'Server error. Please try again.');
    return;
  }

  closeClientModal();
  renderAll();
  updateSidebarCounts();
}

// ── VIEW CLIENT MODAL ─────────────────────────────────
function openViewClientModal(id) {
  const c = CLIENTS.find(x=>x.id===id); if (!c) return;
  setEl('view-client-ttl', c.companyName);
  setEl('view-client-sub', c.type+' — '+c.contactPerson);
  document.getElementById('view-edit-btn').onclick = () => openEditClientModal(id);
  document.getElementById('view-client-body').innerHTML = `
    <div class="detail-grid">
      <div class="detail-section">🏢 Company</div>
      <div class="detail-row"><div class="detail-lbl">Name</div><div class="detail-val"><strong style="font-size:16px;color:var(--dark-blue);">${esc(c.companyName)}</strong></div></div>
      <div class="detail-row"><div class="detail-lbl">Type</div><div class="detail-val">${typeBadge(c.type)}</div></div>
      ${c.tagline?`<div class="detail-row full"><div class="detail-lbl">Tagline</div><div class="detail-val" style="font-style:italic;color:var(--mid-blue);">"${esc(c.tagline)}"</div></div>`:''}
      <div class="detail-row full"><div class="detail-lbl">Address</div><div class="detail-val">${c.address?esc(c.address):'—'}</div></div>
      <div class="detail-section">👤 Contact</div>
      <div class="detail-row"><div class="detail-lbl">Person</div><div class="detail-val"><strong>${esc(c.contactPerson)}</strong></div></div>
      <div class="detail-row"><div class="detail-lbl">Number</div><div class="detail-val">📞 ${esc(c.contactNumber)}</div></div>
      <div class="detail-row"><div class="detail-lbl">Emergency</div><div class="detail-val">${c.emergencyContact?'📞 '+esc(c.emergencyContact):'—'}</div></div>
      <div class="detail-row full"><div class="detail-lbl">Department</div><div class="detail-val">${c.department||'—'}</div></div>
      <div class="detail-section">📍 Locations</div>
      <div class="detail-row"><div class="detail-lbl">Interview Location</div><div class="detail-val">📍 ${esc(c.interviewLocation||'—')}</div></div>
      <div class="detail-row"><div class="detail-lbl">Work Location</div><div class="detail-val">🏢 ${esc(c.workLocation||'—')}</div></div>
      <div class="detail-section">📋 Requirements</div>
      <div class="detail-row"><div class="detail-lbl">Openings</div><div class="detail-val"><span style="font-size:20px;font-weight:700;color:var(--teal);">${c.openings||0}</span></div></div>
      <div class="detail-row"><div class="detail-lbl">Date Posted</div><div class="detail-val">${c.datePosted?`<span style="background:#e8f4fd;color:#1a5276;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:700;">📅 ${esc(c.datePosted)}</span>`:'—'}</div></div>
      <div class="detail-row"><div class="detail-lbl">Last Date to Apply</div><div class="detail-val">${c.lastDateToApply?`<span style="background:#fdf0f0;color:#a93226;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:700;">⏰ ${esc(c.lastDateToApply)}</span>`:'—'}</div></div>
      <div class="detail-row full"><div class="detail-lbl">Roles</div><div class="detail-val">${buildReqTags(c.requirements, false)}</div></div>
      ${c.notes?`<div class="detail-section">📝 Notes</div><div class="detail-row full"><div class="detail-lbl">Notes</div><div class="detail-val" style="white-space:pre-wrap;line-height:1.6;">${esc(c.notes)}</div></div>`:''}
    </div>`;
  document.getElementById('view-client-overlay').classList.add('open');
}
function closeViewClientModal() { document.getElementById('view-client-overlay').classList.remove('open'); }

// ── SCHEDULED TABLE ───────────────────────────────────
// CHANGES:
//   • Removed "Interview Location" column
//   • Removed "Client / Company" column
//   • Scheduled Date is always visible (no hiding)
//   • Old data always shows (loaded fresh from DB each time)
function renderScheduledTable(interviews) {
  const tb = document.getElementById('scheduled-tbody'); if (!tb) return;
  setEl('sb-cnt-scheduled', interviews ? interviews.length : 0);
  updateFollowupBadge();

  if (!interviews || !interviews.length) {
    tb.innerHTML = `<tr><td colspan="7">
      <div class="empty" style="text-align:center;padding:40px 20px;">
        <div style="font-size:36px;margin-bottom:10px;">📅</div>
        <p style="font-weight:600;color:var(--dark-blue);margin-bottom:4px;">No interviews scheduled</p>
        <p style="font-size:12px;color:var(--text-muted);">Candidates with status 'Scheduled' will appear here.</p>
      </div>
    </td></tr>`;
    return;
  }

  // Update thead to match new columns (no Interview Location, no Client/Company)
  const thead = document.querySelector('#view-scheduled table thead tr');
  if (thead) {
    thead.innerHTML = `
      <th>SNO</th>
      <th>Candidate</th>
      <th>Role</th>
      <th>Scheduled Date</th>
      <th>Scheduled Time</th>
      <th>Recruiter</th>
      <th>Action</th>`;
  }

  tb.innerHTML = interviews.map((iv, i) => {
    // Date is always shown — use a fallback display if missing
    const dateDisplay = iv.followupDate && iv.followupDate !== '—'
      ? `<span style="background:#e8f4fd;color:#1a5276;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">📅 ${esc(iv.followupDate)}</span>`
      : `<span style="background:#f8f9fc;color:var(--text-muted);padding:3px 8px;border-radius:6px;font-size:11px;">Not set</span>`;

    const timeDisplay = iv.followupTime
      ? `<span style="background:#f0eaff;color:#6c3fc1;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">🕐 ${esc(iv.followupTime)}</span>`
      : `<span style="color:var(--text-muted);font-size:12px;">—</span>`;

    return `<tr>
      <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--teal),var(--mid-blue));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;">${esc((iv.name||'?').charAt(0).toUpperCase())}</div>
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--dark-blue);">${esc(iv.name)}</div>
            <div style="font-size:11px;color:var(--text-muted);">${esc(iv.contact||'')}</div>
          </div>
        </div>
      </td>
      <td>
        <span style="background:#e8f4f8;color:#1a7a75;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">${esc(iv.role||'—')}</span>
      </td>
      <td>${dateDisplay}</td>
      <td>${timeDisplay}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="width:22px;height:22px;border-radius:50%;background:var(--mid-blue);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;">${esc((iv.recruiterName||'R').charAt(0))}</div>
          <span style="font-size:12px;">${esc(iv.recruiterName||'—')}</span>
        </div>
      </td>
      <td>
        <select class="outcome-select" onchange="updateOutcome(${iv.id}, this.value)" style="padding:5px 10px;border-radius:6px;border:1.5px solid var(--border-btn);font-size:12px;font-weight:600;background:#fff;cursor:pointer;min-width:130px;">
          <option value="">Action</option>
          <option value="placed">✅ Placed</option>
          <option value="rejected">❌ Rejected</option>
          <option value="ongoing">▶ Mark Ongoing</option>
          <option value="feedback_pending">💬 Request Feedback</option>
        </select>
      </td>
    </tr>`;
  }).join('');
}

// ── ONGOING TABLE ─────────────────────────────────────
// Shows ALL ongoing interviews from ALL recruiters/interviewers
function renderOngoingTable(interviews) {
  const tb = document.getElementById('ongoing-tbody'); if (!tb) return;
  setEl('sb-cnt-ongoing', interviews ? interviews.length : 0);
  updateFollowupBadge();

  if (!interviews || !interviews.length) {
    tb.innerHTML = `<tr><td colspan="8">
      <div class="empty" style="text-align:center;padding:40px 20px;">
        <div style="font-size:36px;margin-bottom:10px;">🔄</div>
        <p style="font-weight:600;color:var(--dark-blue);margin-bottom:4px;">No ongoing interviews</p>
        <p style="font-size:12px;color:var(--text-muted);">Mark a scheduled interview as "Ongoing" to see it here.</p>
      </div>
    </td></tr>`;
    return;
  }

  tb.innerHTML = interviews.map((iv, i) => `<tr>
    <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
    <td>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#e67e22,#d35400);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;">${esc((iv.name||'?').charAt(0).toUpperCase())}</div>
        <div>
          <div style="font-weight:700;font-size:13px;color:var(--dark-blue);">${esc(iv.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${esc(iv.contact||'')}</div>
        </div>
      </div>
    </td>
    <td style="font-size:12px;font-weight:600;">${esc(iv.companyName||'—')}</td>
    <td><span style="background:#e8f4f8;color:#1a7a75;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">${esc(iv.role||'—')}</span></td>
    <td>
      <span style="background:#fff3e6;color:#b85c00;border:1.5px solid #e67e22;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;">
        Round ${iv.round||1}
      </span>
    </td>
    <td>
      <div style="font-size:11px;">
        <span style="background:#e8f4fd;color:#1a5276;padding:2px 7px;border-radius:5px;font-weight:700;">📅 ${esc(iv.followupDate||'—')}</span>
      </div>
    </td>
    <td>
      <span style="display:inline-flex;align-items:center;gap:5px;background:#fff8e6;border:1px solid #f39c12;border-radius:20px;padding:4px 10px;">
        <span style="width:7px;height:7px;border-radius:50%;background:#f39c12;display:inline-block;animation:pulse 1.5s infinite;"></span>
        <span style="font-size:11px;color:#b85c00;font-weight:700;">In Progress</span>
      </span>
    </td>
    <td>
      <select class="outcome-select" onchange="updateOutcome(${iv.id}, this.value)" style="padding:5px 10px;border-radius:6px;border:1.5px solid var(--border-btn);font-size:12px;font-weight:600;background:#fff;cursor:pointer;min-width:140px;">
        <option value="">Action</option>
        <option value="placed">✅ Placed</option>
        <option value="rejected">❌ Rejected</option>
        <option value="feedback_pending">💬 Get Feedback</option>
      </select>
    </td>
  </tr>`).join('');
}

// ── FEEDBACK TABLE ────────────────────────────────────
// CHANGE: correctly maps all fields from dashboard-stats feedbackPending
function renderFeedbackTable(candidates) {
  const tb = document.getElementById('feedbacks-tbody'); if (!tb) return;
  setEl('sb-cnt-feedbacks', candidates ? candidates.length : 0);
  updateFollowupBadge();

  if (!candidates || !candidates.length) {
    tb.innerHTML = `<tr><td colspan="8">
      <div class="empty" style="text-align:center;padding:40px 20px;">
        <div style="font-size:36px;margin-bottom:10px;">💬</div>
        <p style="font-weight:600;color:var(--dark-blue);margin-bottom:4px;">No feedback pending</p>
        <p style="font-size:12px;color:var(--text-muted);">Candidates marked for feedback will appear here.</p>
      </div>
    </td></tr>`;
    return;
  }

  // Rebuild thead to ensure correct columns
  const thead = document.querySelector('#view-feedbacks table thead tr');
  if (thead) {
    thead.innerHTML = `
      <th>SNO</th>
      <th>Candidate</th>
      <th>Client</th>
      <th>Role</th>
      <th>Interview Date</th>
      <th>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="background:#e8f4f8;color:#1a7a75;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:700;">RECRUITER</span>
          Notes
        </div>
      </th>
      <th>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="background:#fff3e6;color:#b85c00;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:700;">HR/CLIENT</span>
          Feedback
        </div>
      </th>
      <th>Action</th>`;
  }

  tb.innerHTML = candidates.map((c, i) => {
    // Support multiple field name variations from the API
    const candidateName  = c.name || c.candidateName || '—';
    const clientName     = c.clientName || c.companyName || '—';
    const role           = c.role || c.job || '—';
    const interviewDate  = c.interviewDate || c.followupDate || '';
    const recruiterNote  = c.recruiterNotes || c.notes || '';
    const clientFeedback = c.clientFeedback || c.feedback || '';

    return `<tr>
      <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#6c3fc1,#8e44ad);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;">${esc(candidateName.charAt(0).toUpperCase())}</div>
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--dark-blue);">${esc(candidateName)}</div>
            <div style="font-size:11px;color:var(--text-muted);">${esc(c.contact||'')}</div>
          </div>
        </div>
      </td>
      <td style="font-size:12px;font-weight:600;">${esc(clientName)}</td>
      <td><span style="background:#e8f4f8;color:#1a7a75;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">${esc(role)}</span></td>
      <td>
        ${interviewDate
          ? `<span style="background:#e8f4fd;color:#1a5276;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">📅 ${esc(interviewDate)}</span>`
          : '<span style="color:var(--text-muted);font-size:12px;">—</span>'}
      </td>
      <td style="max-width:180px;">
        ${recruiterNote
          ? `<div style="background:#e8f4f8;border:1px solid rgba(31,154,148,.2);border-radius:6px;padding:6px 8px;font-size:11.5px;color:var(--text-tag);line-height:1.5;">${esc(recruiterNote.substring(0,80))}${recruiterNote.length>80?'…':''}</div>`
          : `<span style="font-size:11px;color:var(--text-muted);font-style:italic;">No recruiter note</span>`}
      </td>
      <td style="max-width:180px;">
        ${clientFeedback
          ? `<div style="background:#fff8e6;border:1px solid rgba(230,126,34,.25);border-radius:6px;padding:6px 8px;font-size:11.5px;color:#7d4a00;line-height:1.5;">${esc(clientFeedback.substring(0,80))}${clientFeedback.length>80?'…':''}</div>`
          : `<button onclick="openFeedbackInput(${c.id})" style="display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:6px;border:1.5px dashed rgba(230,126,34,.5);background:transparent;color:#b85c00;font-size:11px;font-weight:700;cursor:pointer;">
              <span>+</span> Add HR Feedback
            </button>`}
        ${recruiterNote && clientFeedback ? '<div style="margin-top:3px;"><span style="font-size:10px;color:var(--suc);font-weight:700;">✓ Both notes present</span></div>' : ''}
      </td>
      <td>
        <select class="outcome-select" onchange="updateOutcome(${c.id}, this.value)" style="padding:5px 10px;border-radius:6px;border:1.5px solid var(--border-btn);font-size:12px;font-weight:600;background:#fff;cursor:pointer;min-width:130px;">
          <option value="">Select Action</option>
          <option value="placed">✅ Placed</option>
          <option value="rejected">❌ Rejected</option>
        </select>
      </td>
    </tr>`;
  }).join('');
}

// ── FEEDBACK INPUT MODAL ──────────────────────────────
function openFeedbackInput(candidateId) {
  const c = FEEDBACK_LIST.find(x => x.id === candidateId);
  const name = c ? (c.name || c.candidateName || 'Candidate') : 'Candidate';

  const existingPopup = document.getElementById('feedback-inline-popup');
  if (existingPopup) existingPopup.remove();

  const overlay = document.createElement('div');
  overlay.id = 'feedback-inline-popup';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(22,46,90,.5);backdrop-filter:blur(3px);z-index:2000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:460px;max-width:95vw;box-shadow:0 20px 60px rgba(22,46,90,.3);overflow:hidden;">
      <div style="background:linear-gradient(135deg,var(--dark-blue),var(--mid-blue));padding:16px 20px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:15px;font-weight:700;color:#fff;">💬 HR/Client Feedback</div>
          <div style="font-size:11px;color:rgba(255,255,255,.6);">${esc(name)}</div>
        </div>
        <button onclick="document.getElementById('feedback-inline-popup').remove()" style="width:30px;height:30px;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;font-size:18px;cursor:pointer;">×</button>
      </div>
      <div style="padding:20px;">
        <label style="font-size:12px;font-weight:700;color:var(--dark-blue);text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:8px;">Feedback from Client / HR</label>
        <textarea id="feedback-text-input" placeholder="Enter HR or client feedback..." style="width:100%;min-height:100px;padding:10px 12px;border:1.5px solid var(--border-inp);border-radius:8px;font-size:13px;resize:vertical;outline:none;font-family:inherit;box-sizing:border-box;"></textarea>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button onclick="document.getElementById('feedback-inline-popup').remove()" style="flex:1;padding:10px;border-radius:8px;border:1.5px solid var(--border-btn);background:#fff;color:var(--text-btn);font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>
          <button onclick="submitFeedbackNote(${candidateId})" style="flex:2;padding:10px;border-radius:8px;border:none;background:var(--teal);color:#fff;font-size:13px;font-weight:700;cursor:pointer;">Save Feedback</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function submitFeedbackNote(candidateId) {
  const feedback = (document.getElementById('feedback-text-input')?.value||'').trim();
  if (!feedback) { showToast('Please enter feedback text.', 'err'); return; }

  try {
    const res = await fetch(`/api/clients/candidate-feedback/${candidateId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ feedback })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Feedback saved!', 'ok');
      document.getElementById('feedback-inline-popup')?.remove();
      const idx = FEEDBACK_LIST.findIndex(x => x.id === candidateId);
      if (idx !== -1) {
        FEEDBACK_LIST[idx].feedback = feedback;
        FEEDBACK_LIST[idx].clientFeedback = feedback;
      }
      renderFeedbackTable(FEEDBACK_LIST);
    } else {
      showToast('Failed to save: '+(data.error||''), 'err');
    }
  } catch(e) {
    showToast('Server error.', 'err');
  }
}

// ── UPDATE OUTCOME ────────────────────────────────────
async function updateOutcome(candidateId, outcome) {
  if (!outcome) return;
  try {
    const res  = await fetch(`/api/clients/interview-outcome/${candidateId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ outcome })
    });
    const data = await res.json();
    if (data.success) {
      const label = {
        placed: 'Placed ✅', rejected: 'Rejected ❌',
        ongoing: 'Ongoing ▶', feedback_pending: 'Awaiting Feedback 💬'
      }[outcome] || outcome;
      showToast('Candidate marked: ' + label, 'ok');

      INTERVIEWS    = INTERVIEWS.filter(x => x.id !== candidateId);
      ONGOING       = ONGOING.filter(x => x.id !== candidateId);
      FEEDBACK_LIST = FEEDBACK_LIST.filter(x => x.id !== candidateId);

      await loadDashboardStats();
      await loadTodayInterviews();
      await loadOngoingInterviews();
      updateSidebarCounts();
    } else {
      showToast('Failed: ' + (data.error||''), 'err');
    }
  } catch(e) {
    showToast('Server error. Try again.', 'err');
  }
}

// ── WORK ORDERS ───────────────────────────────────────
function renderWorkOrdersTable() {
  const tb = document.getElementById('workorders-tbody'); if (!tb) return;
  tb.innerHTML = '<tr><td colspan="9"><div class="empty"><p>Work orders feature coming soon.</p></div></td></tr>';
}

// ── COMPLETED TABLE ───────────────────────────────────
function renderCompletedTable() {
  const tb = document.getElementById('completed-tbody'); if (!tb) return;
  tb.innerHTML = '<tr><td colspan="8"><div class="empty"><p>Completed work orders loading...</p></div></td></tr>';
}

// ── DELETE ────────────────────────────────────────────
function openDeleteModal(type, id, name) {
  deletingType = type; deletingId = id;
  setEl('delete-item-name', name || 'Item');
  document.getElementById('delete-overlay').classList.add('open');
}
function closeDeleteModal() {
  document.getElementById('delete-overlay').classList.remove('open');
  deletingType = null; deletingId = null;
}

async function confirmDelete() {
  if (!deletingType || !deletingId) return;
  try {
    const res  = await fetch(`/api/clients/${deletingId}`, { method:'DELETE', headers: { 'x-session-token': getToken() } });
    const data = await res.json();
    if (data.success) {
      CLIENTS = CLIENTS.filter(x => x.id !== deletingId);
      showToast('Deleted successfully.', 'ok');
      renderAll();
      updateSidebarCounts();
    } else {
      showToast('Delete failed: ' + (data.error||''), 'err');
    }
  } catch(e) { showToast('Delete failed.', 'err'); }
  closeDeleteModal();
}

// ── ACTION MODAL ──────────────────────────────────────
function closeActionModal() {
  document.getElementById('action-modal-overlay')?.classList.remove('open');
  actionInterviewId = null;
}
function closeCompletedModal() {
  document.getElementById('completed-modal-overlay')?.classList.remove('open');
}
function saveActionOutcome() { closeActionModal(); }

function filterCompleted(filter, btn) {
  completedFilter = filter;
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderCompletedTable();
}

// ── HELPERS ───────────────────────────────────────────
function typeBadge(type) {
  const map = {'IT':['b-teal','IT'],'Non-IT':['b-blue','Non-IT']};
  const [cls, lbl] = map[type] || ['b-gray', type];
  return `<span class="badge ${cls}">${lbl}</span>`;
}

function buildReqTags(reqs, compact) {
  if (!reqs) return '<span style="color:var(--text-muted);font-size:12px;">—</span>';
  const list = reqs.split(',').map(r=>r.trim()).filter(Boolean);
  if (!list.length) return '<span style="color:var(--text-muted);font-size:12px;">—</span>';
  if (compact && list.length > 3) {
    return `<div class="req-tags">${list.slice(0,3).map(r=>`<span class="req-tag">${esc(r)}</span>`).join('')}<span class="req-tag" style="background:#f0f4f9;color:var(--text-tag);">+${list.length-3}</span></div>`;
  }
  return `<div class="req-tags">${list.map(r=>`<span class="req-tag">${esc(r)}</span>`).join('')}</div>`;
}

function showModalAlert(id, msg) {
  const el = document.getElementById(id); if (!el) return;
  el.textContent = msg; el.className = 'alert-strip err show';
  setTimeout(() => el.classList.remove('show'), 4000);
}

function showToast(msg, type) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.className = 'show'+(type?' '+type:'');
  clearTimeout(toastTm);
  toastTm = setTimeout(() => t.classList.remove('show'), 2800);
}

function setEl(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function pad(n) { return String(n).padStart(2,'0'); }