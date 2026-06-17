// =====================================================
// THE GOJOBSYNC — INTERVIEW DASHBOARD — interview.js (v11)
// FIXES: localStorage push to placement on submitToHR,
//        break status sync, all original features intact
// =====================================================
 
// ── SESSION ───────────────────────────────────────────
const INT_USER_ID   = parseInt(sessionStorage.getItem('crm_recruiter_id') || '0', 10);
const INT_USER_NAME = sessionStorage.getItem('crm_user_name') || 'Ramya';
const INT_USER_IMG  = sessionStorage.getItem('crm_user_img')  || 'ramya.jpeg';
const INT_ROLE      = sessionStorage.getItem('crm_role')      || 'interviewer';
 
// Redirect non-interviewers
if (INT_ROLE !== 'interviewer') { window.location.href = 'crm.html'; }
 
function logoutUser() {
  setBreakStatus('present'); // Clear break on logout
  sessionStorage.clear();
  window.location.href = '/login.html';
}
 
// ── CANDIDATE DATA (loaded from DB) ───────────────────
const CANDIDATES = { soundariya: [], tharshini: [] };
 
const RECRUITER_META = {
  soundariya: { name: 'Soundariya', photo: 'WhatsApp Image 2026-04-03 at 10.09.47 AM.jpeg', initial: 'S', id: 1 },
  tharshini:  { name: 'Tharshini',  photo: 'WhatsApp Image 2026-04-03 at 11.06.00 AM.jpeg', initial: 'T', id: 2 }
};
 
const STATUS_LABELS = {
  fresh:'Fresh Dump', followups:'Follow-Up', interested:'Interested',
  rnr:'RNR', callback:'Callback', notinterested:'Not Interested',
  scheduled:'Scheduled', rejected:'Rejected', submitted:'Submitted to HR',
  payment_pending:'Payment Pending', reg_pending:'Reg. Pending', placement:'Placed ✓'
};
const BADGE_CLASS = {
  fresh:'b-gray', followups:'b-teal', interested:'b-green', rnr:'b-orange',
  callback:'b-blue', notinterested:'b-red', scheduled:'b-purple',
  rejected:'b-red', submitted:'b-green', payment_pending:'b-orange',
  reg_pending:'b-blue', placement:'b-green'
};
 
const COUNTRIES = [
  'UAE','Saudi Arabia','Qatar','Kuwait','Bahrain','Oman','Singapore','Malaysia',
  'Canada','Australia','UK','Germany','USA','New Zealand','Japan','South Korea',
  'Hong Kong','Netherlands','Sweden','Norway','Denmark','France','Switzerland','Other'
];
 
// ── STATE ─────────────────────────────────────────────
let curRecruiter = 'soundariya';
let curCandidate = null;
let currentStep  = 1;
let stepData     = {};
let toastTimer   = null;
 
const RESUME_STORE         = {};
const SUBMITTED_LIST       = [];
const PAYMENT_PENDING_LIST = [];
const REG_PENDING_LIST     = [];
const FOLLOWUP_NOTES       = {};
const CANDIDATE_PROGRESS   = {};
const PLACEMENT_LIST       = [];
const ACTIVITY_FEED        = [];
 
let totalInterviewsTaken = 0;
let totalConversions     = 0;
 
const STEP_LABELS = ['Details', 'Decision', 'Payment', 'Registration & Form', 'Final'];
const TOTAL_STEPS = 5;
 
// ── INIT ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  updateGreeting();
  updateDateTime();
  setInterval(updateDateTime, 1000);
 
  _applyInterviewerUI();
  _restoreBreakStatus();
 
  await _loadScheduledCandidates();
 
  renderKPIs();
  renderPaymentPendingTable();
  renderRegPendingTable();
  renderDashboardNotesTable();
  updateSidebarFollowupCounts();
  renderPlacementSidebar();
});
 
function _applyInterviewerUI() {
  const gn = document.querySelector('.greeting-name');
  if (gn) gn.textContent = INT_USER_NAME;
  const intName = document.querySelector('.int-name-top');
  if (intName) intName.textContent = INT_USER_NAME;
  document.querySelectorAll('img[alt="Ramya"]').forEach(img => {
    img.src = INT_USER_IMG || 'ramya.jpeg';
  });
}
 
async function _loadScheduledCandidates() {
  try {
    const token = sessionStorage.getItem('crm_token') || '';
    const res = await fetch('/api/candidates', {
      headers: { 'x-session-token': token }
    });
    const data = await res.json();
    const rows = (data.candidates || []).filter(r => r.status === 'scheduled');
    CANDIDATES.soundariya = [];
    CANDIDATES.tharshini  = [];

    rows.forEach(r => {
      if (r.status !== 'scheduled') return;
      const obj = {
        id:           r.id,
        name:         r.name        || '',
        contact:      r.contact     || '',
        email:        r.email       || '',
        qual:         r.qual        || '',
        exp:          _expLabel(r),
        status:       r.status      || 'scheduled',
        resumeName:   r.resumeName  || '',
        resumePath:   r.resumePath  || '',
        recruiterName: r.recruiter_name || '',
        notes:        r.notes       || '',
        followupDate: r.followupDate || '',
        interviewStatus: r.interview_status || ''
      };
      const rname = (r.recruiter_name || '').toLowerCase();
if (rname.includes('sound') || rname.includes('sownd') || r.created_by === 'rec001')
    CANDIDATES.soundariya.push(obj);
else if (rname.includes('thar') || r.created_by === 'rec002')
    CANDIDATES.tharshini.push(obj);
    });

    // ── Load payment_pending and reg_pending from DB ──
    const allRows = data.candidates || [];

    allRows.filter(r => r.status === 'payment_pending').forEach(r => {
      if (!PAYMENT_PENDING_LIST.find(x => x.contact === r.contact)) {
        PAYMENT_PENDING_LIST.push({
          name: r.name, contact: r.contact, email: r.email,
          qual: r.qual||'—', exp: r.expType||'—',
          recruiter: r.recruiter_name || '—',
          preferredCountry: r.preferred_country || '—',
          candidateId: r.id
        });
      }
    });

    allRows.filter(r => r.status === 'reg_pending').forEach(r => {
      if (!REG_PENDING_LIST.find(x => x.contact === r.contact)) {
        REG_PENDING_LIST.push({
          name: r.name, contact: r.contact, email: r.email,
          qual: r.qual||'—', exp: r.expType||'—',
          recruiter: r.recruiter_name || '—',
          preferredCountry: r.preferred_country || '—',
          candidateId: r.id
        });
      }
    });

  } catch(e) {
    console.error('Load scheduled:', e);
  }
}
function _expLabel(r) {
  if (!r.expType || r.expType === 'Fresher') return 'Fresher';
  const p = [];
  if (r.expYears) p.push(r.expYears);
  if (r.expMonths) p.push(r.expMonths);
  return p.length ? p.join(', ') : 'Experience';
}
 
// ── LOGOUT ────────────────────────────────────────────
window.logoutUser = logoutUser;
 
// ── BREAK STATUS ──────────────────────────────────────
// Writes Ramya's break/present status to localStorage so
// placement.js can read and display it in real time.
 
function setBreakStatus(status) {
  // status: 'present' | 'Short Break' | 'Lunch Break'
  try {
    if (status === 'present') {
      localStorage.removeItem('ramya_break_status');
    } else {
      const dt = getAutoDateTime();
      localStorage.setItem('ramya_break_status', JSON.stringify({
        status: status,
        since: dt.readableTime
      }));
    }
  } catch(e) {}
  _updateBreakUI(status);
}
 
function _updateBreakUI(status) {
  // Update the status badge in the bottom-left sidebar footer
  const presEl = document.getElementById('ramya-status-badge');
  if (presEl) {
    if (status === 'present') {
      presEl.textContent = 'Present';
      presEl.style.background = 'rgba(39,174,96,.2)';
      presEl.style.color = '#27ae60';
    } else {
      presEl.textContent = status;
      presEl.style.background = 'rgba(230,126,34,.2)';
      presEl.style.color = '#b85c00';
    }
  }
  // Also update top-bar break buttons visual state
  const shortBtn = document.getElementById('btn-short-break');
  const lunchBtn = document.getElementById('btn-lunch-break');
  if (shortBtn) shortBtn.classList.toggle('active-break', status === 'Short Break');
  if (lunchBtn) lunchBtn.classList.toggle('active-break', status === 'Lunch Break');
}
 
function _restoreBreakStatus() {
  try {
    const saved = JSON.parse(localStorage.getItem('ramya_break_status') || 'null');
    if (saved && saved.status) {
      _updateBreakUI(saved.status);
    } else {
      _updateBreakUI('present');
    }
  } catch(e) {}
}
 
// ── GREETING / DATETIME ───────────────────────────────
function updateGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good Morning' : h < 15 ? 'Good Afternoon' : 'Good Evening';
  const el = document.getElementById('greeting-text');
  if (el) el.textContent = g;
}
function updateDateTime() {
  const now = new Date();
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  const el = document.getElementById('tb-datetime');
  if (el) el.textContent = days[now.getDay()] + ', ' + now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear() + '  ·  ' + pad(h) + ':' + pad(m) + ':' + pad(s) + ' ' + ap;
  updateGreeting();
}
function pad(n) { return String(n).padStart(2, '0'); }
function getCurrentDateTime() {
  const now = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let h = now.getHours(), m = now.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return {
    date: days[now.getDay()]+', '+now.getDate()+' '+months[now.getMonth()]+' '+now.getFullYear(),
    time: pad(h)+':'+pad(m)+' '+ap
  };
}
function getAutoDateTime() {
  const now = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let h = now.getHours(), m = now.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return {
    dateStr: now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate()),
    timeStr: pad(now.getHours())+':'+pad(now.getMinutes()),
    readableDate: days[now.getDay()]+', '+now.getDate()+' '+months[now.getMonth()]+' '+now.getFullYear(),
    readableTime: pad(h)+':'+pad(m)+' '+ap
  };
}
 
// ── KPIs ──────────────────────────────────────────────
function renderKPIs() {
  const sScheduled = CANDIDATES.soundariya.filter(c => c.status === 'scheduled').length;
  const tScheduled = CANDIDATES.tharshini.filter(c => c.status === 'scheduled').length;
  const total = sScheduled + tScheduled;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('k-total', total); set('k-today', total);
  set('k-sound', sScheduled); set('k-thar', tScheduled);
  set('k-interviews-taken', totalInterviewsTaken);
  set('k-conversions', totalConversions);
  set('sb-cnt-soundariya', sScheduled);
  set('sb-cnt-tharshini', tScheduled);
  updateSidebarPendingBadges();
  updateSidebarFollowupCounts();
  renderPlacementSidebar();
}
 
function updateSidebarPendingBadges() {
  const sP = PAYMENT_PENDING_LIST.filter(r => r.recruiter === 'Soundariya').length;
  const sR = REG_PENDING_LIST.filter(r => r.recruiter === 'Soundariya').length;
  const tP = PAYMENT_PENDING_LIST.filter(r => r.recruiter === 'Tharshini').length;
  const tR = REG_PENDING_LIST.filter(r => r.recruiter === 'Tharshini').length;
  const trySet = (id, count, show) => {
    const el = document.getElementById(id); if (!el) return;
    el.style.display = show ? 'flex' : 'none';
    const num = el.querySelector('.pnum'); if (num) num.textContent = count;
  };
  trySet('sb-pay-soundariya', sP, sP > 0); trySet('sb-reg-soundariya', sR, sR > 0);
  trySet('sb-pay-tharshini', tP, tP > 0);  trySet('sb-reg-tharshini', tR, tR > 0);
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s('sb-pay-cnt-soundariya', sP); s('sb-reg-cnt-soundariya', sR);
  s('sb-pay-cnt-tharshini', tP);  s('sb-reg-cnt-tharshini', tR);
  const sh = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? 'flex' : 'none'; };
  sh('sb-sound-pay-item', sP > 0); sh('sb-sound-reg-item', sR > 0);
  sh('sb-thar-pay-item', tP > 0);  sh('sb-thar-reg-item', tR > 0);
  s('sb-sound-pay-num', sP); s('sb-sound-reg-num', sR);
  s('sb-thar-pay-num', tP);  s('sb-thar-reg-num', tR);
}
function updateSidebarFollowupCounts() {
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s('sb-followup-pay-cnt', PAYMENT_PENDING_LIST.length);
  s('sb-followup-reg-cnt', REG_PENDING_LIST.length);
  const total = PAYMENT_PENDING_LIST.length + REG_PENDING_LIST.length;
  const badge = document.getElementById('sb-followup-badge');
  if (badge) { badge.textContent = total; badge.style.display = total > 0 ? 'flex' : 'none'; }
}
 
