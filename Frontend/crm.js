// =====================================================
// THE GOJOBSYNC RECRUITER CRM — crm.js (v2 FIXED)
// KEY FIXES:
//   1. Recruiter ONLY sees candidates assigned by admin (recruiter_id = their id)
//   2. All status updates save to DB correctly
//   3. Fresh dump only shows assigned candidates
//   4. Real-time polling every 10 seconds
// =====================================================

let curProfile     = sessionStorage.getItem('crm_profile')      || 'soundariya';
let curUsername    = sessionStorage.getItem('crm_username')      || 'rec001';
let curRecruiterId = parseInt(sessionStorage.getItem('crm_recruiter_id') || '1', 10);

const PROFILES = {
  soundariya: {
    name:  'Sowndarya',
    doj:   '12 Jan 2024',
    empid: 'EMP-001',
    img:   'WhatsApp Image 2026-04-03 at 10.09.47 AM.jpeg'
  },
  tharshini: {
    name:  'Tharshini',
    doj:   '05 Mar 2023',
    empid: 'EMP-002',
    img:   'WhatsApp Image 2026-04-03 at 11.06.00 AM.jpeg'
  }
};
if (!PROFILES[curProfile]) curProfile = 'soundariya';

const STATUS_LABELS = {
  fresh:         'Fresh Dump',
  followups:     'Follow-Up',
  interested:    'Interested',
  rnr:           'RNR',
  callback:      'Callback',
  notinterested: 'Not Interested',
  scheduled:     'Scheduled'
};
const BADGE_CLASS = {
  fresh:         'b-gray',
  followups:     'b-teal',
  interested:    'b-green',
  rnr:           'b-orange',
  callback:      'b-blue',
  notinterested: 'b-red',
  scheduled:     'b-purple'
};

const EXP_YEAR_OPTIONS  = ['0-1 years','1-3 years','3-5 years','5-7 years','7-9 years','9-10 years','Above 10 years'];
const EXP_MONTH_OPTIONS = ['0 months','1 month','2 months','3 months','4 months','5 months','6 months','7 months','8 months','9 months','10 months','11 months','12 months'];

let CANDIDATES = [], nextId = 1;
let curCallTab = 'fresh', curIntTab = 'followups', curCandTab = 'registered';
let activeMod = null, breakInt = null, idleTimer = null, isIdle = false, toastTm, pieChart = null, idleStart = null, totalIdleMins = 0;
let schedCandId = null, pendingUploadCandId = null;

// ── HELPER: get token ─────────────────────────────────
function getToken() {
  return sessionStorage.getItem('crm_token') || '';
}

// =====================================================
// DB LAYER
// =====================================================

async function dbLoadCandidates() {
  try {
    const res  = await fetch('/api/candidates', {
      headers: { 'x-session-token': getToken() }
    });
    const data = await res.json();
    // ✅ API already filters by recruiter_id on the server
    // Recruiter only gets their own assigned candidates
    const rows = data.candidates || [];
    CANDIDATES = rows.map(r => ({
      id:           r.id,
      date:         r.date ? formatDateDisplay(r.date.split('T')[0]) : '',
      name:         r.name         || '',
      email:        r.email        || '',
      contact:      r.contact      || '',
      qual:         r.qual         || '',
      job:          r.job          || '',
      expType:      r.expType      || 'Fresher',
      expYears:     r.expYears     || '',
      expMonths:    r.expMonths    || '',
      salary:       r.salary       || '',
      status:       r.status       || 'fresh',
      notes:        r.notes        || '',
      followupDate: r.followupDate || '',
      followupTime: r.followupTime || '',
      resumePath:   r.resumePath   || '',
      resumeName:   r.resumeName   || '',
      registered:   !!r.registered,
      createdBy:    r.created_by   || curUsername
    }));
  } catch (e) {
    console.error('dbLoadCandidates:', e);
    CANDIDATES = [];
  }
}

async function dbAddCandidate(c) {
  try {
    const res = await fetch('/api/candidates', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-session-token': getToken()
      },
      body: JSON.stringify({
        name:         c.name,
        email:        c.email,
        contact:      c.contact,
        qual:         c.qual,
        job:          c.job,
        expType:      c.expType,
        expYears:     c.expYears,
        expMonths:    c.expMonths,
        salary:       c.salary,
        status:       c.status,
        notes:        c.notes,
        followupDate: c.followupDate,
        followupTime: c.followupTime,
        resumePath:   c.resumePath  || '',
        resumeName:   c.resumeName  || '',
        registered:   c.registered ? 1 : 0,
        date:         c.date,
        created_by:   curUsername
      })
    });
    const data = await res.json();
    if (data.success) return data.id || true;
    console.error('API Error:', data);
    return null;
  } catch (e) {
    console.error('Fetch Error:', e);
    return null;
  }
}

async function dbUpdateCandidate(c) {
  try {
    const res = await fetch(`/api/candidates/${c.id}`, {
      method:  'PUT',
      headers: {
        'Content-Type':    'application/json',
        'x-session-token': getToken()
      },
      body: JSON.stringify({
        name:         c.name,
        email:        c.email,
        contact:      c.contact,
        qual:         c.qual,
        job:          c.job,
        expType:      c.expType,
        expYears:     c.expYears,
        expMonths:    c.expMonths,
        salary:       c.salary,
        status:       c.status,
        notes:        c.notes,
        followupDate: c.followupDate || null,
        followupTime: c.followupTime || '',
        resumePath:   c.resumePath   || '',
        resumeName:   c.resumeName   || '',
        registered:   c.registered ? 1 : 0,
        date:         c.date         || ''
      })
    });
    const data = await res.json();
    if (!data.success) console.error('dbUpdate failed:', data);
  } catch (e) {
    console.error('dbUpdate error:', e);
  }
}

// ── RESUME UPLOAD ─────────────────────────────────────────
async function uploadResumeToServer(file, candidateId) {
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('candidateId', candidateId);          
    const res = await fetch(`/api/uploads/resume`, {   // ← removed candidateId
      method:  'POST',
      headers: { 'x-session-token': getToken() },
      body:    form
    });
    const data = await res.json();
    if (data.success) return { path: data.path, name: file.name };
    return null;
  } catch (e) {
    console.error('Resume upload error:', e);
    return null;
  }
}