// ── PLACEMENT SIDEBAR ─────────────────────────────────
function renderPlacementSidebar() {
  const container = document.getElementById('sb-placement-list'); if (!container) return;
  const cnt = document.getElementById('sb-placement-cnt'); if (cnt) cnt.textContent = PLACEMENT_LIST.length;
  if (!PLACEMENT_LIST.length) {
    container.innerHTML = `<div style="padding:10px 16px 10px 22px;font-size:11px;color:rgba(255,255,255,.35);font-style:italic;">No placements yet</div>`;
    return;
  }
  container.innerHTML = PLACEMENT_LIST.map((p, idx) => `
    <div style="display:flex;align-items:center;gap:10px;padding:9px 16px 9px 22px;border-left:3px solid #27ae60;background:rgba(39,174,96,.08);cursor:pointer;" onclick="openPlacementDoc(${idx})">
      <div style="width:28px;height:28px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#27ae60,#1a7a40);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;">${esc(p.name.charAt(0))}</div>
      <div style="flex:1;min-width:0;"><div style="font-size:12px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.name)}</div>
      <div style="font-size:10px;color:rgba(255,255,255,.45);">${esc(p.country||'—')} · ${esc(p.recruiter)}</div></div>
      <span style="font-size:9px;font-weight:700;color:#2ecc71;background:rgba(39,174,96,.25);border-radius:8px;padding:2px 6px;white-space:nowrap;">📄 View</span>
    </div>`).join('');
}
function openPlacementDoc(idx) {
  const p = PLACEMENT_LIST[idx]; if (!p) return;
  _showEnrollmentPreviewModal(p.stepData || p, p.name);
}
function addActivity(type, candidateName, detail) {
  const dt = getCurrentDateTime();
  ACTIVITY_FEED.unshift({ type, candidateName, detail, date: dt.date, time: dt.time });
}
 
// ── VIEWS ─────────────────────────────────────────────
function showDashboard() {
  document.getElementById('view-dashboard').classList.add('active');
  document.getElementById('view-recruiter').classList.remove('active');
  document.getElementById('nav-dashboard').classList.add('active');
  renderPaymentPendingTable(); renderRegPendingTable();
  renderDashboardNotesTable(); renderKPIs();
}
function openRecruiterView(recruiter) {
  curRecruiter = recruiter;
  const meta = RECRUITER_META[recruiter];
  const data = (CANDIDATES[recruiter] || []).filter(c => c.status === 'scheduled' || c._outcome);
  document.getElementById('view-dashboard').classList.remove('active');
  document.getElementById('view-recruiter').classList.add('active');
  document.getElementById('rec-view-ttl').textContent = meta.name + "'s Candidates";
  document.getElementById('rec-view-sub').textContent = data.length + ' candidate' + (data.length !== 1 ? 's' : '') + ' scheduled';
  document.getElementById('rec-view-profile').innerHTML = `
    <div class="rec-view-ava"><img src="${esc(meta.photo)}" alt="${esc(meta.name)}" onerror="this.style.display='none';this.parentNode.textContent='${meta.initial}';"></div>
    <div><div class="rec-view-nm">${esc(meta.name)}</div><div class="rec-view-rl">Talent Acquisition · Recruiter</div></div>`;
  renderTable();
}
 
// ── TABLE ─────────────────────────────────────────────
function renderTable() {
  const data = (CANDIDATES[curRecruiter] || []).filter(c => c.status === 'scheduled' || c._outcome);
  const tb = document.getElementById('cand-tbody');
  if (!data.length) { tb.innerHTML = '<tr><td colspan="10"><div class="empty"><p>No scheduled candidates.</p></div></td></tr>'; return; }
  tb.innerHTML = data.map((c, i) => {
    const prog = CANDIDATE_PROGRESS[c.id];
    const isProcessed = c._outcome === 'submitted';
    let actionBtn;
    if (isProcessed) {
      actionBtn = `<button class="btn btn-teal btn-sm" onclick="viewCandidateDoc(${c.id})" style="white-space:nowrap;">📄 View Doc</button>`;
    } else if (prog) {
      actionBtn = `<button class="btn btn-teal btn-sm" onclick="resumeProceed(${c.id})">▶ Resume (Step ${prog.step})</button>`;
    } else {
      actionBtn = `<button class="btn btn-dark btn-sm" onclick="openProceed(${c.id})">Proceed</button>`;
    }
    const resumeBtn = c.resumeName
      ? `<button class="btn-resume-corner" onclick="previewResume(${c.id})" title="View Resume">📄 PDF</button>`
      : `<span style="color:var(--text-muted);font-size:11px;">—</span>`;
    const dateTimeCell = (c.followupDate || c.followupTime)
      ? `<div style="font-size:11px;"><div style="color:var(--teal);font-weight:700;">📅 ${esc(c.followupDate||'')}</div><div style="color:#6c3fc1;font-weight:600;">🕐 ${esc(c.followupTime||'')}</div></div>`
      : `<span style="color:var(--text-muted);font-size:11px;">—</span>`;
    return `<tr>
      <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
      <td><strong>${esc(c.name)}</strong></td>
      <td style="font-size:12px;">${esc(c.contact)}</td>
      <td style="font-size:12px;color:var(--text-tag);">${esc(c.email)}</td>
      <td style="font-size:12px;">${esc(c.qual)}</td>
      <td style="font-size:12px;">${esc(c.exp)}</td>
      <td>${badge(c.status)}</td>
      <td>${dateTimeCell}</td>
      <td>${resumeBtn}</td>
      <td><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${actionBtn}</div></td>
    </tr>`;
  }).join('');
}
function viewCandidateDoc(id) {
  const p = PLACEMENT_LIST.find(x => x.candidateId === id);
  if (p) _showEnrollmentPreviewModal(p.stepData || p, p.name);
  else showToast('Document not available.', 'err');
}
 
// ── PAYMENT PENDING ───────────────────────────────────
function renderPaymentPendingTable() {
  const tb = document.getElementById('payment-pending-tbody'); if (!tb) return;
  if (!PAYMENT_PENDING_LIST.length) { tb.innerHTML = '<tr><td colspan="8"><div class="empty"><p>No payment pending candidates.</p></div></td></tr>'; return; }
  tb.innerHTML = PAYMENT_PENDING_LIST.map((r, i) => `<tr>
    <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
    <td><strong>${esc(r.name)}</strong></td>
    <td style="font-size:12px;">${esc(r.contact)}</td>
    <td style="font-size:12px;color:var(--text-tag);">${esc(r.email)}</td>
    <td style="font-size:12px;">${esc(r.recruiter)}</td>
    <td style="font-size:12px;">${esc(r.preferredCountry||'—')}</td>
    <td><span class="badge b-orange">💳 Payment Pending</span></td>
    <td><button class="btn btn-teal btn-sm" onclick="proceedFromPaymentPending(${i})" style="white-space:nowrap;">▶ Proceed</button></td>
  </tr>`).join('');
}
function proceedFromPaymentPending(index) {
  const r = PAYMENT_PENDING_LIST[index]; if (!r) return;
  const all = [...CANDIDATES.soundariya, ...CANDIDATES.tharshini];
  let cObj = all.find(x => x.name === r.name && x.contact === r.contact);
  if (cObj) {
    curCandidate = cObj;
    curRecruiter = CANDIDATES.soundariya.find(x => x.id === cObj.id) ? 'soundariya' : 'tharshini';
    const prog = CANDIDATE_PROGRESS[cObj.id];
    if (prog) { currentStep = prog.step; stepData = { ...prog.stepData }; }
    else { currentStep = 3; stepData = { name:r.name, contact:r.contact, email:r.email, qual:r.qual||'', exp:r.exp||'', preferredCountry:r.preferredCountry||'', selected:'yes' }; }
    PAYMENT_PENDING_LIST.splice(index, 1);
    cObj.status = 'scheduled';
    if (cObj.id) fetch('/api/candidates/' + cObj.id, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ status:'scheduled' }), credentials:'include' }).catch(()=>{});
    _openModal(); renderPaymentPendingTable(); updateSidebarFollowupCounts(); updateSidebarPendingBadges(); renderKPIs();
  } else {
    curCandidate = { id:'pp_'+Date.now(), name:r.name, contact:r.contact, email:r.email, status:'payment_pending', resumeName:'' };
    curRecruiter = r.recruiter ? r.recruiter.toLowerCase() : 'soundariya';
    currentStep = 3;
    stepData = { name:r.name, contact:r.contact, email:r.email, qual:r.qual||'', exp:r.exp||'', preferredCountry:r.preferredCountry||'', selected:'yes' };
    PAYMENT_PENDING_LIST.splice(index, 1);
    _openModal(); renderPaymentPendingTable(); updateSidebarFollowupCounts(); updateSidebarPendingBadges();
  }
}
 
// ── REGISTRATION PENDING ──────────────────────────────
function renderRegPendingTable() {
  const tb = document.getElementById('reg-pending-tbody'); if (!tb) return;
  if (!REG_PENDING_LIST.length) { tb.innerHTML = '<tr><td colspan="9"><div class="empty"><p>No registration pending.</p></div></td></tr>'; return; }
  tb.innerHTML = REG_PENDING_LIST.map((r, i) => `<tr>
    <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
    <td><strong>${esc(r.name)}</strong></td>
    <td style="font-size:12px;">${esc(r.contact)}</td>
    <td style="font-size:12px;color:var(--text-tag);">${esc(r.email)}</td>
    <td style="font-size:12px;">${esc(r.recruiter)}</td>
    <td style="font-size:12px;">${esc(r.qual||'—')}</td>
    <td style="font-size:12px;">${esc(r.exp||'—')}</td>
    <td><span class="badge b-blue">📋 Reg. Pending</span></td>
    <td><button class="btn btn-teal btn-sm" onclick="proceedFromRegPending(${i})" style="white-space:nowrap;">▶ Proceed</button></td>
  </tr>`).join('');
}
function proceedFromRegPending(index) {
  const r = REG_PENDING_LIST[index]; if (!r) return;
  const all = [...CANDIDATES.soundariya, ...CANDIDATES.tharshini];
  let c = all.find(x => x.name === r.name && x.contact === r.contact);
  _askFollowupDateForRegPending(r, index, c);
}
function _askFollowupDateForRegPending(r, index, candidateObj) {
  document.getElementById('mod-ttl').textContent = r.name + ' — Registration Follow-up';
  document.getElementById('mod-sub').textContent  = 'Record follow-up note before continuing';
  document.getElementById('steps-bar').innerHTML  = '';
  document.getElementById('mod-body').innerHTML = `
    <div style="margin-bottom:18px;">
      <div style="background:linear-gradient(135deg,rgba(26,82,118,.08),rgba(22,46,90,.05));border:1.5px solid rgba(26,82,118,.25);border-radius:12px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px;">
        <span style="font-size:28px;">📋</span>
        <div><div style="font-size:13px;font-weight:700;color:var(--dark-blue);">${esc(r.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">Registration Pending · ${esc(r.recruiter)}</div></div>
      </div>
      <div class="f-grp full"><label>Note / Remark</label>
        <textarea id="rpd-note" placeholder="e.g. Called for registration follow-up..." style="min-height:72px;"></textarea></div>
    </div>`;
  document.getElementById('mod-ft').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-teal" onclick="_continueRegPendingProceed(${index})">Continue →</button>`;
  window._regPendingData = { r, index, candidateObj };
  document.getElementById('mod-overlay').classList.add('open');
}
window._continueRegPendingProceed = function(index) {
  const data = window._regPendingData; if (!data) return;
  const followNote = (document.getElementById('rpd-note')||{}).value?.trim() || '';
  const { r, candidateObj } = data;
  const dt = getAutoDateTime();
  if (candidateObj && followNote) {
    if (!FOLLOWUP_NOTES[candidateObj.id]) FOLLOWUP_NOTES[candidateObj.id] = [];
    FOLLOWUP_NOTES[candidateObj.id].push({ note: followNote, date: dt.readableDate, time: dt.readableTime });
  }
  document.getElementById('mod-overlay').classList.remove('open');
  if (candidateObj) {
    curCandidate = candidateObj;
    curRecruiter = CANDIDATES.soundariya.find(x => x.id === candidateObj.id) ? 'soundariya' : 'tharshini';
    const prog = CANDIDATE_PROGRESS[candidateObj.id];
    if (prog) { currentStep = prog.step; stepData = { ...prog.stepData }; }
    else { currentStep = 4; stepData = { name:r.name, contact:r.contact, email:r.email, qual:r.qual, exp:r.exp, preferredCountry:r.preferredCountry||'', selected:'yes', paymentDone:'yes', paymentMode:'cash' }; }
    currentStep = 4;
    _openModal();
  } else {
    showToast('Candidate not found.', 'err');
  }
};
 
// ── FOLLOW-UP NOTES ───────────────────────────────────
function openFollowupNotes(id) {
  const all = [...CANDIDATES.soundariya, ...CANDIDATES.tharshini];
  const c = all.find(x => x.id === id); if (!c) return;
  const notes = FOLLOWUP_NOTES[id] || [];
  document.getElementById('mod-ttl').textContent = c.name + ' — Notes';
  document.getElementById('mod-sub').textContent  = 'Follow-up note history';
  document.getElementById('steps-bar').innerHTML  = '';
  document.getElementById('mod-body').innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-size:13px;font-weight:700;color:var(--dark-blue);margin-bottom:8px;">Add Note</div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">📅 Date & time captured automatically.</div>
      <div class="f-grp" style="margin-bottom:10px;">
        <label>Note <span class="req">*</span></label>
        <textarea id="fn-note" placeholder="Enter follow-up note..." style="min-height:80px;"></textarea>
      </div>
      <button class="btn btn-teal" onclick="addFollowupNote(${id})">+ Add Note</button>
    </div>
    <div style="border-top:1px solid var(--border-div);padding-top:14px;">
      <div style="font-size:12px;font-weight:700;color:var(--text-tag);text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px;">Previous Notes (${notes.length})</div>
      <div id="followup-notes-list">
        ${notes.length === 0 ? '<div class="empty" style="padding:20px 0;"><p>No notes yet.</p></div>' :
          notes.slice().reverse().map(n => `
            <div class="followup-note-card">
              <div class="fn-meta"><span class="fn-date-badge">📅 ${esc(n.date)}</span><span class="fn-time-badge">🕐 ${esc(n.time)}</span></div>
              <div class="fn-text">${esc(n.note)}</div>
            </div>`).join('')}
      </div>
    </div>`;
  document.getElementById('mod-ft').innerHTML = `
    <button class="btn btn-outline" onclick="backToStep1FromNotes()">← Back</button>
    <button class="btn btn-outline" onclick="closeModal()">Close</button>`;
  document.getElementById('mod-overlay').classList.add('open');
}
function backToStep1FromNotes() { currentStep = 1; _openModal(); }
function addFollowupNote(id) {
  const note = (document.getElementById('fn-note')||{}).value?.trim() || '';
  if (!note) { showToast('Please enter a note.', 'err'); return; }
  const dt = getAutoDateTime();
  if (!FOLLOWUP_NOTES[id]) FOLLOWUP_NOTES[id] = [];
  FOLLOWUP_NOTES[id].push({ note, date: dt.readableDate, time: dt.readableTime });
  showToast('Note added!', 'ok');
  addActivity('noted', _getCandidateName(id), 'Follow-up note added');
  openFollowupNotes(id);
  renderTable(); renderDashboardNotesTable(); _updateNotesSidebarCount();
}
function _getCandidateName(id) {
  const all = [...CANDIDATES.soundariya, ...CANDIDATES.tharshini];
  const c = all.find(x => x.id === id); return c ? c.name : 'Candidate';
}
function renderDashboardNotesTable() {
  const tb = document.getElementById('dashboard-notes-tbody'); if (!tb) return;
  const all = [...CANDIDATES.soundariya, ...CANDIDATES.tharshini];
  let rows = [];
  all.forEach(c => { (FOLLOWUP_NOTES[c.id]||[]).forEach(n => rows.push({ candidate:c, note:n })); });
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="6"><div class="empty"><p>No notes yet.</p></div></td></tr>'; return; }
  rows.sort((a, b) => (b.note.date+b.note.time).localeCompare(a.note.date+a.note.time));
  tb.innerHTML = rows.map((r, i) => `<tr>
    <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
    <td><strong>${esc(r.candidate.name)}</strong></td>
    <td style="font-size:12px;">${esc(r.candidate.contact)}</td>
    <td style="font-size:12px;"><span style="background:var(--teal-light);color:var(--teal);padding:2px 8px;border-radius:8px;font-weight:700;">📅 ${esc(r.note.date)}</span></td>
    <td style="font-size:12px;"><span style="background:#f0eaff;color:#6c3fc1;padding:2px 8px;border-radius:8px;font-weight:700;">🕐 ${esc(r.note.time)}</span></td>
    <td style="font-size:12px;max-width:260px;">${esc(r.note.note)}</td>
  </tr>`).join('');
  const cnt = document.getElementById('dtab-notes-cnt'); if (cnt) cnt.textContent = rows.length;
}
function _updateNotesSidebarCount() {
  const all = [...CANDIDATES.soundariya, ...CANDIDATES.tharshini];
  let total = 0; all.forEach(c => { total += (FOLLOWUP_NOTES[c.id]||[]).length; });
  const el = document.getElementById('sb-followup-notes-cnt'); if (el) el.textContent = total;
  const cnt = document.getElementById('dtab-notes-cnt'); if (cnt) cnt.textContent = total;
}
 
// ── RESUME PREVIEW ────────────────────────────────────
function previewResume(id) {
  const all = [...CANDIDATES.soundariya, ...CANDIDATES.tharshini];
  const c = all.find(x => x.id === id);
  if (!c || !c.resumeName) { showToast('No resume on file.', 'err'); return; }
  document.getElementById('mod-ttl').textContent = c.name + ' — Resume';
  document.getElementById('mod-sub').textContent = 'Resume uploaded by recruiter';
  document.getElementById('steps-bar').innerHTML = '';
  document.getElementById('mod-body').innerHTML = `
    <div style="text-align:center;padding:32px 16px;">
      <div style="font-size:56px;margin-bottom:12px;">📄</div>
      <div style="font-size:17px;font-weight:700;color:var(--dark-blue);margin-bottom:8px;">${esc(c.resumeName)}</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:24px;">Resume for <strong>${esc(c.name)}</strong></div>
      <div style="display:inline-block;background:var(--suc-bg);border:1.5px solid var(--suc-bdr);border-radius:10px;padding:14px 28px;">
        <div style="font-size:12px;color:var(--suc);font-weight:700;">✓ Resume on file</div>
      </div>
    </div>`;
  document.getElementById('mod-ft').innerHTML = `
    <button class="btn btn-outline" onclick="openFileWithSystem(${c.id})">📂 Open File</button>
    <button class="btn btn-teal" onclick="closeModal()">Close</button>`;
  document.getElementById('mod-overlay').classList.add('open');
}
async function openFileWithSystem(id) {
  const all = [...CANDIDATES.soundariya, ...CANDIDATES.tharshini];
  const c = all.find(x => x.id === id); if (!c||!c.resumePath) return;
  if (c.resumePath) window.open(c.resumePath, '_blank');
}
 
// ── PROCEED MODAL ─────────────────────────────────────
function openProceed(id) {
  const all = [...CANDIDATES.soundariya, ...CANDIDATES.tharshini];
  curCandidate = all.find(c => c.id === id); if (!curCandidate) return;
  if (!CANDIDATE_PROGRESS[id]) { totalInterviewsTaken++; renderKPIs(); }
  currentStep = 1; stepData = {};
  _openModal();
}
function resumeProceed(id) {
  const all = [...CANDIDATES.soundariya, ...CANDIDATES.tharshini];
  curCandidate = all.find(c => c.id === id); if (!curCandidate) return;
  const prog = CANDIDATE_PROGRESS[id];
  if (prog) { currentStep = prog.step; stepData = { ...prog.stepData }; }
  else { currentStep = 1; stepData = {}; }
  _openModal();
}
function _openModal() {
  document.getElementById('mod-ttl').textContent = (curCandidate ? curCandidate.name : '') + ' — Interview Proceed';
  document.getElementById('mod-sub').textContent = 'Step ' + currentStep + ' of ' + TOTAL_STEPS;
  document.getElementById('mod-overlay').classList.add('open');
  renderStepsBar(); renderStep();
}
function closeModal() {
  if (curCandidate) CANDIDATE_PROGRESS[curCandidate.id] = { step: currentStep, stepData: { ...stepData } };
  document.getElementById('mod-overlay').classList.remove('open');
  curCandidate = null;
}
function renderStepsBar() {
  document.getElementById('steps-bar').innerHTML = STEP_LABELS.map((lbl, i) => {
    const n = i+1; let cls = n < currentStep ? 'done' : n === currentStep ? 'active' : '';
    return `<div class="step-pill ${cls}">${n}. ${lbl}</div>`;
  }).join('');
  document.getElementById('mod-sub').textContent = 'Step ' + currentStep + ' of ' + TOTAL_STEPS + ' — ' + STEP_LABELS[currentStep-1];
}
function renderStep() {
  renderStepsBar();
  switch (currentStep) {
    case 1: renderStep1(); break; case 2: renderStep2(); break;
    case 3: renderStep3(); break; case 4: renderStep4(); break;
    case 5: renderStep5(); break;
  }
}
 
// ── STEP 1 ────────────────────────────────────────────
function renderStep1() {
  const c = curCandidate;
  const hasResume = c.resumeName || stepData._resumeName;
  const countryOpts = COUNTRIES.map(cn => `<option value="${cn}" ${(stepData.preferredCountry||'')===cn?'selected':''}>${cn}</option>`).join('');
  const notes = FOLLOWUP_NOTES[c.id] || [];
  document.getElementById('mod-body').innerHTML = `
    ${interviewerStrip()}
    <div class="alert-strip" id="step-alert"></div>
    ${hasResume ? `<div style="margin-bottom:12px;"><div class="resume-corner-badge" onclick="previewResume(${c.id})" style="display:inline-flex;"><span style="font-size:18px;">📄</span><div><div style="font-size:11px;font-weight:700;color:var(--suc);">Resume (PDF)</div><div style="font-size:10px;color:var(--text-muted);">${esc(hasResume)}</div></div></div></div>` : ''}
    <div class="f-grid">
      <div class="f-grp"><label>Candidate Name <span class="req">*</span></label><input type="text" id="s1-name" value="${esc(stepData.name||c.name)}"/></div>
      <div class="f-grp"><label>Contact <span class="req">*</span></label><input type="text" id="s1-contact" value="${esc(stepData.contact||c.contact)}" maxlength="10" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,10)"/></div>
      <div class="f-grp full"><label>Email <span class="req">*</span></label><input type="email" id="s1-email" value="${esc(stepData.email||c.email)}"/></div>
      <div class="f-grp"><label>Qualification</label><input type="text" id="s1-qual" value="${esc(stepData.qual||c.qual)}"/></div>
      <div class="f-grp"><label>Experience</label><input type="text" id="s1-exp" value="${esc(stepData.exp||c.exp)}"/></div>
      <div class="f-grp full"><label>Country Preferred <span class="req">*</span></label>
        <select id="s1-preferred"><option value="">— Select Country —</option>${countryOpts}</select></div>
    </div>
    <div style="margin-top:20px;border-top:1.5px solid var(--border-div);padding-top:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div><div style="font-size:13px;font-weight:700;color:var(--dark-blue);">📝 Follow-up Notes</div>
        <div style="font-size:11px;color:var(--text-muted);">Date & time captured automatically</div></div>
        <button class="btn-followup-note" onclick="openFollowupNotes(${c.id})" style="white-space:nowrap;">📝 All Notes${notes.length>0?' ('+notes.length+')':''}</button>
      </div>
      <div style="background:var(--bg-role);border:1px solid var(--border-div);border-radius:10px;padding:14px;">
        <div class="f-grp"><label>Quick Note</label><textarea id="s1-fn-note" placeholder="Enter follow-up note... (date & time auto-saved)" style="min-height:60px;"></textarea></div>
        <button class="btn btn-outline btn-sm" onclick="quickAddNote(${c.id})" style="margin-top:8px;">+ Save Note</button>
      </div>
      ${notes.length > 0 ? `<div style="margin-top:12px;"><div style="font-size:11px;font-weight:700;color:var(--text-tag);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">Recent Notes</div>
        ${notes.slice(-2).reverse().map(n => `<div class="followup-note-card" style="margin-bottom:6px;">
          <div class="fn-meta"><span class="fn-date-badge">📅 ${esc(n.date)}</span><span class="fn-time-badge">🕐 ${esc(n.time)}</span></div>
          <div class="fn-text">${esc(n.note)}</div></div>`).join('')}</div>` : ''}
    </div>`;
  document.getElementById('mod-ft').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-teal" onclick="submitStep1()">Next →</button>`;
}
function quickAddNote(id) {
  const note = (document.getElementById('s1-fn-note')||{}).value?.trim() || '';
  if (!note) { showAlert('Please enter a note.', 'err'); return; }
  const dt = getAutoDateTime();
  if (!FOLLOWUP_NOTES[id]) FOLLOWUP_NOTES[id] = [];
  FOLLOWUP_NOTES[id].push({ note, date: dt.readableDate, time: dt.readableTime });
  showToast('Note saved!', 'ok');
  renderTable(); renderDashboardNotesTable(); _updateNotesSidebarCount();
  renderStep1();
}
function submitStep1() {
  const name = val('s1-name'), contact = val('s1-contact'), email = val('s1-email'), pref = val('s1-preferred');
  if (!name||!contact||!email) { showAlert('Please fill in all required fields.', 'err'); return; }
  if (!/^\S+@\S+\.\S+$/.test(email)) { showAlert('Please enter a valid email address.', 'err'); return; }
  if (!pref) { showAlert('Please select a preferred country.', 'err'); return; }
  stepData.name = name; stepData.contact = contact; stepData.email = email;
  stepData.qual = val('s1-qual'); stepData.exp = val('s1-exp'); stepData.preferredCountry = pref;
  saveProgress(); currentStep = 2; renderStep();
}
 