// =====================================================
// INIT
// =====================================================
window.addEventListener('DOMContentLoaded', async () => {
  if (!getToken()) {
    window.location.href = 'login.html';
    return;
  }

  // Mark attendance
  try {
    await fetch('/api/attendance/mark', {
      method: 'POST',
      headers: { 'x-session-token': getToken() }
    });
  } catch(e) {}

  await dbLoadCandidates();
  // ✅ Check if user had an active break before logout/refresh
try {
  const brkRes  = await fetch('/api/attendance/break/status', {
    headers: { 'x-session-token': getToken() }
  });
  const brkData = await brkRes.json();
  if (brkData.success && brkData.activeBreak) {
    const ab = brkData.activeBreak;
    if (ab.remainingSecs > 0) {
      // Resume the break timer with remaining time
      startBreak(ab.type, ab.remainingSecs);
    } else {
      // Break time already expired while they were away — auto-close it
      fetch('/api/attendance/break/end', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': getToken() },
        body:    JSON.stringify({})
      }).catch(() => {});
      showToast('Your break ended while you were away.', 'ok');
    }
  }
} catch (e) {
  console.warn('Could not check break status:', e);
}
  applyProfile();
  updateGreeting();
  const t = fmtTime(new Date());
  document.getElementById('login-t-disp').textContent = t;
  document.getElementById('pd-login').textContent     = t;
  document.getElementById('calls-sub').classList.add('open');
  document.getElementById('nav-calls-parent').classList.add('open');
  updateKPIs();
  renderDashRecent();
  renderPieChart();
  renderCalls();
  renderInterviews();
  setupCallIdle();
  updateClock();
  setInterval(updateClock, 1000);

  // ✅ Real-time polling every 15 seconds
  setInterval(async () => {
    await dbLoadCandidates();
    updateKPIs();
    renderDashRecent();
    renderPieChart();
    renderCalls();
    renderInterviews();
  }, 15000);
});

function updateClock() {
  const now = new Date();
  const de  = document.getElementById('tb-date-disp');
  const te  = document.getElementById('tb-time-disp');
  if (de) de.textContent = now.toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
  if (te) te.textContent = fmtTime(now);
}

function updateGreeting() {
  const h  = new Date().getHours();
  const g  = h < 12 ? 'Good Morning' : h < 15 ? 'Good Afternoon' : 'Good Evening';
  const el = document.getElementById('greeting-text');
  if (el) el.textContent = g;
}

function applyProfile() {
  const p = PROFILES[curProfile];
  document.getElementById('nav-ava').innerHTML     = `<img src="${p.img}" alt="${p.name}">`;
  document.getElementById('pd-ava-lg').innerHTML   = `<img src="${p.img}" alt="${p.name}">`;
  document.getElementById('nav-pname').textContent = p.name;
  document.getElementById('pd-nm').textContent     = p.name;
  document.getElementById('pd-doj').textContent    = p.doj;
  document.getElementById('pd-empid').textContent  = p.empid;
  const gn = document.getElementById('greeting-name');
  if (gn) gn.textContent = p.name;
}

function togglePDrop() {
  document.getElementById('p-drop').classList.toggle('open');
}

document.addEventListener('click', e => {
  const btn = document.getElementById('profile-btn');
  const drp = document.getElementById('p-drop');
  if (btn && !btn.contains(e.target) && drp && !drp.contains(e.target)) {
    drp.classList.remove('open');
  }
});

function logoutUser() {
  // End any active break first
  if (breakInt) {
    clearInterval(breakInt);
    breakInt = null;
    fetch('/api/attendance/break/end', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': getToken() },
      body:    JSON.stringify({})
    }).catch(() => {});
  }

  fetch('/api/attendance/logout', { method: 'POST', headers: { 'x-session-token': getToken() } }).catch(()=>{}); fetch('/api/attendance/logout', { method: 'POST', headers: { 'x-session-token': getToken() } }).catch(()=>{}); fetch('/api/auth/logout', {
    method:  'POST',
    headers: { 'x-session-token': getToken() }
  }).catch(() => {});

  sessionStorage.clear();
  showToast('Logging out...', 'ok');
  setTimeout(() => { window.location.href = 'login.html'; }, 800);
}

function expLabel(c) {
  if (!c.expType || c.expType === 'Fresher') return 'Fresher';
  const p = [];
  if (c.expYears)  p.push(c.expYears);
  if (c.expMonths) p.push(c.expMonths);
  return p.length ? p.join(', ') : 'Experience';
}

// ── NAV ───────────────────────────────────────────────
function navTo(el, sec) {
  document.querySelectorAll('.sb-item').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.sb-sub-item').forEach(x => x.classList.remove('active'));
  if (el) el.classList.add('active');
  showSection(sec);
}

function showSection(sec) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('sec-' + sec);
  if (el) el.classList.add('active');
  if (sec === 'dashboard') setTimeout(renderPieChart, 50);
}

function toggleSub(el) {
  el.classList.toggle('open');
  document.getElementById('calls-sub').classList.toggle('open');
}
function toggleIntSub(el) {
  el.classList.toggle('open');
  document.getElementById('interview-sub').classList.toggle('open');
}
function toggleSchedSub(el) {
  el.classList.toggle('open');
  document.getElementById('sched-cand-sub').classList.toggle('open');
}

function navCallTab(el, tab) {
  document.querySelectorAll('.sb-item').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.sb-sub-item').forEach(x => x.classList.remove('active'));
  document.getElementById('nav-calls-parent').classList.add('active');
  if (el) el.classList.add('active');
  curCallTab = tab;
  showSection('calls');
  syncCallTabs();
  renderCalls();
}

function navIntTab(el, tab) {
  document.querySelectorAll('.sb-item').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.sb-sub-item').forEach(x => x.classList.remove('active'));
  document.getElementById('nav-interview-parent').classList.add('active');
  if (el) el.classList.add('active');
  curIntTab = tab;
  showSection('interviews');
  switchIntTab(null, tab);
}

function navCandTab(el, tab) {
  document.querySelectorAll('.sb-item').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.sb-sub-item').forEach(x => x.classList.remove('active'));
  document.getElementById('nav-scheduled-parent').classList.add('active');
  if (el) el.classList.add('active');
  curCandTab = tab;
  showSection('candidates');
  switchCandTab(null, tab);
}

function kpiNav(tab) {
  document.querySelectorAll('.sb-item').forEach(x => x.classList.remove('active'));
  if (['fresh','notinterested','rnr','callback','followups','interested'].includes(tab)) {
    curCallTab = tab;
    document.getElementById('nav-calls-parent').classList.add('active');
    showSection('calls');
    syncCallTabs();
    renderCalls();
  } else {
    curCandTab = tab;
    document.getElementById('nav-scheduled-parent').classList.add('active');
    showSection('candidates');
    switchCandTab(null, tab);
  }
}

// ── KPIs ──────────────────────────────────────────────
function countStatus(s) {
  return CANDIDATES.filter(c => c.status === s).length;
}

function updateKPIs() {
  const fresh      = countStatus('fresh');
  const interested = countStatus('interested');
  const notInt     = countStatus('notinterested');
  const rnr        = countStatus('rnr');
  const fu         = countStatus('followups');
  const callback   = countStatus('callback');
  const scheduled  = countStatus('scheduled');
  const registered   = CANDIDATES.filter(c => c.registered).length;
  const unregistered = CANDIDATES.filter(c => !c.registered && c.status !== 'fresh').length;
  const total        = CANDIDATES.length;
  const doj          = new Date(PROFILES[curProfile].doj);
  const days         = Math.floor((new Date() - doj) / 86400000);

  document.getElementById('k-total').textContent = total;
  document.getElementById('k-days').textContent  = days;
  document.getElementById('k-int').textContent   = interested;
  document.getElementById('k-ni').textContent    = notInt;
  document.getElementById('k-rnr').textContent   = rnr;
  document.getElementById('k-fu').textContent    = unregistered;
  document.getElementById('k-cb').textContent    = registered;
  document.getElementById('k-cb2').textContent   = fresh;

  document.getElementById('cnt-fresh').textContent = fresh;
  document.getElementById('cnt-fu').textContent    = fu;
  document.getElementById('cnt-rnr').textContent   = rnr;
  document.getElementById('cnt-cb').textContent    = callback;
  document.getElementById('cnt-ni2').textContent   = notInt;
  document.getElementById('cnt-int').textContent   = interested;

  document.getElementById('int-cnt-fu').textContent = fu + interested;
  document.getElementById('int-cnt-iv').textContent = scheduled;

  const re = document.getElementById('cand-cnt-reg');
  const ue = document.getElementById('cand-cnt-unreg');
  if (re) re.textContent = registered;
  if (ue) ue.textContent = unregistered;
}

// ── CHART ─────────────────────────────────────────────
function renderPieChart() {
  const labels = ['Fresh','Interested','Follow-ups','RNR','Callback','Not Interested','Scheduled'];
  const values = [
    countStatus('fresh'), countStatus('interested'), countStatus('followups'),
    countStatus('rnr'), countStatus('callback'), countStatus('notinterested'), countStatus('scheduled')
  ];
  const colors = ['#4a6080','#27ae60','#1F9A94','#e67e22','#1a5276','#e74c3c','#6c3fc1'];
  const total  = values.reduce((a, b) => a + b, 0);
  const canvas = document.getElementById('statusPieChart');
  if (!canvas) return;

  if (pieChart) {
    pieChart.data.datasets[0].data = values;
    pieChart.update();
  } else {
    const ctx = canvas.getContext('2d');
    pieChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Candidates', data: values,
          borderColor: '#1F9A94', backgroundColor: 'rgba(31,154,148,0.2)',
          tension: 0.4, fill: true, pointRadius: 5, pointBackgroundColor: '#1F9A94'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => { const v = ctx.parsed.y; const pct = total > 0 ? ((v/total)*100).toFixed(1) : 0; return ` ${ctx.label}: ${v} (${pct}%)`; } } }
        },
        animation: { duration: 600 }
      }
    });
  }

  const legendEl = document.getElementById('chart-legend-list');
  if (legendEl) {
    legendEl.innerHTML = labels.map((lbl, i) => {
      const cnt = values[i];
      const pct = total > 0 ? ((cnt/total)*100).toFixed(1) : '0.0';
      return `<div class="legend-item">
        <div class="legend-dot" style="background:${colors[i]}"></div>
        <span class="legend-lbl">${lbl}</span>
        <span class="legend-cnt">${cnt}</span>
        <span class="legend-pct">${pct}%</span>
      </div>`;
    }).join('');
  }
}

// ── RECENT ACTIVITY ───────────────────────────────────
function renderDashRecent() {
  const recent = CANDIDATES.filter(c => c.notes && c.notes.trim()).slice(-10).reverse();
  const tb = document.getElementById('dash-tbody');
  if (!recent.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty"><p>No activity yet. Start processing calls.</p></div></td></tr>';
    return;
  }
  tb.innerHTML = recent.map(c => `<tr>
    <td><strong>${esc(c.name)}</strong></td>
    <td>${badge(c.status)}</td>
    <td style="font-size:12px;color:var(--text-tag)">${esc(c.job)}</td>
    <td class="notes-cell">${esc(c.notes)}</td>
    <td style="font-size:12px;color:var(--text-muted)">${esc(c.date)}</td>
  </tr>`).join('');
}

// ── CALL TABS ─────────────────────────────────────────
function syncCallTabs() {
  document.querySelectorAll('#call-tabs .t-btn').forEach(b => {
    const m = b.getAttribute('onclick') && b.getAttribute('onclick').match(/'(\w+)'\)/);
    if (m) b.classList.toggle('active', m[1] === curCallTab);
  });
  document.getElementById('add-cand-btn').style.display = curCallTab === 'fresh' ? 'flex' : 'none';
}

function switchCallTab(el, tab) {
  curCallTab = tab;
  document.querySelectorAll('#call-tabs .t-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  document.getElementById('add-cand-btn').style.display = tab === 'fresh' ? 'flex' : 'none';
  renderCalls();
}

function renderCalls() {
  const data     = CANDIDATES.filter(c => c.status === curCallTab);
  const tb       = document.getElementById('calls-tbody');
  const theadRow = document.getElementById('calls-thead-row');
  const isFollowups  = curCallTab === 'followups' || curCallTab === 'interested';
  const showNotesCol = ['interested','notinterested','rnr','callback','followups'].includes(curCallTab);

  let hd = `<th>SNO</th><th>Date</th><th>Candidate</th><th>Email</th><th>Contact</th>
             <th>Qualification</th><th>Job Title</th><th>Exposure</th><th>Exp. Salary</th>`;
  if (isFollowups)  hd += `<th>Follow-up Date/Time</th>`;
  if (showNotesCol) hd += `<th>Notes</th>`;
  hd += `<th>Action</th>`;
  theadRow.innerHTML = hd;

  const colCount = 9 + (isFollowups ? 1 : 0) + (showNotesCol ? 1 : 0) + 1;
  if (!data.length) {
    tb.innerHTML = `<tr><td colspan="${colCount}"><div class="empty"><p>No records in this category.</p></div></td></tr>`;
    return;
  }

  tb.innerHTML = data.map((c, i) => {
    let row = `<tr>
      <td style="color:var(--text-muted);font-size:12px">${i+1}</td>
      <td style="font-size:12px;color:var(--text-tag)">${esc(c.date)}</td>
      <td><strong>${esc(c.name)}</strong></td>
      <td style="font-size:12px">${esc(c.email)}</td>
      <td style="font-size:12px">${esc(c.contact)}</td>
      <td style="font-size:12px">${esc(c.qual)}</td>
      <td>${esc(c.job)}</td>
      <td style="font-size:12px">${esc(expLabel(c))}</td>
      <td style="font-size:12px">${esc(c.salary)}</td>`;
    if (isFollowups) {
      const dt = (c.followupDate || c.followupTime)
        ? `<span class="fu-date-badge">📅 ${c.followupDate ? new Date(c.followupDate).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) : ''}${c.followupTime?' '+esc(c.followupTime):''}</span>`
        : `<span style="color:var(--text-muted);font-size:12px">—</span>`;
      row += `<td>${dt}</td>`;
    }
    if (showNotesCol) row += `<td class="notes-cell">${c.notes ? esc(c.notes) : '<span style="color:var(--text-muted);font-size:12px">—</span>'}</td>`;
    row += `<td><button class="btn btn-dark btn-sm" onclick="openActionModal(${c.id})">Action</button></td></tr>`;
    return row;
  }).join('');
}

// ── INTERVIEWS ────────────────────────────────────────
function switchIntTab(el, tab) {
  curIntTab = tab;
  document.querySelectorAll('#int-tabs .t-btn').forEach(b => b.classList.remove('active'));
  if (el) {
    el.classList.add('active');
  } else {
    document.querySelectorAll('#int-tabs .t-btn').forEach(b => {
      const m = b.getAttribute('onclick') && b.getAttribute('onclick').match(/'(\w+)'\)/);
      if (m && m[1] === tab) b.classList.add('active');
    });
  }
  const ttl = document.getElementById('int-section-ttl');
  const sub = document.getElementById('int-section-sub');
  if (tab === 'followups') {
    if (ttl) ttl.textContent = 'Interview — Follow-up';
    if (sub) sub.textContent = 'Candidates marked as Interested or Follow-up';
  } else {
    if (ttl) ttl.textContent = 'Interview — Scheduled';
    if (sub) sub.textContent = 'Manually scheduled interview candidates';
  }
  renderInterviews();
}