// ── STEP 2 ────────────────────────────────────────────
function renderStep2() {
  document.getElementById('mod-body').innerHTML = `
    ${interviewerStrip()}
    <div class="alert-strip" id="step-alert"></div>
    <div class="decision-section">
      <div class="decision-lbl">Candidate Selected? <span class="req">*</span></div>
      <div class="opt-row">
        <button class="opt-btn ${stepData.selected==='yes'?'sel-yes':''}" id="sel-yes" onclick="pickDecision('yes')">✓ Yes — Selected</button>
        <button class="opt-btn ${stepData.selected==='no'?'sel-no':''}" id="sel-no" onclick="pickDecision('no')">✗ No — Not Selected</button>
      </div>
    </div>
    <div id="reject-note" style="${stepData.selected==='no'?'':'display:none;'}">
      <div class="info-alert-box orange">⚠️ Candidate will be marked as <strong>Not Selected</strong>.</div>
    </div>`;
  document.getElementById('mod-ft').innerHTML = `
    <button class="btn btn-outline" onclick="goBack()">← Back</button>
    <button class="btn btn-teal" onclick="submitStep2()">Next →</button>`;
}
function pickDecision(v) {
  stepData.selected = v;
  const yBtn = document.getElementById('sel-yes'), nBtn = document.getElementById('sel-no');
  if (yBtn) yBtn.className = 'opt-btn'+(v==='yes'?' sel-yes':'');
  if (nBtn) nBtn.className = 'opt-btn'+(v==='no'?' sel-no':'');
  const rn = document.getElementById('reject-note'); if (rn) rn.style.display = v==='no'?'':'none';
}
function submitStep2() {
  if (!stepData.selected) { showAlert('Please indicate selection.', 'err'); return; }
  if (stepData.selected === 'no') {
    document.getElementById('mod-body').innerHTML = `
      <div class="reject-box"><div class="reject-icon">✗</div>
        <div class="reject-ttl" style="color:var(--err);">Not Selected</div>
        <div class="reject-sub"><strong>${esc(stepData.name)}</strong> has been marked as not selected.</div></div>`;
    document.getElementById('steps-bar').innerHTML = '';
    document.getElementById('mod-ft').innerHTML = `<button class="btn btn-outline" onclick="finalCloseModal()">Close</button>`;
    if (curCandidate) curCandidate.status = 'followups';
    addActivity('rejected', stepData.name, 'Not selected');
    renderTable(); renderKPIs(); showToast(stepData.name+' marked as not selected.', 'err');
    return;
  }
  saveProgress(); currentStep = 3; renderStep();
}
 
// ── STEP 3 (PAYMENT) ──────────────────────────────────
function renderStep3() {
  const payMode = stepData.paymentMode||'', payDone = stepData.paymentDone||'';
  document.getElementById('mod-body').innerHTML = `
    ${interviewerStrip()}
    <div class="alert-strip" id="step-alert"></div>
    <div style="margin-bottom:18px;"><div style="font-size:14px;font-weight:700;color:var(--dark-blue);margin-bottom:4px;">Payment Details</div></div>
    <div class="decision-section">
      <div class="decision-lbl">Payment Received? <span class="req">*</span></div>
      <div class="opt-row">
        <button class="opt-btn ${payDone==='yes'?'sel-yes':''}" id="pay-yes" onclick="pickPayDone('yes')">✓ Yes — Received</button>
        <button class="opt-btn ${payDone==='no'?'sel-no':''}" id="pay-no" onclick="pickPayDone('no')">✗ No — Pending</button>
      </div>
    </div>
    <div id="pay-mode-wrap" style="${payDone==='yes'?'':'display:none;'}">
      <div class="decision-section">
        <div class="decision-lbl">Payment Mode <span class="req">*</span></div>
        <div class="opt-row">
          <button class="opt-btn pay-mode-btn ${payMode==='cash'?'sel-yes':''}" id="pm-cash" onclick="pickPayMode('cash')"><span style="font-size:20px;display:block;margin-bottom:4px;">💵</span>Cash</button>
          <button class="opt-btn pay-mode-btn ${payMode==='online'?'sel-yes':''}" id="pm-online" onclick="pickPayMode('online')"><span style="font-size:20px;display:block;margin-bottom:4px;">📱</span>Online / UPI</button>
        </div>
      </div>
      <div id="cash-fields" style="${payMode==='cash'?'':'display:none;'}">
        <div class="f-grid" style="gap:12px;">
          <div class="f-grp"><label>Amount (₹) <span class="req">*</span></label><input type="number" id="pay-amount" value="${esc(stepData.payAmount||'')}" placeholder="e.g. 5000"/></div>
          <div class="f-grp"><label>Payment Date <span class="req">*</span></label><input type="date" id="pay-date" value="${stepData.payDate||''}"/></div>
          <div class="f-grp full"><label>Receipt / Voucher No.</label><input type="text" id="pay-receipt" value="${esc(stepData.payReceipt||'')}"/></div>
          <div class="f-grp full"><label>Remarks</label><textarea id="pay-remarks" style="min-height:60px;">${esc(stepData.payRemarks||'')}</textarea></div>
        </div>
        ${_payProofUploadHTML()}
      </div>
      <div id="online-fields" style="${payMode==='online'?'':'display:none;'}">
        <div class="f-grid" style="gap:12px;">
          <div class="f-grp"><label>Amount (₹) <span class="req">*</span></label><input type="number" id="pay-amount-o" value="${esc(stepData.payAmount||'')}" placeholder="e.g. 5000"/></div>
          <div class="f-grp"><label>Payment Date <span class="req">*</span></label><input type="date" id="pay-date-o" value="${stepData.payDate||''}"/></div>
          <div class="f-grp"><label>Transaction / UTR No. <span class="req">*</span></label><input type="text" id="pay-txn" value="${esc(stepData.payTxn||'')}"/></div>
          <div class="f-grp"><label>Payment Method</label>
            <select id="pay-method">
              <option value="">— Select —</option>
              ${['UPI','NEFT / IMPS','Bank Transfer','Cheque','Other'].map(m=>`<option ${stepData.payMethod===m?'selected':''}>${m}</option>`).join('')}
            </select></div>
          <div class="f-grp full"><label>Remarks</label><textarea id="pay-remarks-o" style="min-height:60px;">${esc(stepData.payRemarks||'')}</textarea></div>
        </div>
        ${_payProofUploadHTML('o')}
      </div>
    </div>
    <div id="pay-pending-note" style="${payDone==='no'?'':'display:none;'}">
      <div class="info-alert-box orange">⚠️ Candidate will be stored in <strong>Payment Pending</strong> list.</div>
    </div>`;
  document.getElementById('mod-ft').innerHTML = `
    <button class="btn btn-outline" onclick="goBack()">← Back</button>
    <button class="btn btn-teal" onclick="submitStep3()">Next →</button>`;
  setTimeout(() => { if (stepData._payProofDataUrl) _showProofPreview(stepData._payProofDataUrl, stepData._payProofUploadDT); }, 50);
}
 
function _payProofUploadHTML(suffix) {
  const id = 'pay-proof-upload-'+(suffix||'cash');
  return `<div style="margin-top:16px;padding:14px;background:#f8f9fc;border:1.5px dashed var(--border-btn);border-radius:10px;">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text-tag);margin-bottom:8px;">📎 Payment Proof <span style="color:var(--err);">* (Required)</span></div>
    ${stepData._payProofDataUrl ? `<div style="display:flex;align-items:center;gap:10px;background:var(--suc-bg);border:1.5px solid var(--suc-bdr);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
      <span style="font-size:20px;">✅</span>
      <div style="flex:1;"><div style="font-size:12px;font-weight:700;color:var(--suc);">Proof Uploaded</div>
      <div style="font-size:10.5px;color:var(--text-muted);">${esc(stepData._payProofUploadDT||'')}</div></div>
      <img src="${stepData._payProofDataUrl}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="viewPayProof()"/></div>` : ''}
    <div id="${id}">
      <label style="display:flex;align-items:center;gap:12px;cursor:pointer;padding:12px;background:#fff;border:1.5px dashed var(--border-btn);border-radius:8px;" onmouseover="this.style.borderColor='var(--teal)'" onmouseout="this.style.borderColor=''">
        <span style="font-size:24px;">📷</span>
        <div><div style="font-size:12.5px;font-weight:700;color:var(--dark-blue);">Upload Screenshot / PDF</div>
        <div style="font-size:11px;color:var(--text-muted);">Date & time auto-captured</div></div>
        <input type="file" accept="image/*,application/pdf" style="display:none;" onchange="handlePayProofUpload(event)"/>
      </label>
    </div>
  </div>`;
}
function handlePayProofUpload(event) {
  const file = event.target.files[0]; if (!file) return;
  const dt = getAutoDateTime();
  const uploadDT = dt.readableDate+' '+dt.readableTime;
  const reader = new FileReader();
  reader.onload = function(e) {
    stepData._payProofDataUrl  = e.target.result;
    stepData._payProofUploadDT = uploadDT;
    stepData._payProofFileName = file.name;
    stepData._payProofSourcePath = null;
    _showProofPreview(e.target.result, uploadDT);
    showToast('Payment proof uploaded! ('+uploadDT+')', 'ok');
  };
  reader.readAsDataURL(file);
  window._pendingProofFile = file;
}
function _showProofPreview(dataUrl, uploadDT) {
  ['pay-proof-upload-cash','pay-proof-upload-o'].forEach(zoneId => {
    const zone = document.getElementById(zoneId); if (!zone) return;
    const parent = zone.parentElement; if (!parent) return;
    let prev = parent.querySelector('.proof-preview-strip');
    if (!prev) { prev = document.createElement('div'); prev.className = 'proof-preview-strip'; prev.style.marginBottom='8px'; parent.insertBefore(prev, zone); }
    prev.innerHTML = `<div style="display:flex;align-items:center;gap:10px;background:var(--suc-bg);border:1.5px solid var(--suc-bdr);border-radius:8px;padding:10px 12px;">
      <span style="font-size:20px;">✅</span>
      <div style="flex:1;"><div style="font-size:12px;font-weight:700;color:var(--suc);">Proof Uploaded</div>
      <div style="font-size:10.5px;color:var(--text-muted);">${esc(uploadDT||'')}</div></div>
      <img src="${dataUrl}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="viewPayProof()"/></div>`;
  });
}
function viewPayProof() {
  if (!stepData._payProofDataUrl) return;
  const w = window.open('','_blank','width=800,height=600');
  w.document.write(`<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${stepData._payProofDataUrl}" style="max-width:100%;max-height:100vh;object-fit:contain;"/></body></html>`);
}
function pickPayDone(v) {
  stepData.paymentDone = v;
  document.getElementById('pay-yes').className = 'opt-btn'+(v==='yes'?' sel-yes':'');
  document.getElementById('pay-no').className  = 'opt-btn'+(v==='no'?' sel-no':'');
  document.getElementById('pay-mode-wrap').style.display    = v==='yes'?'':'none';
  document.getElementById('pay-pending-note').style.display = v==='no'?'':'none';
  if (v==='no') stepData.paymentMode = '';
}
function pickPayMode(v) {
  stepData.paymentMode = v;
  document.getElementById('pm-cash').className   = 'opt-btn pay-mode-btn'+(v==='cash'?' sel-yes':'');
  document.getElementById('pm-online').className = 'opt-btn pay-mode-btn'+(v==='online'?' sel-yes':'');
  document.getElementById('cash-fields').style.display   = v==='cash'?'':'none';
  document.getElementById('online-fields').style.display = v==='online'?'':'none';
}
async function submitStep3() {
  if (!stepData.paymentDone) { showAlert('Please indicate payment status.', 'err'); return; }
  if (stepData.paymentDone === 'no') { _storePaymentPending(); return; }
  if (!stepData.paymentMode) { showAlert('Please select payment mode.', 'err'); return; }
 
  if (window._pendingProofFile && !stepData._payProofPath) {
    try {
      const tmpPath = await _saveTempProofFile(window._pendingProofFile, stepData.name);
      if (tmpPath) { stepData._payProofPath = tmpPath; stepData._payProofName = window._pendingProofFile.name; }
    } catch(e) { console.error('Proof save:', e); }
    window._pendingProofFile = null;
  }
 
  if (stepData.paymentMode === 'cash') {
    stepData.payAmount  = val('pay-amount');
    stepData.payDate    = val('pay-date');
    stepData.payReceipt = val('pay-receipt');
    stepData.payRemarks = val('pay-remarks');
    if (!stepData.payAmount) { showAlert('Please enter amount.', 'err'); return; }
    if (!stepData.payDate)   { showAlert('Please enter payment date.', 'err'); return; }
  } else {
    stepData.payAmount  = val('pay-amount-o');
    stepData.payDate    = val('pay-date-o');
    stepData.payTxn     = val('pay-txn');
    stepData.payMethod  = val('pay-method');
    stepData.payRemarks = val('pay-remarks-o');
    if (!stepData.payAmount) { showAlert('Please enter amount.', 'err'); return; }
    if (!stepData.payDate)   { showAlert('Please enter payment date.', 'err'); return; }
    if (!stepData.payTxn)    { showAlert('Please enter transaction / UTR number.', 'err'); return; }
  }
  if (!stepData._payProofDataUrl) { showAlert('Payment proof screenshot / PDF is mandatory.', 'err'); return; }
 
  saveProgress(); currentStep = 4; renderStep();
}
 