function renderInterviews() {
  const thead = document.getElementById('int-thead');
  const tb    = document.getElementById('int-tbody');
  const data  = curIntTab === 'followups'
    ? CANDIDATES.filter(c => c.status === 'followups' || c.status === 'interested')
    : CANDIDATES.filter(c => c.status === 'scheduled');

  if (curIntTab === 'followups') {
    thead.innerHTML = `<tr><th>SNO</th><th>Candidate</th><th>Contact</th><th>Job Title</th><th>Exposure</th><th>Follow-up Date/Time</th><th>Resume</th><th>Status</th><th>Action</th></tr>`;
  } else {
    thead.innerHTML = `<tr><th>SNO</th><th>Candidate</th><th>Contact</th><th>Job Title</th><th>Exposure</th><th>Interview Date/Time</th><th>Resume</th><th>Notes</th><th>Status</th><th>Action</th></tr>`;
  }

  if (!data.length) {
    tb.innerHTML = `<tr><td colspan="10"><div class="empty"><p>No candidates in this stage.</p></div></td></tr>`;
    return;
  }

  if (curIntTab === 'followups') {
    tb.innerHTML = data.map((c, i) => `<tr>
      <td style="color:var(--text-muted);font-size:12px">${i+1}</td>
      <td><strong>${esc(c.name)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${esc(c.email)}</span></td>
      <td style="font-size:12px">${esc(c.contact)}</td>
      <td style="font-size:12px">${esc(c.job)}</td>
      <td style="font-size:12px">${esc(expLabel(c))}</td>
      <td>${(c.followupDate||c.followupTime)?`<span class="fu-date-badge">📅 ${c.followupDate ? new Date(c.followupDate).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) : ''}${c.followupTime?' '+esc(c.followupTime):''}</span>`:'<span style="color:var(--text-muted);font-size:12px">—</span>'}</td>
      <td>${c.resumePath?`<button class="btn-resume-view" onclick="viewResume(${c.id})">📎 ${esc(c.resumeName||'Resume')}</button>`:'<span style="color:var(--text-muted);font-size:12px">—</span>'}</td>
      <td>${badge(c.status)}</td>
      <td><button class="btn btn-teal btn-sm" onclick="openSchedModal(${c.id})">Schedule Interview</button></td>
    </tr>`).join('');
  } else {
    tb.innerHTML = data.map((c, i) => `<tr>
      <td style="color:var(--text-muted);font-size:12px">${i+1}</td>
      <td><strong>${esc(c.name)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${esc(c.email)}</span></td>
      <td style="font-size:12px">${esc(c.contact)}</td>
      <td style="font-size:12px">${esc(c.job)}</td>
      <td style="font-size:12px">${esc(expLabel(c))}</td>
      <td>${(c.followupDate||c.followupTime)?`<span class="fu-date-badge">📅 ${c.followupDate ? new Date(c.followupDate).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) : ''}${c.followupTime?' '+esc(c.followupTime):''}</span>`:'<span style="color:var(--text-muted);font-size:12px">—</span>'}</td>
      <td>${c.resumePath?`<button class="btn-resume-view" onclick="viewResume(${c.id})">📎 ${esc(c.resumeName||'Resume')}</button>`:'<span style="color:var(--text-muted);font-size:12px">—</span>'}</td>
      <td class="notes-cell">${esc(c.notes||'—')}</td>
      <td>${badge(c.status)}</td>
      <td><button class="btn btn-reschedule btn-sm" onclick="openReschedModal(${c.id})">Reschedule</button></td>
    </tr>`).join('');
  }
}

async function viewResume(id) {
  const c = CANDIDATES.find(x => x.id === id);
  if (!c || !c.resumePath) { showToast('No resume on file.', 'err'); return; }
  window.open(c.resumePath, '_blank');
  showToast('Opening: ' + (c.resumeName || 'resume'), 'ok');
}

// ── RESCHEDULE ────────────────────────────────────────
function openReschedModal(id) {
  schedCandId = id;
  const c = CANDIDATES.find(x => x.id === id);
  if (!c) return;
  document.getElementById('sched-modal-ttl').textContent  = 'Reschedule — ' + c.name;
  document.getElementById('sched-action-btn').textContent = 'Confirm Reschedule';
  document.getElementById('sched-action-btn').onclick     = doReschedule;
  document.getElementById('sched-fields').innerHTML = `
    <div class="f-grp"><label>Candidate</label><input type="text" readonly value="${esc(c.name)}"/></div>
    <div class="f-grp"><label>Job Title</label><input type="text" readonly value="${esc(c.job)}"/></div>
    <div class="f-grp"><label>New Follow-up Date <span class="req">*</span></label><input type="date" id="resched-date" min="${todayISO()}"/></div>
    <div class="f-grp"><label>New Follow-up Time</label><input type="time" id="resched-time"/></div>
    <div class="f-grp full"><label>Notes</label><textarea id="resched-notes" placeholder="Reason for rescheduling...">${esc(c.notes||'')}</textarea></div>`;
  document.getElementById('sched-overlay').classList.add('open');
}

async function doReschedule() {
  if (!schedCandId) return;
  const c = CANDIDATES.find(x => x.id === schedCandId);
  if (!c) return;
  const dateEl = document.getElementById('resched-date');
  const timeEl = document.getElementById('resched-time');
  if (!dateEl || !dateEl.value) { showToast('Please select a new follow-up date.', 'err'); return; }
  c.status       = 'followups';
  c.followupDate = dateEl.value || null;
  c.followupTime = timeEl && timeEl.value ? fmt12Hour(timeEl.value) : '';
  const n = document.getElementById('resched-notes');
  if (n && n.value.trim()) c.notes = n.value.trim();
  await dbUpdateCandidate(c);
  showToast(c.name + ' rescheduled.', 'ok');
  recordCallActivity();
  closeSchedMod();
  refreshAll();
}

// ── CANDIDATE STATUS ──────────────────────────────────
function switchCandTab(el, tab) {
  curCandTab = tab;
  document.querySelectorAll('#cand-tabs .t-btn').forEach(b => b.classList.remove('active'));
  if (el) {
    el.classList.add('active');
  } else {
    document.querySelectorAll('#cand-tabs .t-btn').forEach(b => {
      const m = b.getAttribute('onclick') && b.getAttribute('onclick').match(/'(\w+)'\)/);
      if (m && m[1] === tab) b.classList.add('active');
    });
  }
  const ttl = document.getElementById('cand-section-ttl');
  const sub = document.getElementById('cand-section-sub');
  if (tab === 'registered') {
    if (ttl) ttl.textContent = 'Registered Candidates';
    if (sub) sub.textContent = 'Candidates uploaded to ScreenIt';
  } else {
    if (ttl) ttl.textContent = 'Unregistered Candidates';
    if (sub) sub.textContent = 'Candidates in pipeline but not yet registered';
  }
  renderCandidates();
}

function renderCandidates() {
  const thead = document.getElementById('cand-thead');
  const tb    = document.getElementById('cand-tbody');
  if (!thead || !tb) return;
  const data = curCandTab === 'registered'
    ? CANDIDATES.filter(c => c.registered)
    : CANDIDATES.filter(c => !c.registered && c.status !== 'fresh');

  thead.innerHTML = `<tr><th>SNO</th><th>Candidate</th><th>Contact</th><th>Job Title</th><th>Exposure</th><th>Status</th><th>Interview Date/Time</th><th>Resume</th><th>Notes</th></tr>`;
  if (!data.length) {
    tb.innerHTML = `<tr><td colspan="9"><div class="empty"><p>No candidates in this category.</p></div></td></tr>`;
    return;
  }
  tb.innerHTML = data.map((c, i) => `<tr>
    <td style="color:var(--text-muted);font-size:12px">${i+1}</td>
    <td><strong>${esc(c.name)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${esc(c.email)}</span></td>
    <td style="font-size:12px">${esc(c.contact)}</td>
    <td style="font-size:12px">${esc(c.job)}</td>
    <td style="font-size:12px">${esc(expLabel(c))}</td>
    <td>${badge(c.status)}</td>
    <td>${(c.followupDate||c.followupTime)?`<span class="fu-date-badge">📅 ${c.followupDate ? new Date(c.followupDate).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) : ''}${c.followupTime?' '+esc(c.followupTime):''}</span>`:'<span style="color:var(--text-muted);font-size:12px">—</span>'}</td>
    <td>${c.resumePath?`<button class="btn-resume-view" onclick="viewResume(${c.id})">📎 ${esc(c.resumeName||'Resume')}</button>`:'<span style="color:var(--text-muted);font-size:12px">—</span>'}</td>
    <td class="notes-cell">${esc(c.notes||'—')}</td>
  </tr>`).join('');
}

// ── EXPOSURE FIELDS ───────────────────────────────────
function buildExpFields(expType, expYears, expMonths, prefix) {
  const isFresher = !expType || expType === 'Fresher';
  const yrSel = EXP_YEAR_OPTIONS.map(o  => `<option value="${o}"${expYears===o?' selected':''}>${o}</option>`).join('');
  const moSel = EXP_MONTH_OPTIONS.map(o => `<option value="${o}"${expMonths===o?' selected':''}>${o}</option>`).join('');
  return `
    <div class="f-grp full">
      <label>Exposure <span class="req">*</span></label>
      <select id="${prefix}-exptype" onchange="onExpTypeChange('${prefix}')">
        <option value="Fresher"${isFresher?' selected':''}>Fresher</option>
        <option value="Experience"${!isFresher?' selected':''}>Experience</option>
      </select>
    </div>
    <div class="f-grp${isFresher?' hidden':''}" id="${prefix}-exp-year-row">
      <label>Experience Years <span class="req">*</span></label>
      <select id="${prefix}-expyears"><option value="">— Select Years —</option>${yrSel}</select>
    </div>
    <div class="f-grp${isFresher?' hidden':''}" id="${prefix}-exp-month-row">
      <label>Experience Months <span class="req">*</span></label>
      <select id="${prefix}-expmonths"><option value="">— Select Months —</option>${moSel}</select>
    </div>`;
}

function onExpTypeChange(prefix) {
  const sel = document.getElementById(prefix+'-exptype');
  const yr  = document.getElementById(prefix+'-exp-year-row');
  const mo  = document.getElementById(prefix+'-exp-month-row');
  if (!sel) return;
  if (sel.value === 'Experience') {
    yr && yr.classList.remove('hidden');
    mo && mo.classList.remove('hidden');
  } else {
    yr && yr.classList.add('hidden');
    mo && mo.classList.add('hidden');
    const yv = document.getElementById(prefix+'-expyears');
    const mv = document.getElementById(prefix+'-expmonths');
    if (yv) yv.value = '';
    if (mv) mv.value = '';
  }
}

// ── ACTION MODAL ──────────────────────────────────────
function openActionModal(id) {
  const c = CANDIDATES.find(x => x.id === id);
  if (!c) return;
  activeMod = { type: 'action', id };
  document.getElementById('mod-ttl').textContent = esc(c.name) + ' — Action';
  const expHtml = buildExpFields(c.expType||'Fresher', c.expYears||'', c.expMonths||'', 'ac');
  document.getElementById('mod-fields').innerHTML = `
    <div class="m-section-lbl" style="grid-column:1/-1;margin-bottom:2px;">✏️ Edit Details</div>
    <div class="f-grp"><label>Candidate Name <span class="req">*</span></label><input type="text" id="ac-name" value="${esc(c.name)}"/></div>
    <div class="f-grp"><label>Date</label><input type="date" id="ac-date" value="${isoFromDisplay(c.date)}"/></div>
    <div class="f-grp"><label>Email <span class="req">*</span></label><input type="email" id="ac-email" value="${esc(c.email)}" placeholder="example@gmail.com"/></div>
    <div class="f-grp"><label>Contact <span class="req">*</span></label><input type="tel" id="ac-contact" value="${esc(c.contact)}" maxlength="15" placeholder="10-digit number" oninput="this.value=this.value.replace(/[^0-9+\s]/g,'').slice(0,17)"/></div>
    <div class="f-grp"><label>Qualification</label><input type="text" id="ac-qual" value="${esc(c.qual)}"/></div>
    <div class="f-grp"><label>Job Title</label><input type="text" id="ac-job" value="${esc(c.job)}"/></div>
    ${expHtml}
    <div class="f-grp"><label>Expected Salary</label><input type="text" id="ac-salary" value="${esc(c.salary)}"/></div>
    <hr class="m-divider"/>
    <div class="m-section-lbl">🔄 Update Status</div>
    <div class="f-grp full">
      <label>Status <span class="req">*</span></label>
      <select id="mod-status" onchange="onStatusChange()">
        <option value="">— Select Status —</option>
        <option value="interested">Interested</option>
        <option value="notinterested">Not Interested</option>
        <option value="rnr">RNR</option>
        <option value="followups">Follow-up</option>
        <option value="callback">Callback</option>
      </select>
    </div>
    <div class="f-grp full hidden" id="fu-date-row">
      <label>Follow-up Date <span class="req">*</span></label>
      <input type="date" id="mod-fu-date" min="${todayISO()}"/>
    </div>
    <div class="f-grp hidden" id="fu-time-row">
      <label>Follow-up Time</label>
      <input type="time" id="mod-fu-time"/>
    </div>
    <div class="f-grp full hidden" id="resume-upload-row">
      <label>Upload Resume</label>
      <button class="btn btn-outline" style="margin-top:4px;" onclick="pickResume('mod')">📂 Browse Resume…</button>
      <div class="resume-file-name" id="mod-resume-name" style="margin-top:6px;font-size:12px;color:var(--text-tag)"></div>
    </div>
    <div class="f-grp full">
      <label>Notes <span class="req">*</span></label>
      <textarea id="mod-notes" placeholder="Notes are mandatory...">${esc(c.notes||'')}</textarea>
    </div>`;
  const ab = document.getElementById('mod-action-btn');
  ab.textContent   = 'Save & Wrap Up';
  ab.style.display = 'inline-block';
  ab.onclick       = doActionSave;
  document.getElementById('mod-overlay').classList.add('open');
}