async function _saveTempProofFile(file, candidateName) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = async () => { resolve(null); };
    reader.readAsArrayBuffer(file);
  });
}
 
function _storePaymentPending() {
  const idx = PAYMENT_PENDING_LIST.findIndex(r => r.name===stepData.name&&r.contact===stepData.contact);
  if (idx > -1) PAYMENT_PENDING_LIST.splice(idx, 1);
  PAYMENT_PENDING_LIST.push({
    name:stepData.name, contact:stepData.contact, email:stepData.email,
    qual:stepData.qual||'—', exp:stepData.exp||'—',
    recruiter:RECRUITER_META[curRecruiter]?.name||curRecruiter,
    preferredCountry:stepData.preferredCountry||'—',
    candidateId:curCandidate?curCandidate.id:null
  });
  if (curCandidate) curCandidate.status = 'payment_pending';
  saveProgress(); addActivity('payment_pending', stepData.name, 'Moved to Payment Pending');
  document.getElementById('mod-body').innerHTML = `
    <div class="success-box">
      <div style="width:76px;height:76px;border-radius:50%;background:#fff3e6;border:3px solid #e67e22;display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 18px;">💳</div>
      <div class="success-ttl" style="color:#b85c00;">Stored in Payment Pending</div>
      <div class="success-sub"><strong>${esc(stepData.name)}</strong> moved to Payment Pending list.</div>
    </div>`;
  document.getElementById('steps-bar').innerHTML = '';
  document.getElementById('mod-ft').innerHTML = `<button class="btn btn-teal" onclick="finalCloseModal()">Done</button>`;
  renderTable(); renderKPIs(); renderPaymentPendingTable(); updateSidebarFollowupCounts();
  showToast(stepData.name+' stored in Payment Pending.', 'ok');
}
 