function onStatusChange() {
  const sel    = document.getElementById('mod-status');
  const fuRow  = document.getElementById('fu-date-row');
  const fuTime = document.getElementById('fu-time-row');
  const resRow = document.getElementById('resume-upload-row');
  if (!sel) return;
  if (sel.value === 'interested') {
    fuRow  && fuRow.classList.remove('hidden');
    fuTime && fuTime.classList.remove('hidden');
    resRow && resRow.classList.remove('hidden');
  } else {
    fuRow  && fuRow.classList.add('hidden');
    fuTime && fuTime.classList.add('hidden');
    resRow && resRow.classList.add('hidden');
  }
}

async function pickResume(prefix) {
  const file = await new Promise(resolve => {
    const inp  = document.createElement('input');
    inp.type   = 'file';
    inp.accept = '.pdf,.doc,.docx';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
  if (!file) return;
  window._pendingResumeFile = file;
  const el = document.getElementById(prefix + '-resume-name');
  if (el) el.textContent = '✅ ' + file.name + ' (ready to upload)';
}

async function doActionSave() {
  const c = CANDIDATES.find(x => x.id === activeMod.id);
  if (!c) return;
  const name    = (document.getElementById('ac-name').value    || '').trim();
  const email   = (document.getElementById('ac-email').value   || '').trim();
  const contact = (document.getElementById('ac-contact').value || '').trim();
  const notes   = (document.getElementById('mod-notes').value  || '').trim();
  const sel     = document.getElementById('mod-status');

  if (!name)  { showToast('Candidate name is required.', 'err'); return; }
  if (!email || !email.includes('@')) { showToast('Valid email with @ is required.', 'err'); return; }
  if (!contact || contact.replace(/[^0-9]/g,"").length < 10) { showToast('Contact must be 10-15 digits.', 'err'); return; }
  if (!notes) { showToast('Notes are mandatory.', 'err'); return; }
  if (!sel || !sel.value) { showToast('Please select a status.', 'err'); return; }

  const expTypeSel   = document.getElementById('ac-exptype');
  const expYearsSel  = document.getElementById('ac-expyears');
  const expMonthsSel = document.getElementById('ac-expmonths');
  const expType      = expTypeSel ? expTypeSel.value : 'Fresher';

  if (expType === 'Experience') {
    if (!expYearsSel  || !expYearsSel.value)  { showToast('Please select experience years.', 'err'); return; }
    if (!expMonthsSel || !expMonthsSel.value) { showToast('Please select experience months.', 'err'); return; }
  }

  const dateEl    = document.getElementById('ac-date');
  c.name          = name;
  c.date          = dateEl && dateEl.value ? dateEl.value : c.date;
  c.email         = email;
  c.contact       = contact;
  c.qual          = (document.getElementById('ac-qual').value   || c.qual).trim();
  c.job           = (document.getElementById('ac-job').value    || c.job).trim();
  c.salary        = (document.getElementById('ac-salary').value || c.salary).trim();
  c.notes         = notes;
  c.expType       = expType;
  c.expYears      = expYearsSel  ? expYearsSel.value  : '';
  c.expMonths     = expMonthsSel ? expMonthsSel.value : '';

  const selectedStatus = sel.value;

  if (selectedStatus === 'interested') {
    const fuDateEl = document.getElementById('mod-fu-date');
    const fuTimeEl = document.getElementById('mod-fu-time');
    if (!fuDateEl || !fuDateEl.value) { showToast('Please select a follow-up date.', 'err'); return; }
    c.status       = 'interested';
    c.followupDate = fuDateEl.value || null;
    c.followupTime = fuTimeEl && fuTimeEl.value ? fmt12Hour(fuTimeEl.value) : '';

    if (window._pendingResumeFile) {
      const uploaded = await uploadResumeToServer(window._pendingResumeFile, c.id);
      if (uploaded) { c.resumePath = uploaded.path; c.resumeName = uploaded.name; }
      window._pendingResumeFile = null;
    }

    await dbUpdateCandidate(c);
    closeMod();
    pendingUploadCandId = c.id;
    document.getElementById('upload-cand-name').textContent = c.name;
    document.getElementById('upload-overlay').classList.add('open');
  } else {
    c.status = selectedStatus;
    if (selectedStatus !== 'followups') { c.followupDate = ''; c.followupTime = ''; }
    await dbUpdateCandidate(c);
    showToast(c.name + ' updated → ' + STATUS_LABELS[selectedStatus] + '.', 'ok');
    recordCallActivity();
    closeMod();
    refreshAll();
  }
}

// ── UPLOAD DECISION ───────────────────────────────────
function closeUploadModal() {
  document.getElementById('upload-overlay').classList.remove('open');
  pendingUploadCandId = null;
}

async function doUploadDecision(yes) {
  document.getElementById('upload-overlay').classList.remove('open');
  if (pendingUploadCandId !== null) {
    const c = CANDIDATES.find(x => x.id === pendingUploadCandId);
    if (c) {
      if (yes) { c.registered = true; showToast(c.name + ' uploaded to ScreenIt & added to Follow-up.', 'ok'); }
      else        showToast(c.name + ' added to Interview Follow-up (no upload).', 'ok');
      await dbUpdateCandidate(c);
    }
  }
  pendingUploadCandId = null;
  recordCallActivity();
  refreshAll();
}

// ── ADD MODAL ─────────────────────────────────────────
function openAddModal() {
  activeMod = { type: 'add' };
  document.getElementById('mod-ttl').textContent = 'Add New Candidate';
  const expHtml = buildExpFields('Fresher', '', '', 'af');
  document.getElementById('mod-fields').innerHTML = `
    <div class="f-grp"><label>Candidate Name <span class="req">*</span></label><input type="text" id="af-name" placeholder="Full name"/></div>
    <div class="f-grp"><label>Date <span class="req">*</span></label><input type="date" id="af-date" value="${todayISO()}"/></div>
    <div class="f-grp"><label>Email <span class="req">*</span></label><input type="email" id="af-email" placeholder="example@gmail.com"/></div>
    <div class="f-grp"><label>Contact <span class="req">*</span></label><input type="tel" id="af-contact" maxlength="15" placeholder="10-digit number" oninput="this.value=this.value.replace(/[^0-9+\s]/g,'').slice(0,17)"/></div>
    <div class="f-grp"><label>Qualification</label><input type="text" id="af-qual" placeholder="B.E., MBA..."/></div>
    <div class="f-grp"><label>Job Title</label><input type="text" id="af-job" placeholder="Role applied for"/></div>
    ${expHtml}
    <div class="f-grp"><label>Expected Salary</label><input type="text" id="af-salary" placeholder="e.g. 4.5 LPA"/></div>`;
  const ab       = document.getElementById('mod-action-btn');
  ab.textContent = 'Add Candidate';
  ab.style.display = 'inline-block';
  ab.onclick     = doAddCandidate;
  document.getElementById('mod-overlay').classList.add('open');
}

function closeMod() {
  document.getElementById('mod-overlay').classList.remove('open');
  activeMod = null;
  window._pendingResumeFile = null;
}

async function doAddCandidate() {
  const name    = (document.getElementById('af-name').value    || '').trim();
  const email   = (document.getElementById('af-email').value   || '').trim();
  const contact = (document.getElementById('af-contact').value || '').trim();
  if (!name)  { showToast('Candidate name is required.', 'err'); return; }
  if (!email || !email.includes('@')) { showToast('Valid email with @ is required.', 'err'); return; }
  if (!contact || contact.replace(/[^0-9]/g,"").length < 10) { showToast('Contact must be 10-15 digits.', 'err'); return; }

  const expTypeSel   = document.getElementById('af-exptype');
  const expYearsSel  = document.getElementById('af-expyears');
  const expMonthsSel = document.getElementById('af-expmonths');
  const expType      = expTypeSel ? expTypeSel.value : 'Fresher';

  if (expType === 'Experience') {
    if (!expYearsSel  || !expYearsSel.value)  { showToast('Please select experience years.', 'err'); return; }
    if (!expMonthsSel || !expMonthsSel.value) { showToast('Please select experience months.', 'err'); return; }
  }

  const dateRaw = document.getElementById('af-date').value;
  const newCand = {
    date:         dateRaw ? dateRaw : todayISO(),
    name, email, contact,
    qual:         (document.getElementById('af-qual').value   || '—').trim(),
    job:          (document.getElementById('af-job').value    || '—').trim(),
    expType,
    expYears:     expYearsSel  ? expYearsSel.value  : '',
    expMonths:    expMonthsSel ? expMonthsSel.value : '',
    salary:       (document.getElementById('af-salary').value || '—').trim(),
    status:       'fresh',
    notes:        '',
    followupDate: '',
    followupTime: '',
    resumePath:   '',
    resumeName:   '',
    registered:   false
  };

  const newId = await dbAddCandidate(newCand);
  if (newId) {
    newCand.id = newId;
    CANDIDATES.push(newCand);
    showToast(name + ' added successfully.', 'ok');
    recordCallActivity();
    closeMod();
    refreshAll();
  } else {
    showToast('Failed to add candidate.', 'err');
  }
}

// ── SCHEDULE MODAL ────────────────────────────────────
function openSchedModal(id) {
  schedCandId = id;
  const c = CANDIDATES.find(x => x.id === id);
  if (!c) return;
  document.getElementById('sched-modal-ttl').textContent  = 'Schedule Interview — ' + c.name;
  document.getElementById('sched-action-btn').textContent = 'Schedule';
  document.getElementById('sched-action-btn').onclick     = doSchedule;
  document.getElementById('sched-fields').innerHTML = `
    <div class="f-grp"><label>Candidate</label><input type="text" readonly value="${esc(c.name)}"/></div>
    <div class="f-grp"><label>Contact</label><input type="text" readonly value="${esc(c.contact)}"/></div>
    <div class="f-grp"><label>Job Title</label><input type="text" readonly value="${esc(c.job)}"/></div>
    <div class="f-grp"><label>Exposure</label><input type="text" readonly value="${esc(expLabel(c))}"/></div>
    <div class="f-grp"><label>Interview Date <span class="req">*</span></label><input type="date" id="sched-date" min="${todayISO()}"/></div>
    <div class="f-grp"><label>Interview Time <span class="req">*</span></label><input type="time" id="sched-time"/></div>
    <div class="f-grp full">
      <label>Resume</label>
      <button class="btn btn-outline" style="margin-top:4px;" onclick="pickResume('sched')">📂 ${c.resumeName ? '📎 '+esc(c.resumeName)+' — Click to Replace' : 'Browse Resume…'}</button>
      <div class="resume-file-name" id="sched-resume-name" style="margin-top:6px;font-size:12px;color:var(--text-tag)"></div>
    </div>
    <div class="f-grp full"><label>Notes</label><textarea id="sched-notes" placeholder="Interview notes, location, round details...">${esc(c.notes||'')}</textarea></div>`;
  document.getElementById('sched-overlay').classList.add('open');
}

function closeSchedMod() {
  document.getElementById('sched-overlay').classList.remove('open');
  schedCandId = null;
  window._pendingResumeFile = null;
}

async function doSchedule() {
  if (!schedCandId) return;
  const c = CANDIDATES.find(x => x.id === schedCandId);
  if (!c) return;
  const dateEl = document.getElementById('sched-date');
  const timeEl = document.getElementById('sched-time');
  if (!dateEl || !dateEl.value) { showToast('Please select an interview date.', 'err'); return; }
  c.status       = 'scheduled';
  c.followupDate = dateEl.value || null;
  c.followupTime = timeEl && timeEl.value ? fmt12Hour(timeEl.value) : '';
  c.registered   = true;
  const ne = document.getElementById('sched-notes');
  if (ne && ne.value.trim()) c.notes = ne.value.trim();

  if (window._pendingResumeFile) {
    const uploaded = await uploadResumeToServer(window._pendingResumeFile, c.id);
    if (uploaded) { c.resumePath = uploaded.path; c.resumeName = uploaded.name; }
    window._pendingResumeFile = null;
  }

  await dbUpdateCandidate(c);
  showToast(c.name + ' scheduled for ' + c.followupDate + (c.followupTime ? ' at ' + c.followupTime : '') + '.', 'ok');
  recordCallActivity();
  closeSchedMod();
  refreshAll();
}

// ── REFRESH ALL ───────────────────────────────────────
function refreshAll() {
  updateKPIs();
  renderDashRecent();
  renderPieChart();
  renderCalls();
  renderInterviews();
  renderCandidates();
}

// ── BREAK ─────────────────────────────────────────────
function startBreak(type, resumeSecs = null) {
  if (activityTimer) { showToast((activityType === 'meeting' ? 'Meeting' : 'Training') + ' is already active. Please stop it first.'); return; }
  if (breakInt) { showToast('A break is already active.'); return; }
  clearTimeout(idleTimer); idleTimer = null; if (idleStart) { totalIdleMins += Math.floor((new Date() - idleStart) / 60000); idleStart = null; }

  const mins  = type === 'short' ? 15 : 30;
  const label = type === 'short' ? 'Short Break' : 'Lunch Break';

  // If resuming, use remaining seconds; otherwise full duration
  let secs = resumeSecs !== null ? resumeSecs : mins * 60;

  document.getElementById('brk-lbl-txt').textContent = label + ' (' + mins + ' min)';
  document.getElementById('brk-cd').textContent =
    pad(Math.floor(secs / 60)) + ':' + pad(secs % 60);
  document.getElementById('brk-badge').classList.add('show');
  document.getElementById('short-brk-btn').classList.toggle('on', type === 'short');
  document.getElementById('lunch-brk-btn').classList.toggle('on', type === 'lunch');

  // Only call break/start API if this is a NEW break (not a resume)
  if (resumeSecs === null) {
    fetch('/api/attendance/break/start', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': getToken() },
      body:    JSON.stringify({ breakType: type })
    }).catch(() => {});
  }

  breakInt = setInterval(() => {
    secs--;
    const m = Math.floor(secs / 60), s = secs % 60;
    document.getElementById('brk-cd').textContent = pad(m) + ':' + pad(s);
    if (secs <= 0) autoEndBreak();
  }, 1000);

  if (resumeSecs === null) showToast(label + ' started.');
  else showToast(label + ' resumed — ' + pad(Math.floor(secs/60)) + ':' + pad(secs%60) + ' remaining.');
}

function autoEndBreak() { clearBreak(); showToast('Break ended. Welcome back!', 'ok'); }
function clearBreak() {
  clearInterval(breakInt); breakInt = null; resetIdleTimer();
  document.getElementById('brk-badge').classList.remove('show');
  document.getElementById('short-brk-btn').classList.remove('on');
  document.getElementById('lunch-brk-btn').classList.remove('on');
  document.getElementById('brk-cd').textContent = '15:00'; // reset display to default

  fetch('/api/attendance/break/end', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': getToken() },
    body:    JSON.stringify({})
  }).catch(() => {});
}