// ── STEP 4 (ENROLLMENT FORM) ──────────────────────────
async function renderStep4() {
  if (!stepData.enrlNo) {
    try {
      const token = sessionStorage.getItem('crm_token') || '';
const res = await fetch('/api/candidates/next-enrollment', {
  headers: { 'x-session-token': token }
}).then(r => r.json());
      if (res && res.success) stepData.enrlNo = res.enrollmentNo;
      else stepData.enrlNo = 'ENRL-'+new Date().getFullYear()+'-'+String(Date.now()).slice(-4);
    } catch(e) {
      stepData.enrlNo = 'ENRL-'+new Date().getFullYear()+'-'+String(Date.now()).slice(-4);
    }
  }
  const todayReadable = (() => { const d=new Date(); return d.getDate()+'/'+(d.getMonth()+1).toString().padStart(2,'0')+'/'+d.getFullYear(); })();
  const prefillName    = stepData.ef_name    || stepData.name    || '';
  const prefillContact = stepData.ef_contact || stepData.contact || '';
  const prefillEmail   = stepData.ef_email   || stepData.email   || '';
 
  document.getElementById('mod-body').innerHTML = `
    ${interviewerStrip()}
    <div class="alert-strip" id="step-alert"></div>
    <div style="margin-bottom:12px;"><div style="font-size:14px;font-weight:700;color:var(--dark-blue);">Registration & Enrollment Form</div></div>
    <div id="enrollment-form-wrap">
      <div style="border:2px solid var(--border-div);border-radius:12px;overflow:hidden;margin-bottom:20px;">
        <div class="enrollment-header">
          <div class="eh-logo-area"><img src="Logo (1) (1).png" alt="JobSync" class="eh-logo-img" onerror="this.style.display='none'"></div>
          <div class="eh-company-info">
            <div class="eh-company-name">THE GOJOBSYNC</div>
            <div class="eh-address">64/13, Mounasamy Madam Street, Venkatapuram,</div>
            <div class="eh-address">Chennai - 600053</div>
            <div class="eh-address">Website: thejobsync.com | Ph: 044-4740 9522</div>
          </div>
          <div class="eh-spacer"></div>
        </div>
        <div class="enroll-form-wrap">
          <div class="enroll-form-title">INTERNATIONAL ENROLLMENT FORM</div>
          <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:16px;">
            <div style="flex:1;">
              <div class="enroll-enrl-row" style="margin-bottom:12px;">
                <label>ENRL No:</label>
                <input type="text" id="ef-enrl" value="${esc(stepData.enrlNo||'')}" readonly style="flex:1;padding:7px 11px;border-radius:7px;border:1.5px solid var(--border-inp);font-size:13px;background:#f0f4f9;color:var(--text-tag);cursor:default;"/>
              </div>
              <div style="font-size:11px;color:var(--teal);font-weight:600;">📅 Date: <strong>${todayReadable}</strong> (auto)</div>
            </div>
            <div style="flex-shrink:0;">
              <div style="font-size:10.5px;font-weight:700;color:var(--dark-blue);margin-bottom:6px;text-align:center;">Candidate Photo</div>
              <div class="ef-photo-upload-area" onclick="document.getElementById('ef-photo-input').click()" style="width:100px;height:120px;">
                <div id="ef-photo-preview">
                  ${stepData._photoDataUrl ? `<img src="${stepData._photoDataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` :
                    `<div class="ef-photo-placeholder"><div style="font-size:24px;">👤</div><div style="font-size:10px;font-weight:700;color:var(--text-tag);">Upload Photo</div></div>`}
                </div>
                <input type="file" id="ef-photo-input" accept="image/*" style="display:none;" onchange="handlePhotoUpload(event)"/>
              </div>
            </div>
          </div>
          <div class="f-grid" style="gap:12px;">
            <div class="f-grp"><label>1. Name (with Initial) <span class="req">*</span></label><input type="text" id="ef-name" value="${esc(prefillName)}"/></div>
            <div class="f-grp"><label>2. Father Name <span class="req">*</span></label><input type="text" id="ef-father" value="${esc(stepData.ef_father||'')}"/></div>
            <div class="f-grp"><label>3. Mother Name <span class="req">*</span></label><input type="text" id="ef-mother" value="${esc(stepData.ef_mother||'')}"/></div>
            <div class="f-grp"><label>4. Date of Birth <span class="req">*</span></label><input type="date" id="ef-dob" value="${stepData.ef_dob||''}"/></div>
            <div class="f-grp"><label>5. Sex <span class="req">*</span></label>
              <select id="ef-sex"><option value="">— Select —</option>
                ${['Male','Female','Other'].map(v=>`<option ${stepData.ef_sex===v?'selected':''}>${v}</option>`).join('')}</select></div>
            <div class="f-grp"><label>6. Marital Status</label>
              <select id="ef-marital"><option value="">— Select —</option>
                ${['Single','Married','Divorced'].map(v=>`<option ${stepData.ef_marital===v?'selected':''}>${v}</option>`).join('')}</select></div>
            <div class="f-grp"><label>7. Contact No <span class="req">*</span></label><input type="text" id="ef-contact" value="${esc(prefillContact)}" maxlength="10"/></div>
            <div class="f-grp"><label>10. Email ID <span class="req">*</span></label><input type="email" id="ef-email" value="${esc(prefillEmail)}"/></div>
            <div class="f-grp full"><label>8. Present Address <span class="req">*</span></label><textarea id="ef-addr-present" style="min-height:56px;">${esc(stepData.ef_addrPresent||'')}</textarea></div>
            <div class="f-grp full"><label>9. Permanent Address</label><textarea id="ef-addr-perm" style="min-height:56px;">${esc(stepData.ef_addrPerm||'')}</textarea></div>
            <div class="f-grp full"><label>11. Additional Qualification</label><input type="text" id="ef-addqual" value="${esc(stepData.ef_addQual||'')}"/></div>
            <div class="f-grp"><label>12. Nationality</label><input type="text" id="ef-nationality" value="${esc(stepData.ef_nationality||'Indian')}"/></div>
            <div class="f-grp"><label>13. Aadhaar Card No.</label><input type="text" id="ef-aadhaar" value="${esc(stepData.ef_aadhaar||'')}" maxlength="12" placeholder="12-digit Aadhaar" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,12)"/></div>
            <div class="f-grp"><label>14. Emergency Contact</label><input type="text" id="ef-emergency" value="${esc(stepData.ef_emergency||'')}" maxlength="10"/></div>
            <div class="f-grp"><label>15. Passport No. <span class="req">*</span></label><input type="text" id="ef-passport" value="${esc(stepData.ef_passport||'')}" placeholder="e.g. A1234567"/></div>
            <div class="f-grp"><label>16. Place of Issue & Expiry</label><input type="text" id="ef-passport-info" value="${esc(stepData.ef_passportInfo||'')}" placeholder="Chennai, 2030-01-01"/></div>
            <div class="f-grp full"><label>17. Reason for Relocation</label><textarea id="ef-reason" style="min-height:56px;">${esc(stepData.ef_reason||'')}</textarea></div>
          </div>
          <div class="ef-section-lbl">18. Educational Qualification</div>
          <div class="ef-table-wrap"><table class="ef-table">
            <thead><tr><th>Sl.No.</th><th>Class/Degree</th><th>Main Subject</th><th>Institution</th><th>Year</th><th>Marks %</th><th>Duration</th></tr></thead>
            <tbody>${[1,2,3].map(n=>`<tr><td>${n}.</td><td><input type="text" id="ef-edu-deg-${n}" value="${esc(stepData['ef_edu_deg_'+n]||'')}"/></td><td><input type="text" id="ef-edu-sub-${n}" value="${esc(stepData['ef_edu_sub_'+n]||'')}"/></td><td><input type="text" id="ef-edu-inst-${n}" value="${esc(stepData['ef_edu_inst_'+n]||'')}"/></td><td><input type="text" id="ef-edu-yr-${n}" value="${esc(stepData['ef_edu_yr_'+n]||'')}"/></td><td><input type="text" id="ef-edu-marks-${n}" value="${esc(stepData['ef_edu_marks_'+n]||'')}"/></td><td><input type="text" id="ef-edu-dur-${n}" value="${esc(stepData['ef_edu_dur_'+n]||'')}"/></td></tr>`).join('')}</tbody>
          </table></div>
          <div class="ef-section-lbl">19. Working Experience</div>
          <div class="ef-table-wrap"><table class="ef-table">
            <thead><tr><th>Sl.No.</th><th>Company</th><th>From–To</th><th>Designation</th><th>HR Name & Contact</th><th>Salary</th><th>Reason</th></tr></thead>
            <tbody>${[1,2,3].map(n=>`<tr><td>${n}.</td><td><input type="text" id="ef-exp-co-${n}" value="${esc(stepData['ef_exp_co_'+n]||'')}"/></td><td><input type="text" id="ef-exp-dur-${n}" value="${esc(stepData['ef_exp_dur_'+n]||'')}"/></td><td><input type="text" id="ef-exp-des-${n}" value="${esc(stepData['ef_exp_des_'+n]||'')}"/></td><td><input type="text" id="ef-exp-hr-${n}" value="${esc(stepData['ef_exp_hr_'+n]||'')}"/></td><td><input type="text" id="ef-exp-sal-${n}" value="${esc(stepData['ef_exp_sal_'+n]||'')}"/></td><td><input type="text" id="ef-exp-rsn-${n}" value="${esc(stepData['ef_exp_rsn_'+n]||'')}"/></td></tr>`).join('')}</tbody>
          </table></div>
          <div class="ef-section-lbl">20. Friend Reference</div>
          <div class="ef-table-wrap"><table class="ef-table">
            <thead><tr><th>Sl.No.</th><th>Name</th><th>Qualification</th><th>Contact</th></tr></thead>
            <tbody>${[1,2].map(n=>`<tr><td>${n}.</td><td><input type="text" id="ef-ref-name-${n}" value="${esc(stepData['ef_ref_name_'+n]||'')}"/></td><td><input type="text" id="ef-ref-qual-${n}" value="${esc(stepData['ef_ref_qual_'+n]||'')}"/></td><td><input type="text" id="ef-ref-cont-${n}" value="${esc(stepData['ef_ref_cont_'+n]||'')}"/></td></tr>`).join('')}</tbody>
          </table></div>
          <div style="font-size:11.5px;color:var(--err);font-weight:600;padding:10px 0;">NOTE: Registration fee is not Refundable.</div>
          <div style="font-size:12px;color:var(--text-tag);line-height:1.6;padding-bottom:16px;border-bottom:1px solid var(--border-div);">I hereby declare that the above particulars have been given by me are true and correct...</div>
          <div style="margin-top:18px;margin-bottom:18px;background:#f8f9fc;border:1.5px solid var(--border-div);border-radius:10px;padding:16px 18px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--text-tag);margin-bottom:12px;">Candidate Confirmation <span style="color:var(--err);">*</span></div>
            <label style="display:flex;align-items:flex-start;gap:12px;cursor:pointer;margin-bottom:12px;padding:12px;background:#fff;border:1.5px solid var(--border-inp);border-radius:8px;" id="chk-box-1-wrap">
              <input type="checkbox" id="chk-understood" onchange="updateCheckboxStyle(1)" style="width:18px;height:18px;accent-color:var(--teal);" ${stepData._chkUnderstood?'checked':''}/>
              <span style="font-size:12.5px;color:var(--text-inp);">I have read, understood, and agree to all terms and conditions.</span>
            </label>
            <label style="display:flex;align-items:flex-start;gap:12px;cursor:pointer;padding:12px;background:#fff;border:1.5px solid var(--border-inp);border-radius:8px;" id="chk-box-2-wrap">
              <input type="checkbox" id="chk-fee-nonrefundable" onchange="updateCheckboxStyle(2)" style="width:18px;height:18px;accent-color:var(--teal);" ${stepData._chkFeeNonRefundable?'checked':''}/>
              <span style="font-size:12.5px;color:var(--text-inp);">I acknowledge the <strong style="color:var(--err);">registration fee is non-refundable</strong>.</span>
            </label>
          </div>
          <div class="f-grid" style="margin-top:16px;gap:12px;">
            <div class="f-grp"><label>Place <span class="req">*</span></label><input type="text" id="ef-place" value="${esc(stepData.ef_place||'Chennai')}"/></div>
            <div class="f-grp"><label>Date <span style="font-size:9px;color:var(--teal);">(auto)</span></label>
              <input type="text" id="ef-date" value="${todayReadable}" readonly style="background:#f0f4f9;color:var(--text-tag);cursor:default;"/></div>
          </div>
          <div style="margin-top:16px;">
            <label style="font-size:10px;font-weight:700;color:var(--text-label);text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:8px;">Signature <span class="req">*</span></label>
            <div style="border:2px dashed var(--border-inp);border-radius:10px;overflow:hidden;background:#fff;">
              <canvas id="sig-canvas" width="620" height="130" style="display:block;cursor:crosshair;touch-action:none;width:100%;"></canvas>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
              <button class="btn btn-outline btn-sm" onclick="clearSignature()">✕ Clear</button>
              <span id="sig-status" style="font-size:12px;color:var(--text-muted);">${stepData._hasSig?'✓ Signature captured':'Draw signature above'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div style="margin-top:8px;padding:20px;background:var(--bg-role);border:2px solid var(--border-div);border-radius:12px;">
      <div style="font-size:13px;font-weight:700;color:var(--dark-blue);margin-bottom:14px;">Registration Status <span class="req">*</span></div>
      <div class="opt-row">
        <button class="opt-btn ${stepData.regStatus==='done'?'sel-yes':''}" id="reg-done" onclick="pickRegStatus('done')">✓ Registration Done</button>
        <button class="opt-btn ${stepData.regStatus==='pending'?'sel-no':''}" id="reg-pend" onclick="pickRegStatus('pending')">✗ Registration Pending</button>
      </div>
      <div id="reg-pending-note" style="${stepData.regStatus==='pending'?'':'display:none;'}margin-top:12px;">
        <div class="info-alert-box blue">ℹ️ Stored in Registration Pending list.</div>
      </div>
    </div>`;
  document.getElementById('mod-ft').innerHTML = `
    <button class="btn btn-outline" onclick="goBack()">← Back</button>
    <button class="btn btn-teal" onclick="submitStep4()">Next → Final</button>`;
  setTimeout(() => { initSignaturePad(); if (stepData._sigData) restoreSignature(stepData._sigData); updateCheckboxStyle(1); updateCheckboxStyle(2); }, 50);
}
function updateCheckboxStyle(n) {
  const [id, wrapId] = n===1 ? ['chk-understood','chk-box-1-wrap'] : ['chk-fee-nonrefundable','chk-box-2-wrap'];
  const el = document.getElementById(id), wrap = document.getElementById(wrapId);
  if (el && wrap) {
    if (n===1) stepData._chkUnderstood = el.checked; else stepData._chkFeeNonRefundable = el.checked;
    wrap.style.borderColor = el.checked ? 'var(--suc-bdr)' : 'var(--border-inp)';
    wrap.style.background  = el.checked ? 'var(--suc-bg)'  : '#fff';
  }
}
function pickRegStatus(v) {
  stepData.regStatus = v;
  document.getElementById('reg-done').className = 'opt-btn'+(v==='done'?' sel-yes':'');
  document.getElementById('reg-pend').className = 'opt-btn'+(v==='pending'?' sel-no':'');
  const rn = document.getElementById('reg-pending-note'); if (rn) rn.style.display = v==='pending'?'':'none';
}
function submitStep4() {
  if (!stepData.regStatus) { showAlert('Please select registration status.', 'err'); return; }
  if (stepData.regStatus === 'pending') { _storeRegPending(); return; }
  collectFormFields();
  const chk1 = document.getElementById('chk-understood');
  const chk2 = document.getElementById('chk-fee-nonrefundable');
  if (chk1) stepData._chkUnderstood = chk1.checked;
  if (chk2) stepData._chkFeeNonRefundable = chk2.checked;
 
  const errors = [];
  const highlight = (id, msg) => {
    const el = document.getElementById(id);
    if (el) { el.style.borderColor='var(--err-bdr)'; el.focus(); }
    errors.push(msg);
  };
  if (!stepData.ef_name)        highlight('ef-name',    'Name is required');
  if (!stepData.ef_father)      highlight('ef-father',  'Father name is required');
  if (!stepData.ef_mother)      highlight('ef-mother',  'Mother name is required');
  if (!stepData.ef_dob)         highlight('ef-dob',     'Date of birth is required');
  if (!stepData.ef_sex)         highlight('ef-sex',     'Sex is required');
  if (!stepData.ef_contact || !/^\d{10}$/.test(stepData.ef_contact)) highlight('ef-contact','Valid 10-digit contact is required');
  if (!stepData.ef_email || !stepData.ef_email.includes('@')) highlight('ef-email','Valid email is required');
  if (!stepData.ef_addrPresent) highlight('ef-addr-present','Present address is required');
  if (!stepData.ef_aadhaar || stepData.ef_aadhaar.length !== 12) highlight('ef-aadhaar','12-digit Aadhaar is required');
  if (!stepData.ef_passport)    highlight('ef-passport','Passport number is required');
  if (!stepData.ef_place)       highlight('ef-place',   'Place is required');
  if (!stepData._chkUnderstood) errors.push('Please tick the terms & conditions checkbox');
  if (!stepData._chkFeeNonRefundable) errors.push('Please tick the fee non-refundable checkbox');
  if (!stepData._hasSig) errors.push('Candidate signature is required');
 
  if (errors.length > 0) {
    showAlert(errors[0], 'err');
    const firstEl = document.querySelector('.f-grp input[style*="border-color"], .f-grp select[style*="border-color"]');
    if (firstEl) firstEl.scrollIntoView({ behavior:'smooth', block:'center' });
    return;
  }
  _showRegistrationConfirmDialog();
}
function _showRegistrationConfirmDialog() {
  const overlay = document.createElement('div');
  overlay.id = 'reg-confirm-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(22,46,90,.6);backdrop-filter:blur(4px);z-index:2000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:440px;max-width:95vw;box-shadow:0 24px 80px rgba(22,46,90,.35);overflow:hidden;">
      <div style="background:linear-gradient(135deg,var(--dark-blue),var(--mid-blue));padding:20px 24px;display:flex;align-items:center;gap:14px;">
        <div style="width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:22px;">📋</div>
        <div><div style="font-size:16px;font-weight:700;color:#fff;">Registration Confirmed</div>
        <div style="font-size:11px;color:rgba(255,255,255,.6);">Form complete</div></div>
      </div>
      <div style="padding:24px;">
        <div style="background:var(--suc-bg);border:1.5px solid var(--suc-bdr);border-radius:10px;padding:14px 16px;margin-bottom:18px;display:flex;align-items:center;gap:10px;">
          <span style="font-size:20px;">✅</span>
          <div><div style="font-size:13px;font-weight:700;color:var(--suc);">All fields complete</div>
          <div style="font-size:11.5px;color:var(--text-muted);">Enrollment No: ${esc(stepData.enrlNo)}</div></div>
        </div>
        <div style="display:flex;gap:10px;">
          <button onclick="document.getElementById('reg-confirm-overlay').remove();" style="flex:1;padding:12px;border-radius:8px;border:1.5px solid var(--border-btn);background:#fff;color:var(--text-btn);font-size:13px;font-weight:600;cursor:pointer;">← Edit</button>
          <button onclick="_confirmRegAndProceed();" style="flex:1.5;padding:12px;border-radius:8px;border:none;background:var(--teal);color:#fff;font-size:13px;font-weight:700;cursor:pointer;">✓ Proceed →</button>
        </div>
      </div>
    </div>`;
document.body.appendChild(overlay);
}
function _confirmRegAndProceed() {
  const overlay = document.getElementById('reg-confirm-overlay'); if (overlay) overlay.remove();
  saveProgress(); currentStep = 5; renderStep();
}
function _storeRegPending() {
  const idx = REG_PENDING_LIST.findIndex(r => r.name===stepData.name&&r.contact===stepData.contact);
  if (idx > -1) REG_PENDING_LIST.splice(idx, 1);
  REG_PENDING_LIST.push({
    name:stepData.name, contact:stepData.contact, email:stepData.email,
    qual:stepData.qual||'—', exp:stepData.exp||'—',
    recruiter:RECRUITER_META[curRecruiter]?.name||curRecruiter,
    preferredCountry:stepData.preferredCountry||'—',
    candidateId:curCandidate?curCandidate.id:null
  });
  if (curCandidate) curCandidate.status = 'reg_pending';
  saveProgress(); addActivity('reg_pending', stepData.name, 'Moved to Registration Pending');
  document.getElementById('mod-body').innerHTML = `
    <div class="success-box">
      <div style="width:76px;height:76px;border-radius:50%;background:#e8eef8;border:3px solid #1a5276;display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 18px;">📋</div>
      <div class="success-ttl" style="color:var(--mid-blue);">Stored in Registration Pending</div>
      <div class="success-sub"><strong>${esc(stepData.name)}</strong> moved to Registration Pending list.</div>
    </div>`;
  document.getElementById('steps-bar').innerHTML = '';
  document.getElementById('mod-ft').innerHTML = `<button class="btn btn-teal" onclick="finalCloseModal()">Done</button>`;
  renderTable(); renderKPIs(); renderRegPendingTable(); updateSidebarFollowupCounts();
  showToast(stepData.name+' stored in Registration Pending.', 'ok');
}
 
// ── STEP 5 ────────────────────────────────────────────
function renderStep5() {
  const payModeLabel = stepData.paymentMode==='cash'?'💵 Cash':stepData.paymentMode==='online'?'📱 Online':'—';
  document.getElementById('mod-body').innerHTML = `
    ${interviewerStrip()}
    <div class="alert-strip" id="step-alert"></div>
    <div style="margin-bottom:16px;"><div style="font-size:14px;font-weight:700;color:var(--dark-blue);">Final Review & Enrollment Preview</div></div>
    <div style="display:flex;gap:10px;margin-bottom:18px;">
      <button class="btn btn-outline" onclick="_showEnrollmentPreviewModal(stepData,stepData.name)" style="display:flex;align-items:center;gap:8px;flex:1;justify-content:center;padding:12px;">
        <span style="font-size:16px;">📄</span> Preview Enrollment Form
      </button>
      <button class="btn btn-outline" onclick="_downloadEnrollmentForm()" style="display:flex;align-items:center;gap:8px;flex:1;justify-content:center;padding:12px;">
        <span style="font-size:16px;">⬇️</span> Download as HTML
      </button>
    </div>
    <div class="cand-summary">
      <div class="cand-summary-hd">Complete Summary</div>
      <div class="cand-summary-grid">
        ${infoItem('Name', stepData.name)} ${infoItem('Contact', stepData.contact)}
        ${infoItem('Email', stepData.email)} ${infoItem('Country', stepData.preferredCountry||'—')}
        ${infoItem('Payment Mode', payModeLabel)} ${infoItem('Amount', stepData.payAmount?'₹'+stepData.payAmount:'—')}
        ${infoItem('Enrollment No.', stepData.enrlNo||'—')} ${infoItem('Passport No.', stepData.ef_passport||'—')}
        ${infoItem('Payment Proof', stepData._payProofDataUrl?'✓ Uploaded':'❌ MISSING')}
        ${infoItem('Photo', stepData._photoDataUrl?'✓ Uploaded':'—')}
        ${infoItem('Signature', stepData._hasSig?'✓ Captured':'—')}
      </div>
    </div>
    <div style="margin-top:16px;">
      <button class="btn btn-green" style="width:100%;padding:16px;font-size:14px;border-radius:10px;display:flex;align-items:center;justify-content:center;gap:10px;" onclick="submitToHR()">
        <span style="font-size:18px;">✓</span> Submit to HR / Placement
      </button>
    </div>`;
  document.getElementById('mod-ft').innerHTML = `<button class="btn btn-outline" onclick="goBack()">← Back</button>`;
}
 