// ── IDLE ──────────────────────────────────────────────
function recordCallActivity() {
  if (isIdle) { isIdle = false; document.getElementById('idle-overlay').classList.remove('show'); }
  resetIdleTimer();
}
function resetIdleTimer() {
  if (breakInt) return; // Don't reset idle timer during breaks
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { isIdle = true; idleStart = new Date(); document.getElementById('idle-overlay').classList.add('show'); }, 10*60*1000);
}
function setupCallIdle() { resetIdleTimer(); }
function dismissIdle() {
  if (idleStart) { totalIdleMins += Math.floor((new Date() - idleStart) / 60000); idleStart = null; fetch('/api/attendance/idle', {method:'POST', headers:{'Content-Type':'application/json','x-session-token':localStorage.getItem('sessionToken')}, body:JSON.stringify({idleMins:totalIdleMins})}).catch(()=>{}); }
  isIdle = false;
  document.getElementById('idle-overlay').classList.remove('show');
  resetIdleTimer();
}

// ── BADGE & TOAST ─────────────────────────────────────
function badge(s) {
  return `<span class="badge ${BADGE_CLASS[s]||'b-gray'}">${STATUS_LABELS[s]||s}</span>`;
}
function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (type ? ' '+type : '');
  clearTimeout(toastTm);
  toastTm = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── UTILS ─────────────────────────────────────────────