// ── ENROLLMENT PREVIEW ────────────────────────────────
function _showEnrollmentPreviewModal(sd, candidateName) {
  const html = _buildEnrollmentHTML(sd, candidateName);
  const overlay = document.createElement('div');
  overlay.id = 'ef-preview-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(22,46,90,.7);backdrop-filter:blur(4px);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px;';
  const blob = new Blob([html], { type:'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:900px;max-width:98vw;max-height:96vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(22,46,90,.4);overflow:hidden;">
      <div style="background:linear-gradient(135deg,var(--dark-blue),var(--mid-blue));padding:16px 24px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div><div style="font-size:16px;font-weight:700;color:#fff;">📄 Enrollment Form Preview</div>
        <div style="font-size:11px;color:rgba(255,255,255,.6);">${esc(candidateName||'')} — The JobSync</div></div>
        <div style="display:flex;gap:8px;align-items:center;">
        <button onclick="_downloadEnrollmentFormFrom(window.__previewSD, window.__previewName)" style="padding:8px 14px;border-radius:8px;border:none;background:rgba(255,255,255,.18);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">⬇️ Download</button>
          <button onclick="document.getElementById('ef-preview-overlay').remove();URL.revokeObjectURL('${blobUrl}');" style="width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;font-size:18px;cursor:pointer;">×</button>
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;">
        <iframe src="${blobUrl}" style="width:100%;min-height:70vh;border:none;"></iframe>
      </div>
      <div style="padding:14px 24px;border-top:1px solid var(--border-div);display:flex;justify-content:flex-end;gap:10px;flex-shrink:0;">
        <button onclick="document.getElementById('ef-preview-overlay').remove();" class="btn btn-outline">Close</button>
        <button onclick="document.getElementById('ef-preview-overlay').remove();submitToHR();" class="btn btn-green">✓ Confirm & Submit to HR</button>
      </div>
    </div>`;
    window.__previewSD   = sd;
  window.__previewName = candidateName;
  document.body.appendChild(overlay);
}
  
 
function _downloadEnrollmentFormFrom(sd, candidateName) {
  const html = _buildEnrollmentHTML(sd, candidateName || sd.ef_name || sd.name || '');
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Enrollment_Form_' + (sd.ef_name || sd.name || 'Candidate').replace(/\s+/g, '_') + '.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast('Enrollment form downloaded!', 'ok');
}
 
function _buildEnrollmentHTML(sd, candidateName) {
  const today = (() => { const d=new Date(); return d.getDate()+'/'+(d.getMonth()+1).toString().padStart(2,'0')+'/'+d.getFullYear(); })();
  const eduRows = [1,2,3].map(n=>`<tr><td style="padding:6px 8px;border:1px solid #c0ccd8;text-align:center;">${n}.</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_edu_deg_'+n]||'')}</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_edu_sub_'+n]||'')}</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_edu_inst_'+n]||'')}</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_edu_yr_'+n]||'')}</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_edu_marks_'+n]||'')}</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_edu_dur_'+n]||'')}</td></tr>`).join('');
  const expRows = [1,2,3].map(n=>`<tr><td style="padding:6px 8px;border:1px solid #c0ccd8;text-align:center;">${n}.</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_exp_co_'+n]||'')}</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_exp_dur_'+n]||'')}</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_exp_des_'+n]||'')}</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_exp_hr_'+n]||'')}</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_exp_sal_'+n]||'')}</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_exp_rsn_'+n]||'')}</td></tr>`).join('');
  const refRows = [1,2].map(n=>`<tr><td style="padding:6px 8px;border:1px solid #c0ccd8;text-align:center;">${n}.</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_ref_name_'+n]||'')}</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_ref_qual_'+n]||'')}</td><td style="padding:6px 8px;border:1px solid #c0ccd8;">${esc(sd['ef_ref_cont_'+n]||'')}</td></tr>`).join('');
  const photoSection = sd._photoDataUrl ? `<img src="${sd._photoDataUrl}" style="width:110px;height:130px;object-fit:cover;border:2px solid #c0ccd8;border-radius:4px;" alt="Photo"/>` : `<div style="width:110px;height:130px;border:2px dashed #c0ccd8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#aaa;text-align:center;">No Photo</div>`;
  const sigSection  = sd._sigData ? `<img src="${sd._sigData}" style="max-width:220px;max-height:60px;" alt="Signature"/>` : `<div style="width:200px;height:50px;border-bottom:1.5px solid #162E5A;"></div>`;
  const payProof    = sd._payProofDataUrl ? `<div style="margin:8px 0;"><div style="font-weight:700;font-size:12px;color:#162E5A;margin-bottom:4px;">Payment Proof:</div><img src="${sd._payProofDataUrl}" style="max-width:200px;max-height:120px;border:1px solid #c0ccd8;border-radius:4px;"/><div style="font-size:11px;color:#555;margin-top:4px;">${esc(sd._payProofUploadDT||'')}</div></div>` : '';
 
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><title>Enrollment — ${esc(sd.ef_name||candidateName||'')}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:13px;color:#222;margin:0;padding:20px;}
  .header{display:flex;align-items:center;border-bottom:2.5px solid #162E5A;padding-bottom:12px;margin-bottom:16px;}
  .company-name{font-size:18px;font-weight:800;color:#162E5A;letter-spacing:2px;text-transform:uppercase;text-align:center;}
  .company-info{font-size:11px;color:#333;text-align:center;line-height:1.6;}
  .form-title{text-align:center;font-size:15px;font-weight:700;color:#162E5A;text-decoration:underline;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px;}
  .field-row{display:flex;gap:8px;margin-bottom:8px;align-items:baseline;flex-wrap:wrap;}
  .field-lbl{font-weight:700;color:#162E5A;min-width:200px;font-size:12px;}
  .field-val{border-bottom:1px solid #aaa;min-width:200px;flex:1;font-size:13px;padding-bottom:2px;}
  .section-lbl{font-weight:700;font-size:12px;color:#162E5A;text-transform:uppercase;letter-spacing:.8px;border-bottom:1.5px solid #162E5A;padding-bottom:4px;margin:16px 0 8px;}
  table{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:12px;}
  th{background:#e8eef8;padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;color:#4a6080;border:1px solid #c0ccd8;}
  .kv-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;margin-bottom:8px;}
  .pay-section{background:#f8f9fc;border:1px solid #d0d8e4;border-radius:8px;padding:12px 14px;margin-bottom:14px;}
  .pay-title{font-weight:700;color:#162E5A;font-size:12px;margin-bottom:8px;text-transform:uppercase;}
  .decl{font-size:11.5px;color:#444;line-height:1.6;margin-bottom:12px;border-bottom:1px solid #ddd;padding-bottom:10px;}
  @media print{body{padding:10px;}}
</style></head><body>
  <div class="header"><div style="flex:1;text-align:center;">
    <div class="company-name">THE GOJOBSYNC</div>
    <div class="company-info">64/13, Mounasamy Madam Street, Venkatapuram, Chennai - 600053<br/>Website: thejobsync.com | Ph: 044-4740 9522</div>
  </div></div>
  <div class="form-title">INTERNATIONAL ENROLLMENT FORM</div>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
    <div>
      <div class="field-row"><span class="field-lbl">ENRL No.:</span><span class="field-val">${esc(sd.enrlNo||'')}</span></div>
      <div class="field-row"><span class="field-lbl">Date:</span><span class="field-val">${today}</span></div>
    </div>
    <div style="text-align:center;">${photoSection}<div style="font-size:10px;color:#888;margin-top:4px;">Candidate Photo</div></div>
  </div>
  <div class="kv-grid">
    <div class="field-row"><span class="field-lbl">1. Name:</span><span class="field-val">${esc(sd.ef_name||'')}</span></div>
    <div class="field-row"><span class="field-lbl">2. Father Name:</span><span class="field-val">${esc(sd.ef_father||'')}</span></div>
    <div class="field-row"><span class="field-lbl">3. Mother Name:</span><span class="field-val">${esc(sd.ef_mother||'')}</span></div>
    <div class="field-row"><span class="field-lbl">4. Date of Birth:</span><span class="field-val">${esc(sd.ef_dob||'')}</span></div>
    <div class="field-row"><span class="field-lbl">5. Sex:</span><span class="field-val">${esc(sd.ef_sex||'')}</span></div>
    <div class="field-row"><span class="field-lbl">6. Marital Status:</span><span class="field-val">${esc(sd.ef_marital||'')}</span></div>
    <div class="field-row"><span class="field-lbl">7. Contact No.:</span><span class="field-val">${esc(sd.ef_contact||'')}</span></div>
    <div class="field-row"><span class="field-lbl">10. Email:</span><span class="field-val">${esc(sd.ef_email||'')}</span></div>
  </div>
  <div class="field-row"><span class="field-lbl">8. Present Address:</span><span class="field-val">${esc(sd.ef_addrPresent||'')}</span></div>
  <div class="field-row"><span class="field-lbl">9. Permanent Address:</span><span class="field-val">${esc(sd.ef_addrPerm||'')}</span></div>
  <div class="field-row"><span class="field-lbl">11. Add. Qualification:</span><span class="field-val">${esc(sd.ef_addQual||'')}</span></div>
  <div class="kv-grid">
    <div class="field-row"><span class="field-lbl">12. Nationality:</span><span class="field-val">${esc(sd.ef_nationality||'Indian')}</span></div>
    <div class="field-row"><span class="field-lbl">13. Aadhaar:</span><span class="field-val">${esc(sd.ef_aadhaar||'')}</span></div>
    <div class="field-row"><span class="field-lbl">14. Emergency Contact:</span><span class="field-val">${esc(sd.ef_emergency||'')}</span></div>
    <div class="field-row"><span class="field-lbl">15. Passport No.:</span><span class="field-val">${esc(sd.ef_passport||'')}</span></div>
    <div class="field-row"><span class="field-lbl">16. Passport Info:</span><span class="field-val">${esc(sd.ef_passportInfo||'')}</span></div>
    <div class="field-row"><span class="field-lbl">Preferred Country:</span><span class="field-val">${esc(sd.preferredCountry||'')}</span></div>
  </div>
  <div class="field-row"><span class="field-lbl">17. Reason for Relocation:</span><span class="field-val">${esc(sd.ef_reason||'')}</span></div>
  <div class="section-lbl">18. Educational Qualification</div>
  <table><thead><tr><th>Sl.No.</th><th>Class/Degree</th><th>Main Subject</th><th>Institution</th><th>Year</th><th>Marks %</th><th>Duration</th></tr></thead><tbody>${eduRows}</tbody></table>
  <div class="section-lbl">19. Working Experience</div>
  <table><thead><tr><th>Sl.No.</th><th>Company</th><th>From–To</th><th>Designation</th><th>HR Contact</th><th>Salary</th><th>Reason</th></tr></thead><tbody>${expRows}</tbody></table>
  <div class="section-lbl">20. Friend Reference</div>
  <table><thead><tr><th>Sl.No.</th><th>Name</th><th>Qualification</th><th>Contact</th></tr></thead><tbody>${refRows}</tbody></table>
  <div class="pay-section">
    <div class="pay-title">💳 Payment Details</div>
    <div class="kv-grid">
      <div class="field-row"><span class="field-lbl">Mode:</span><span class="field-val">${esc(sd.paymentMode||'')}</span></div>
      <div class="field-row"><span class="field-lbl">Amount:</span><span class="field-val">₹${esc(sd.payAmount||'')}</span></div>
      <div class="field-row"><span class="field-lbl">Date:</span><span class="field-val">${esc(sd.payDate||'')}</span></div>
      <div class="field-row"><span class="field-lbl">${sd.paymentMode==='online'?'Txn/UTR No.':'Receipt No.'}:</span><span class="field-val">${esc(sd.paymentMode==='online'?(sd.payTxn||''):(sd.payReceipt||''))}</span></div>
    </div>
    ${payProof}
  </div>
  <div style="font-size:11.5px;color:#c0392b;font-weight:600;padding:10px 0;">NOTE: Registration fee is not Refundable.</div>
  <div class="decl">I hereby declare that the above particulars are true and correct to the best of my knowledge.</div>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px;">
    <div>
      <div style="font-size:12px;font-weight:700;color:#162E5A;">PLACE: ${esc(sd.ef_place||'')}</div>
      <div style="font-size:12px;font-weight:700;color:#162E5A;margin-top:4px;">DATE: ${today}</div>
    </div>
    <div style="text-align:center;">${sigSection}<div style="font-size:11px;color:#666;margin-top:6px;font-weight:700;">Signature of Candidate</div></div>
  </div>
</body></html>`;
}
 
// ── SUBMIT TO HR ──────────────────────────────────────
// KEY CHANGE: Also pushes candidate to localStorage so
// placement.js picks them up automatically.
async function submitToHR() {
  const prev = document.getElementById('ef-preview-overlay'); if (prev) prev.remove();
  curCandidate._outcome = 'submitted';
  delete CANDIDATE_PROGRESS[curCandidate.id];
  const dt = getCurrentDateTime();
 
  const placementEntry = {
    name:stepData.name, contact:stepData.contact, email:stepData.email,
    country:stepData.preferredCountry||'—',
    recruiter:RECRUITER_META[curRecruiter]?.name||curRecruiter,
    payMode:stepData.paymentMode, payAmount:stepData.payAmount,
    enrlNo:stepData.enrlNo||'—', submittedDate:dt.date, submittedTime:dt.time,
    candidateId:curCandidate.id, stepData:{ ...stepData }
  };
  SUBMITTED_LIST.push({ ...stepData, recruiter:RECRUITER_META[curRecruiter]?.name||curRecruiter });
  PLACEMENT_LIST.push(placementEntry);
  curCandidate.status = 'submitted';
  if (curCandidate.id && !String(curCandidate.id).startsWith('pp_')) {
    fetch('/api/candidates/' + curCandidate.id, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ status:'submitted' }), credentials:'include' }).catch(()=>{});
  }
  if (curCandidate.id && !String(curCandidate.id).startsWith('pp_')) {
    fetch('/api/candidates/' + curCandidate.id, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ status:'submitted' }), credentials:'include' }).catch(()=>{});
  }
  totalConversions++;
 
  // ── PUSH TO PLACEMENT DASHBOARD via localStorage ──────
  // placement.js polls 'pl_submitted_candidates' every 3 seconds
  // and absorbs new entries into its PIPELINE automatically.
  try {
    const existing = JSON.parse(localStorage.getItem('pl_submitted_candidates') || '[]');
    const newEntry = {
      id:               'int_' + String(curCandidate.id),
      name:             stepData.name             || '',
      contact:          stepData.contact          || '',
      email:            stepData.email            || '',
      // Candidate's own photo from the enrollment form upload
      photo:            stepData._photoDataUrl    || '',
      _photoDataUrl:    stepData._photoDataUrl    || '',
      preferredCountry: stepData.preferredCountry || '',
      country:          stepData.preferredCountry || '',
      qual:             stepData.qual             || '',
      exp:              stepData.exp              || '',
      enrlNo:           stepData.enrlNo           || '',
      enrollmentNo:     stepData.enrlNo           || '',
      interviewer:      'Ramya',
      submittedDate:    dt.date,
      submittedTime:    dt.time,
      recruiter:        RECRUITER_META[curRecruiter]?.name || curRecruiter
    };
    // Deduplicate: don't push the same candidate twice
    const alreadyQueued = existing.find(e =>
      e.contact === newEntry.contact && e.name === newEntry.name
    );
    if (!alreadyQueued) {
      existing.push(newEntry);
      localStorage.setItem('pl_submitted_candidates', JSON.stringify(existing));
    }
  } catch(lsErr) {
    console.error('localStorage push to placement failed:', lsErr);
  }
 
  // ── SAVE TO DB ────────────────────────────────────────
  
 
  addActivity('submitted', stepData.name, 'Submitted to HR · '+stepData.preferredCountry);
  const rpIdx = REG_PENDING_LIST.findIndex(r => r.name===stepData.name&&r.contact===stepData.contact);
  if (rpIdx > -1) REG_PENDING_LIST.splice(rpIdx, 1);
 
  document.getElementById('mod-body').innerHTML = `
    <div class="success-box" style="padding:24px 20px;">
      <div class="success-icon">✓</div>
      <div class="success-ttl">Verified & Pushed to Placement!</div>
      <div class="success-sub" style="margin-bottom:20px;"><strong>${esc(stepData.name)}</strong> submitted to HR.<br/>Enrollment No: <strong>${esc(stepData.enrlNo)}</strong><br/>Country: <strong>${esc(stepData.preferredCountry)}</strong></div>
      <button class="btn btn-teal" style="margin:0 auto;display:flex;align-items:center;gap:8px;" onclick="finalCloseModal();setTimeout(()=>{openPlacementDoc(${PLACEMENT_LIST.length-1})},200);">📄 View Enrollment Doc</button>
    </div>`;
  document.getElementById('steps-bar').querySelectorAll('.step-pill').forEach(p => p.className = 'step-pill done');
  document.getElementById('mod-ft').innerHTML = `<button class="btn btn-teal" onclick="finalCloseModal()">Done</button>`;
  renderKPIs(); renderTable(); renderRegPendingTable(); updateSidebarFollowupCounts(); renderPlacementSidebar();
  showToast(stepData.name+' verified & pushed to placement! 🎉', 'ok');
}
 
// ── NAVIGATION ────────────────────────────────────────
function goBack() { if (currentStep > 1) { currentStep--; renderStep(); } }
function saveProgress() { if (curCandidate) CANDIDATE_PROGRESS[curCandidate.id] = { step:currentStep, stepData:{ ...stepData } }; }
function finalCloseModal() {
  if (curCandidate) delete CANDIDATE_PROGRESS[curCandidate.id];
  document.getElementById('mod-overlay').classList.remove('open');
  curCandidate = null; currentStep = 1; stepData = {};
}
 
// ── PHOTO UPLOAD ──────────────────────────────────────
function handlePhotoUpload(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    stepData._photoDataUrl = e.target.result;
    const preview = document.getElementById('ef-photo-preview');
    if (preview) preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
    showToast('Photo uploaded!', 'ok');
  };
  reader.readAsDataURL(file);
}
function clearPhoto(event) {
  if (event) event.stopPropagation();
  stepData._photoDataUrl = null;
  const preview = document.getElementById('ef-photo-preview');
  if (preview) preview.innerHTML = `<div class="ef-photo-placeholder"><div style="font-size:24px;">👤</div><div style="font-size:10px;font-weight:700;color:var(--text-tag);">Upload Photo</div></div>`;
}
 
// ── SIGNATURE PAD ─────────────────────────────────────
let _sigDrawing = false, _sigCtx = null;
function initSignaturePad() {
  const canvas = document.getElementById('sig-canvas'); if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width  = (canvas.offsetWidth || 620) * ratio;
  canvas.height = 130 * ratio;
  _sigCtx = canvas.getContext('2d');
  _sigCtx.scale(ratio, ratio);
  _sigCtx.strokeStyle = '#162E5A'; _sigCtx.lineWidth = 2; _sigCtx.lineCap = 'round'; _sigCtx.lineJoin = 'round';
  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = (canvas.width/ratio)/rect.width, sy = (canvas.height/ratio)/rect.height;
    if (e.touches) return { x:(e.touches[0].clientX-rect.left)*sx, y:(e.touches[0].clientY-rect.top)*sy };
    return { x:(e.clientX-rect.left)*sx, y:(e.clientY-rect.top)*sy };
  };
  const start = (e) => { e.preventDefault(); _sigDrawing=true; const p=getPos(e); _sigCtx.beginPath(); _sigCtx.moveTo(p.x,p.y); };
  const draw  = (e) => { e.preventDefault(); if(!_sigDrawing) return; const p=getPos(e); _sigCtx.lineTo(p.x,p.y); _sigCtx.stroke(); };
  const stop  = () => { if(!_sigDrawing) return; _sigDrawing=false; _sigCtx.closePath(); updateSigStatus(); };
  canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',draw);
  canvas.addEventListener('mouseup',stop);    canvas.addEventListener('mouseleave',stop);
  canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',draw,{passive:false}); canvas.addEventListener('touchend',stop);
}
function updateSigStatus() {
  const canvas = document.getElementById('sig-canvas'); if (!canvas) return;
  stepData._sigData = canvas.toDataURL(); stepData._hasSig = true;
  const st = document.getElementById('sig-status'); if (st) { st.textContent='✓ Signature captured'; st.style.color='var(--suc)'; }
}
function restoreSignature(dataUrl) {
  const canvas = document.getElementById('sig-canvas'); if (!canvas||!dataUrl) return;
  const img = new Image();
  img.onload = () => { _sigCtx&&_sigCtx.drawImage(img,0,0,canvas.width/(window.devicePixelRatio||1),130); };
  img.src = dataUrl;
}
function clearSignature() {
  const canvas = document.getElementById('sig-canvas'); if (!canvas||!_sigCtx) return;
  _sigCtx.clearRect(0,0,canvas.width,canvas.height);
  stepData._sigData=null; stepData._hasSig=false;
  const st = document.getElementById('sig-status'); if (st) { st.textContent='Draw signature above'; st.style.color='var(--text-muted)'; }
}
 
// ── COLLECT FORM FIELDS ───────────────────────────────
function collectFormFields() {
  const fields = [
    ['ef-name','ef_name'],['ef-father','ef_father'],['ef-mother','ef_mother'],
    ['ef-dob','ef_dob'],['ef-sex','ef_sex'],['ef-marital','ef_marital'],
    ['ef-contact','ef_contact'],['ef-email','ef_email'],
    ['ef-addr-present','ef_addrPresent'],['ef-addr-perm','ef_addrPerm'],
    ['ef-addqual','ef_addQual'],['ef-nationality','ef_nationality'],
    ['ef-aadhaar','ef_aadhaar'],['ef-emergency','ef_emergency'],
    ['ef-passport','ef_passport'],['ef-passport-info','ef_passportInfo'],
    ['ef-reason','ef_reason'],['ef-place','ef_place'],['ef-enrl','enrlNo']
  ];
  fields.forEach(([id,key]) => { const el=document.getElementById(id); if(el) stepData[key]=el.value.trim(); });
  for (let n=1;n<=3;n++) {
    ['deg','sub','inst','yr','marks','dur'].forEach(f=>{ const el=document.getElementById(`ef-edu-${f}-${n}`); if(el) stepData[`ef_edu_${f}_${n}`]=el.value.trim(); });
    ['co','dur','des','hr','sal','rsn'].forEach(f=>{ const el=document.getElementById(`ef-exp-${f}-${n}`); if(el) stepData[`ef_exp_${f}_${n}`]=el.value.trim(); });
  }
  for (let n=1;n<=2;n++) {
    ['name','qual','cont'].forEach(f=>{ const el=document.getElementById(`ef-ref-${f}-${n}`); if(el) stepData[`ef_ref_${f}_${n}`]=el.value.trim(); });
  }
}
 
// ── HELPERS ───────────────────────────────────────────
function interviewerStrip() {
  return `<div class="int-strip">
    <div class="int-strip-ava"><img src="${esc(INT_USER_IMG||'ramya.jpeg')}" alt="${esc(INT_USER_NAME)}" onerror="this.style.display='none';this.parentNode.textContent='${INT_USER_NAME.charAt(0)}';"></div>
    <div><div class="int-strip-name">${esc(INT_USER_NAME)}</div><div class="int-strip-role">Interviewer · The JobSync</div></div>
  </div>`;
}
function infoItem(lbl, v) { return `<div><div class="info-item-lbl">${lbl}</div><div class="info-item-val">${esc(String(v||''))}</div></div>`; }
function badge(s) { return `<span class="badge ${BADGE_CLASS[s]||'b-gray'}">${STATUS_LABELS[s]||s}</span>`; }
function val(id) { const el=document.getElementById(id); return el?el.value.trim():''; }
function showAlert(msg, type) {
  const el = document.getElementById('step-alert'); if (!el) return;
  el.textContent = msg; el.className = 'alert-strip '+type+' show';
  el.scrollIntoView({ behavior:'smooth', block:'nearest' });
  setTimeout(()=>el.classList.remove('show'), 4000);
}
function showToast(msg, type) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.className = 'show'+(type?' '+type:'');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>t.classList.remove('show'), 2800);
}
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
 