function fmtTime(d) {
  let h = d.getHours(), m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${pad(h)}:${pad(m)} ${ap}`;
}
function fmt12Hour(s) {
  if (!s) return '';
  const [hh, mm] = s.split(':');
  let h = parseInt(hh, 10);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${pad(h)}:${mm} ${ap}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() { return new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }); }
function todayISO() { const d = new Date(); const offset = d.getTimezoneOffset(); const local = new Date(d.getTime() - offset * 60000); return local.toISOString().split('T')[0]; }
function formatDateDisplay(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}
function isoFromDisplay(s) {
  if (!s) return todayISO();
  try {
    const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
    const parts  = s.trim().split(' ');
    if (parts.length === 3) {
      const day = parseInt(parts[0],10), mon = months[parts[1]], yr = parseInt(parts[2],10);
      if (!isNaN(day) && mon !== undefined && !isNaN(yr))
        { const dd=new Date(yr,mon,day); return dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0')+'-'+String(dd.getDate()).padStart(2,'0'); }
    }
    const d = new Date(s);
    if (!isNaN(d)) { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+day; }
  } catch(e) {}
  return todayISO();
}
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Reset idle timer on any user activity
document.addEventListener('mousemove', resetIdleTimer);
document.addEventListener('keypress', resetIdleTimer);
document.addEventListener('click', resetIdleTimer);
document.addEventListener('scroll', resetIdleTimer);


// ── MEETING & TRAINING ────────────────────────────────
let _runningActivityType = null, activityType = null, activityStart = null, activityTimer = null, activityTopic = '', activityWith = '', activityNotes = '';

function openActivityModal(type) {
  activityType = type;
  document.getElementById('activity-modal-title').textContent = type === 'meeting' ? 'Meeting Details' : 'Training Details';
  document.getElementById('activity-topic').value = '';
  document.getElementById('activity-with').value = '';
  document.getElementById('activity-notes').value = '';
  document.getElementById('activity-modal').style.display = 'flex';
}

function closeActivityModal() {
  document.getElementById('activity-modal').style.display = 'none';
}

function startActivity() {
  if (activityTimer) { showToast((_runningActivityType === 'meeting' ? 'Meeting' : 'Training') + ' is already active. Please stop it first.'); document.getElementById('activity-modal').style.display = 'none'; activityType = _runningActivityType; return; }
  _runningActivityType = activityType;
  activityTopic = document.getElementById('activity-topic').value.trim();
  activityWith = document.getElementById('activity-with').value.trim();
  activityNotes = document.getElementById('activity-notes').value.trim();
  if (!activityTopic) { alert('Please enter a topic!'); return; }
  closeActivityModal();
  activityStart = new Date();
  clearTimeout(idleTimer); idleTimer = null;
  document.getElementById('brk-lbl-txt').textContent = activityType === 'meeting' ? 'Meeting' : 'Training';
  document.getElementById('brk-badge').classList.add('show');
  document.getElementById('meeting-btn').classList.toggle('on', activityType === 'meeting');
  document.getElementById('training-btn').classList.toggle('on', activityType === 'training');
  document.getElementById("brk-cd").textContent = "00:00";
  let secs = 0;
  activityTimer = setInterval(() => {
    secs++;
    document.getElementById('brk-cd').textContent = pad(Math.floor(secs/60)) + ':' + pad(secs%60);
  }, 1000);
  fetch('/api/attendance/activity/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': getToken() },
    body: JSON.stringify({ activityType, topic: activityTopic, withWhom: activityWith, notes: activityNotes })
  }).catch(() => {});
  showToast((activityType === 'meeting' ? 'Meeting' : 'Training') + ' started!', 'ok');
}

function stopActivity() {
  if (!activityTimer) return;
  clearInterval(activityTimer); activityTimer = null;
  const durationMins = Math.floor((new Date() - activityStart) / 60000);
  document.getElementById('brk-badge').classList.remove('show');
  document.getElementById('meeting-btn').classList.remove('on');
  document.getElementById('training-btn').classList.remove('on');
  document.getElementById('brk-cd').textContent = '00:00';
  fetch('/api/attendance/activity/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': getToken() },
    body: JSON.stringify({ activityType, durationMins })
  }).catch(() => {});
  resetIdleTimer();
  showToast((activityType === 'meeting' ? 'Meeting' : 'Training') + ' ended — ' + durationMins + ' mins!', 'ok');
  activityType = null; activityStart = null; _runningActivityType = null;
}
