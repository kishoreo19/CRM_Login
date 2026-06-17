// =====================================================
// THE GOJOBSYNC — PLACEMENT DASHBOARD — placement.js (v3)
// KEY FIXES:
//   1. Shows submitted date & time (when interviewer uploaded)
//   2. Only shows companies from clients page for placement interviews
//   3. Real-time polling every 5 seconds
//   4. All data saves to DB via sync-pipeline
//   5. No demo data — only from interview dashboard
//   6. Placed candidates are clickable — full detail modal
// =====================================================

const PL_USER_NAME = 'Shree Harine';
const PL_USER_IMG  = 'WhatsApp Image 2026-04-07 at 10.04.42 AM.jpeg';

const TRAINING_STAGES = [
  'Self Assessment', 'Domain Assessment', 'JD',
  'Profile Editing', 'Mock Interview',
  'Self Introduction Video', 'Document Submission'
];

const PIPELINE = [];
const INTERVIEW_HISTORY = [];
const CANDIDATE_PROGRESS = {};

let curCandidate = null;
let currentStep  = 1;
let stepData     = {};
let toastTimer   = null;

// ── CLIENT COMPANIES (loaded from DB) ─────────────────
let CLIENT_COMPANIES = [];

const STAGE_LABELS = {
  registered:         'Registered',
  bgv:                'Background Verification',
  payment:            'Payment',
  contract:           'Contract',
  training:           'Training',
  placement_followup: 'Placement Follow-up',
  placed:             'Placed'
};
const STAGE_BADGE = {
  registered:         'b-blue',
  bgv:                'b-purple',
  payment:            'b-orange',
  contract:           'b-orange',
  training:           'b-dark',
  placement_followup: 'b-teal',
  placed:             'b-green'
};
const BGV_DOCS = [
  { key:'10th',       label:'10th Certificate' },
  { key:'12th',       label:'12th Certificate' },
  { key:'degree',     label:'Degree Certificate' },
  { key:'aadhaar',    label:'Aadhaar Card' },
  { key:'resume',     label:'Resume' },
  { key:'idproof',    label:'ID Proof' },
  { key:'extracerts', label:'Extra Certificates' },
  { key:'passport',   label:'Passport' }
];

function getToken() { return sessionStorage.getItem('crm_token') || ''; }

// ── INIT ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  if (!getToken()) { window.location.href = 'login.html'; return; }
  // Mark attendance
  const _attKey = 'attendance_hr';
  const _attToday = new Date().toISOString().split('T')[0];
  if (localStorage.getItem(_attKey) !== _attToday) {
    fetch('/api/attendance/mark', { method:'POST', headers:{'Content-Type':'application/json','x-session-token':getToken()} })
    .then(r=>r.json()).then(d=>{ if(d.success) localStorage.setItem(_attKey, _attToday); }).catch(()=>{});
  }

  updateGreeting();
  updateDateTime();
  setInterval(updateDateTime, 1000);

  await _loadData();
  await _loadClientCompanies();
  _syncBreakStatus();

  setInterval(_checkForNewSubmissions, 5000);
  setInterval(_syncBreakStatus, 5000);

  renderKPIs();
  renderAllTables();
  updateSidebarCounts();
  renderPlacedSidebar();
});

// ── LOAD CLIENT COMPANIES FROM DB ─────────────────────
async function _loadClientCompanies() {
  try {
    const res = await fetch('/api/clients', {
      headers: { 'x-session-token': getToken() }
    });
    const data = await res.json();
    if (data.success && data.clients) {
      CLIENT_COMPANIES = data.clients.map(c => ({
        id:   c.id,
        name: c.companyName,
        type: c.type,
        location: c.workLocation || c.interviewLocation || '',
        requirements: c.requirements || '',
      }));
    }
  } catch(e) {
    console.warn('Could not load client companies:', e.message);
    CLIENT_COMPANIES = [];
  }
}

// ── BREAK STATUS SYNC ─────────────────────────────────
function _syncBreakStatus() {
  try {
    const breakData = JSON.parse(localStorage.getItem('ramya_break_status') || 'null');
    const el = document.getElementById('ramya-break-indicator');
    if (!el) return;
    if (!breakData || breakData.status === 'present') {
      el.innerHTML = `<span style="color:#27ae60;font-weight:700;font-size:12px;">● Ramya — Present</span>`;
    } else {
      el.innerHTML = `<span style="color:#e67e22;font-weight:700;font-size:12px;">⏸ Ramya — ${esc(breakData.status)} (since ${esc(breakData.since||'')})</span>`;
    }
  } catch(e) {}
}

// ── DATA PERSISTENCE ─────────────────────────────────
async function _loadData() {
  try {
    const token = sessionStorage.getItem('crm_token') || '';
    const res = await fetch('/api/candidates', {
      headers: { 'x-session-token': token }
    });
    const data = await res.json();
    const rows = (data.candidates || []).filter(r =>
      r.status === 'submitted' || r.status === 'placed' ||
      r.status === 'placement' || r.status === 'reg_pending' ||
      r.status === 'payment_pending'
    );

    PIPELINE.length = 0;

    rows.forEach(r => {
      PIPELINE.push({
        id:            String(r.id),
        name:          r.name          || '',
        contact:       r.contact       || '',
        email:         r.email         || '',
        photo:         r.ef_photo_data || '',
        country:       r.preferred_country || '',
        qualification: r.qual          || '',
        experience:    r.expType === 'Fresher' ? 'Fresher' : ((r.expYears||'') + ' ' + (r.expMonths||'')).trim(),
        expectedSalary: r.salary       || '',
        enrollmentNo:  r.enrollment_no || '',
        recruiter:     r.recruiter_name|| '',
        interviewer:   r.processed_by  || 'Ramya',
        submittedDate: r.submitted_date|| '',
        submittedTime: r.submitted_time|| '',
        joinedDate:    r.submitted_date|| '',
        joinedTime:    r.submitted_time|| '',
        stage:         _mapStatusToStage(r.status, r.placement_stage),
        bgvDocs:       r.bgv_docs      || {},
        bgvStatus:     r.bgv_status    || '',
        contractNotes: _parseContractNotes(r.contract_notes),
        contractStatus: r.contract_status || '',
        paymentStatus: r.payment_status|| '',
        paymentAmount: r.payment_amount|| '',
        paymentDate:   r.payment_date  || '',
        trainingProgress: Array.isArray(r.training_progress)
          ? r.training_progress
          : (r.training_progress ? Object.keys(r.training_progress) : []),
        interviewHistory: [],
        placedCompany: r.placed_company|| '',
        placedDate:    r.placed_date   || '',
        notes:         []
      });
    });

    try {
      const savedHistory = localStorage.getItem('pl_interview_history');
      if (savedHistory) {
        const h = JSON.parse(savedHistory);
        INTERVIEW_HISTORY.length = 0;
        h.forEach(r => INTERVIEW_HISTORY.push(r));
      }
    } catch(e) {}

    // Also load interview history per candidate from localStorage
    try {
      const savedPipeline = localStorage.getItem('pl_pipeline');
      if (savedPipeline) {
        const lsPipeline = JSON.parse(savedPipeline);
        PIPELINE.forEach(c => {
          const ls = lsPipeline.find(x => String(x.id) === String(c.id));
          if (ls && ls.interviewHistory && ls.interviewHistory.length) {
            c.interviewHistory = ls.interviewHistory;
          }
        });
      }
    } catch(e) {}

    _absorbNewSubmissions();
  } catch(e) {
    console.error('Load error:', e);
    try {
      const saved = localStorage.getItem('pl_pipeline');
      if (saved) {
        const d = JSON.parse(saved);
        PIPELINE.length = 0;
        d.forEach(c => PIPELINE.push(c));
      }
    } catch(le) {}
  }
  _rebuildLists();
}

function _mapStatusToStage(status, placementStage) {
  const validStages = ['registered','bgv','payment','contract','training','placement_followup','placed'];
  if (placementStage && validStages.includes(placementStage)) return placementStage;
  const map = {
    submitted:       'registered',
    payment_pending: 'payment',
    reg_pending:     'registered',
    placement:       'placement_followup',
    placed:          'placed'
  };
  return map[status] || 'registered';
}

function _parseContractNotes(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    return [{ text: String(val), date: '', time: '' }];
  }
}

function _absorbNewSubmissions() {
  try {
    const raw = localStorage.getItem('pl_submitted_candidates');
    if (!raw) return;
    const incoming = JSON.parse(raw);
    if (!Array.isArray(incoming) || !incoming.length) return;

    let changed = false;
    incoming.forEach(c => {
      const exists = PIPELINE.find(p =>
        p.id === c.id ||
        (p.contact === c.contact && p.name === c.name)
      );
      if (!exists) {
        PIPELINE.push({
          id:            c.id || 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2,5),
          name:          c.name || '',
          contact:       c.contact || '',
          email:         c.email || '',
          photo:         c.photo || c._photoDataUrl || '',
          country:       c.preferredCountry || c.country || '',
          qualification: c.qual || '',
          experience:    c.exp || '',
          expectedSalary:'',
          joinedDate:    c.submittedDate || getAutoDateTime().isoDate,
          joinedTime:    c.submittedTime || getAutoDateTime().readableTime,
          submittedDate: c.submittedDate || '',
          submittedTime: c.submittedTime || '',
          interviewer:   c.interviewer || 'Ramya',
          enrollmentNo:  c.enrlNo || '',
          recruiter:     c.recruiter || '',
          stage:         'registered',
          bgvDocs:       {},
          bgvStatus:     '',
          contractNotes: [],
          contractStatus:'',
          paymentStatus: '',
          paymentAmount: '',
          paymentDate:   '',
          trainingProgress: [],
          interviewHistory: [],
          notes:         []
        });
        changed = true;
      }
    });

    if (changed) {
      _saveData();
      renderAllTables();
      renderKPIs();
      updateSidebarCounts();
      showToast('New candidate(s) received from Interview Dashboard!', 'ok');
    }

    localStorage.removeItem('pl_submitted_candidates');
  } catch(e) { console.error('Absorb error:', e); }
}

function _checkForNewSubmissions() {
  const raw = localStorage.getItem('pl_submitted_candidates');
  if (raw) _absorbNewSubmissions();
}

function _saveData() {
  try {
    localStorage.setItem('pl_pipeline', JSON.stringify(PIPELINE));
    localStorage.setItem('pl_interview_history', JSON.stringify(INTERVIEW_HISTORY));

    fetch('/api/candidates/sync-pipeline', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': getToken()
      },
      body: JSON.stringify({ pipeline: PIPELINE, history: INTERVIEW_HISTORY })
    }).catch(e => console.warn('DB sync failed:', e));

    PIPELINE.forEach(c => {
      if (c.id && !String(c.id).startsWith('c_')) {
        fetch(`/api/candidates/${c.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': getToken()
          },
          body: JSON.stringify({
            contract_notes:    JSON.stringify(c.contractNotes || []),
            training_progress: JSON.stringify(c.trainingProgress || []),
            placed_company:    c.placedCompany   || '',
            placed_date:       c.placedDate      || null,
            payment_status:    c.paymentStatus   || '',
            payment_amount:    c.paymentAmount   || '',
            payment_date:      c.paymentDate     || null
          })
        }).catch(() => {});
      }
    });

  } catch(e) {}
  _rebuildLists();
}

const BGV_PENDING_LIST      = [];
const CONTRACT_PENDING_LIST = [];
const PAYMENT_PENDING_LIST  = [];
const TRAINING_LIST         = [];
const PLACEMENT_FOLLOWUP    = [];
const PLACED_LIST           = [];

function _rebuildLists() {
  BGV_PENDING_LIST.length      = 0;
  CONTRACT_PENDING_LIST.length = 0;
  PAYMENT_PENDING_LIST.length  = 0;
  TRAINING_LIST.length         = 0;
  PLACEMENT_FOLLOWUP.length    = 0;
  PLACED_LIST.length           = 0;

  PIPELINE.forEach(c => {
    if (c.stage === 'bgv'                 && c.bgvStatus !== 'completed')      BGV_PENDING_LIST.push(c);
    if (c.stage === 'payment'             && c.paymentStatus !== 'completed')  PAYMENT_PENDING_LIST.push(c);
    if (c.stage === 'contract'            && c.contractStatus !== 'completed') CONTRACT_PENDING_LIST.push(c);
    if (c.stage === 'training')           TRAINING_LIST.push(c);
    if (c.stage === 'placement_followup') PLACEMENT_FOLLOWUP.push(c);
    if (c.stage === 'placed')             PLACED_LIST.push(c);
  });
}

// ── GREETING / DATETIME ───────────────────────────────
function updateGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good Morning' : h < 15 ? 'Good Afternoon' : 'Good Evening';
  const el = document.getElementById('greeting-text');
  if (el) el.textContent = g;
}
function updateDateTime() {
  const now  = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  const el = document.getElementById('tb-datetime');
  if (el) el.textContent = days[now.getDay()] + ', ' + now.getDate() + ' ' + mons[now.getMonth()] + ' ' + now.getFullYear() + '  ·  ' + pad(h) + ':' + pad(m) + ':' + pad(s) + ' ' + ap;
  updateGreeting();
}
function pad(n) { return String(n).padStart(2,'0'); }
function getAutoDateTime() {
  const now  = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let h = now.getHours(), m = now.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return {
    readableDate: days[now.getDay()]+', '+now.getDate()+' '+mons[now.getMonth()]+' '+now.getFullYear(),
    readableTime: pad(h)+':'+pad(m)+' '+ap,
    isoDate: now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())
  };
}

// ── FORMAT DATE HELPER ────────────────────────────────
function _fmtDate(raw) {
  if (!raw) return '—';
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  } catch(e) { return raw; }
}

// ── KPIs ─────────────────────────────────────────────
function renderKPIs() {
  _rebuildLists();
  const byStage = (s) => PIPELINE.filter(c => c.stage === s).length;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  set('k-total',      PIPELINE.length);
  set('k-registered', byStage('registered'));
  set('k-bgv',        PIPELINE.filter(c => c.stage === 'bgv').length);
  set('k-contract',   PIPELINE.filter(c => c.stage === 'contract').length);
  set('k-followup',   BGV_PENDING_LIST.length + PAYMENT_PENDING_LIST.length + CONTRACT_PENDING_LIST.length);
  set('k-training',   byStage('training'));
  set('k-placed',     byStage('placed'));

  set('dtab-reg-cnt',       byStage('registered'));
  set('dtab-bgv-cnt',       PIPELINE.filter(c => c.stage === 'bgv').length);
  set('dtab-contract-cnt',  PIPELINE.filter(c => c.stage === 'contract').length);
  set('dtab-followup-cnt',  BGV_PENDING_LIST.length + PAYMENT_PENDING_LIST.length + CONTRACT_PENDING_LIST.length);
  set('dtab-training-cnt',  byStage('training'));
  set('dtab-placed-cnt',    byStage('placed'));
  set('dtab-scheduled-cnt', INTERVIEW_HISTORY.length);

  set('sb-cnt-ramya',  PIPELINE.filter(c => (c.interviewer||'Ramya') === 'Ramya').length);
  set('sb-placed-cnt', PLACED_LIST.length);

  updateSidebarCounts();
}

function updateSidebarCounts() {
  _rebuildLists();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('sb-followup-bgv-cnt',       BGV_PENDING_LIST.length);
  set('sb-followup-payment-cnt',   PAYMENT_PENDING_LIST.length);
  set('sb-followup-contract-cnt',  CONTRACT_PENDING_LIST.length);
  set('sb-followup-training-cnt',  TRAINING_LIST.length);
  set('sb-followup-placement-cnt', PLACEMENT_FOLLOWUP.length);
  set('sb-followup-scheduled-cnt', INTERVIEW_HISTORY.length);

  const total = BGV_PENDING_LIST.length + PAYMENT_PENDING_LIST.length + CONTRACT_PENDING_LIST.length;
  const badge = document.getElementById('sb-followup-badge');
  if (badge) { badge.textContent = total; badge.style.display = total > 0 ? 'flex' : 'none'; }
}

// ── RENDER ALL TABLES ─────────────────────────────────
function renderAllTables() {
  renderRegisteredTable();
  renderBGVTable();
  renderContractTable();
  renderFollowupTable();
  renderTrainingTable();
  renderPlacedTable();
  renderScheduledTable();
  renderPlacedSidebar();
}

function _candAvatar(c, size) {
  size = size || 32;
  if (c.photo) {
    return `<img src="${esc(c.photo)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:1.5px solid var(--border-btn);flex-shrink:0;" onerror="this.outerHTML='<div style=&quot;width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,var(--teal),var(--mid-blue));display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.4)}px;font-weight:700;color:#fff;flex-shrink:0;&quot;>${esc(c.name.charAt(0))}</div>'">`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,var(--teal),var(--mid-blue));display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.4)}px;font-weight:700;color:#fff;flex-shrink:0;">${esc(c.name.charAt(0))}</div>`;
}

// ── REGISTERED TABLE ──────────────────────────────────
function renderRegisteredTable() {
  const tb = document.getElementById('registered-tbody'); if (!tb) return;
  const list = PIPELINE.filter(c => c.stage === 'registered');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty"><p>No registered candidates. Candidates appear here after the interviewer submits them.</p></div></td></tr>';
    return;
  }
  tb.innerHTML = list.map((c, i) => `<tr>
    <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
    <td><div style="display:flex;align-items:center;gap:8px;">${_candAvatar(c,28)}<strong>${esc(c.name)}</strong></div></td>
    <td style="font-size:12px;">${esc(c.contact)}</td>
    <td style="font-size:12px;color:var(--text-tag);">${esc(c.email||'—')}</td>
    <td style="font-size:12px;">${esc(c.interviewer||'Ramya')}</td>
    <td><span class="badge b-teal">${esc(c.country||'—')}</span></td>
    <td>
      ${c.submittedDate || c.joinedDate || c.submittedTime
        ? `<div style="font-size:11px;">
             <div style="color:var(--teal);font-weight:700;">📅 ${esc(c.submittedDate||c.joinedDate||'N/A')}</div>
             <div style="color:#6c3fc1;font-weight:600;margin-top:2px;">🕐 ${esc(c.submittedTime||c.joinedTime||'')}</div>
           </div>`
        : `<div style="font-size:11px;color:var(--text-muted);"><div>📅 ${esc(c.joinedDate||'—')}</div></div>`}
    </td>
    <td><span class="badge b-blue">Registered</span></td>
    <td><button class="btn btn-dark btn-sm" onclick="openVerifyModal('${c.id}')">Verify</button></td>
  </tr>`).join('');
}

// ── BGV TABLE ─────────────────────────────────────────
function renderBGVTable() {
  const tb = document.getElementById('bgv-tbody'); if (!tb) return;
  const list = PIPELINE.filter(c => c.stage === 'bgv');
  if (!list.length) { tb.innerHTML = '<tr><td colspan="7"><div class="empty"><p>No candidates in BGV stage.</p></div></td></tr>'; return; }
  tb.innerHTML = list.map((c, i) => {
    const uploaded = Object.keys(c.bgvDocs||{}).filter(k => c.bgvDocs[k]).length;
    return `<tr>
      <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
      <td><div style="display:flex;align-items:center;gap:8px;">${_candAvatar(c,28)}<strong>${esc(c.name)}</strong></div></td>
      <td style="font-size:12px;">${esc(c.contact)}</td>
      <td><span class="badge b-teal">${esc(c.country||'—')}</span></td>
      <td><span class="badge ${c.bgvStatus==='completed'?'b-green':'b-purple'}">${c.bgvStatus==='completed'?'Completed':'Pending'}</span></td>
      <td style="font-size:12px;">${uploaded}/${BGV_DOCS.length} docs</td>
      <td><button class="btn btn-purple btn-sm" onclick="resumePipeline('${c.id}')">Resume</button></td>
    </tr>`;
  }).join('');
}

// ── CONTRACT TABLE ────────────────────────────────────
function renderContractTable() {
  const tb = document.getElementById('contract-tbody'); if (!tb) return;
  const list = PIPELINE.filter(c => c.stage === 'contract');
  if (!list.length) { tb.innerHTML = '<tr><td colspan="7"><div class="empty"><p>No candidates in contract stage.</p></div></td></tr>'; return; }
  tb.innerHTML = list.map((c, i) => {
    const lastNote = (c.contractNotes||[]).slice(-1)[0];
    return `<tr>
      <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
      <td><div style="display:flex;align-items:center;gap:8px;">${_candAvatar(c,28)}<strong>${esc(c.name)}</strong></div></td>
      <td style="font-size:12px;">${esc(c.contact)}</td>
      <td><span class="badge b-teal">${esc(c.country||'—')}</span></td>
      <td><span class="badge ${c.contractStatus==='completed'?'b-green':'b-orange'}">${c.contractStatus==='completed'?'Completed':'Pending'}</span></td>
      <td style="font-size:12px;max-width:180px;">${lastNote ? esc(lastNote.text.substring(0,60))+'...' : '—'}</td>
      <td><button class="btn btn-teal btn-sm" onclick="resumePipeline('${c.id}')">Resume</button></td>
    </tr>`;
  }).join('');
}

// ── FOLLOWUP TABLE ────────────────────────────────────
function renderFollowupTable() {
  const tb = document.getElementById('followup-tbody'); if (!tb) return;
  const list = [...BGV_PENDING_LIST, ...PAYMENT_PENDING_LIST, ...CONTRACT_PENDING_LIST];
  if (!list.length) { tb.innerHTML = '<tr><td colspan="7"><div class="empty"><p>No follow-up candidates.</p></div></td></tr>'; return; }
  tb.innerHTML = list.map((c, i) => `<tr>
    <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
    <td><div style="display:flex;align-items:center;gap:8px;">${_candAvatar(c,28)}<strong>${esc(c.name)}</strong></div></td>
    <td style="font-size:12px;">${esc(c.contact)}</td>
    <td><span class="badge b-teal">${esc(c.country||'—')}</span></td>
    <td><span class="badge ${STAGE_BADGE[c.stage]||'b-gray'}">${STAGE_LABELS[c.stage]||c.stage}</span></td>
    <td style="font-size:12px;">—</td>
    <td><button class="btn btn-teal btn-sm" onclick="resumePipeline('${c.id}')">Resume</button></td>
  </tr>`).join('');
}

// ── TRAINING TABLE ────────────────────────────────────
function renderTrainingTable() {
  const tb = document.getElementById('training-tbody'); if (!tb) return;
  if (!TRAINING_LIST.length) { tb.innerHTML = '<tr><td colspan="7"><div class="empty"><p>No candidates in training.</p></div></td></tr>'; return; }
  tb.innerHTML = TRAINING_LIST.map((c, i) => {
    const done = (c.trainingProgress||[]).length;
    const dots = TRAINING_STAGES.map((s, idx) => {
      const isDone = (c.trainingProgress||[]).includes(s);
      const isActive = !isDone && idx === done;
      return `<div class="training-stage-dot ${isDone?'done':isActive?'active':''}" title="${s}"></div>`;
    }).join('');
    const allDone = done >= TRAINING_STAGES.length;
    return `<tr>
      <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
      <td><div style="display:flex;align-items:center;gap:8px;">${_candAvatar(c,28)}<strong>${esc(c.name)}</strong></div></td>
      <td style="font-size:12px;">${esc(c.contact)}</td>
      <td><span class="badge b-teal">${esc(c.country||'—')}</span></td>
      <td><span class="badge b-dark">${esc(TRAINING_STAGES[done]||'Completed')}</span></td>
      <td><div class="training-progress" style="gap:4px;">${dots}</div><div style="font-size:10px;color:var(--text-muted);margin-top:3px;">${done}/${TRAINING_STAGES.length} stages</div></td>
      <td>
        ${allDone
          ? `<button class="btn btn-green btn-sm" onclick="moveToPlacementFollowup('${c.id}')">Move to Placement</button>`
          : `<button class="btn btn-teal btn-sm" onclick="openTrainingModal('${c.id}')">Update Stage</button>`}
      </td>
    </tr>`;
  }).join('');
}

// ── PLACED TABLE ──────────────────────────────────────
function renderPlacedTable() {
  const tb = document.getElementById('placed-tbody'); if (!tb) return;
  if (!PLACED_LIST.length) {
    tb.innerHTML = '<tr><td colspan="8"><div class="empty"><p>No placed candidates yet.</p></div></td></tr>';
    return;
  }
  tb.innerHTML = PLACED_LIST.map((c, i) => `
    <tr style="cursor:pointer;" onclick="openPlacedCandidateModal('${c.id}')" title="Click to view full details">
      <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
      <td><div style="display:flex;align-items:center;gap:8px;">${_candAvatar(c,28)}<strong>${esc(c.name)}</strong></div></td>
      <td style="font-size:12px;">${esc(c.contact)}</td>
      <td style="font-size:12px;">${esc(c.placedCompany||'—')}</td>
      <td><span class="badge b-teal">${esc(c.country||'—')}</span></td>
      <td style="font-size:12px;">${_fmtDate(c.placedDate)}</td>
      <td><span class="badge b-green">Placed ✓</span></td>
      <td><button class="btn btn-green btn-sm" onclick="event.stopPropagation();openPlacedCandidateModal('${c.id}')">View Details</button></td>
    </tr>`).join('');
}

// ── PLACED CANDIDATE DETAIL MODAL ────────────────────
function openPlacedCandidateModal(id) {
  const c = PIPELINE.find(x => x.id === id); if (!c) return;

  // Remove any existing overlay first
  const existing = document.getElementById('placed-detail-overlay');
  if (existing) existing.remove();

  // Build interview history rows
  const historyRows = (c.interviewHistory || []).map((h, idx) => `
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid var(--border-div);font-size:12px;color:var(--text-muted);">${idx+1}</td>
      <td style="padding:9px 12px;border-bottom:1px solid var(--border-div);font-size:13px;font-weight:600;">${esc(h.company)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid var(--border-div);font-size:12px;">${esc(h.date)} · ${esc(h.time)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid var(--border-div);"><span class="badge b-blue">${esc(h.mode)}</span></td>
      <td style="padding:9px 12px;border-bottom:1px solid var(--border-div);">
        <span class="badge ${h.outcome==='Selected'?'b-green':h.outcome==='Rejected'?'b-red':'b-orange'}">${esc(h.outcome)}</span>
      </td>
      <td style="padding:9px 12px;border-bottom:1px solid var(--border-div);font-size:11px;color:var(--text-muted);">${esc(h.recordedAt||'—')}</td>
    </tr>`).join('');

  // Contract notes
  const noteCards = (c.contractNotes || []).map(n => `
    <div style="background:#fff;border:1px solid var(--border-div);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
      <div style="display:flex;gap:8px;margin-bottom:5px;flex-wrap:wrap;">
        <span style="background:var(--teal-light);color:var(--teal);padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">📅 ${esc(n.date||'—')}</span>
        <span style="background:#f0eaff;color:#6c3fc1;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">🕐 ${esc(n.time||'—')}</span>
      </div>
      <div style="font-size:13px;color:var(--text-inp);line-height:1.5;">${esc(n.text)}</div>
    </div>`).join('');

  // BGV docs
  const bgvDocs = c.bgvDocs || {};
  const uploadedDocs = BGV_DOCS.filter(d => !!bgvDocs[d.key]);
  const bgvDocsList = uploadedDocs.map(d => `
    <span style="display:inline-flex;align-items:center;gap:4px;background:var(--suc-bg);border:1px solid var(--suc-bdr);color:var(--suc);border-radius:16px;padding:3px 10px;font-size:11px;font-weight:600;margin:3px;">
      ✓ ${esc(d.label)}
    </span>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'placed-detail-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(22,46,90,.65);backdrop-filter:blur(4px);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px;';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:860px;max-width:98vw;max-height:94vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(22,46,90,.4);overflow:hidden;">

      <!-- HEADER -->
      <div style="background:linear-gradient(135deg,#162E5A,#1a5276);padding:20px 26px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:14px;">
          ${c.photo
            ? `<img src="${esc(c.photo)}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2.5px solid rgba(39,174,96,.7);flex-shrink:0;" onerror="this.outerHTML='<div style=&quot;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#27ae60,#1a7a40);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;flex-shrink:0;&quot;>${esc(c.name.charAt(0))}</div>'">`
            : `<div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#27ae60,#1a7a40);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;flex-shrink:0;">${esc(c.name.charAt(0))}</div>`}
          <div>
            <div style="font-size:20px;font-weight:700;color:#fff;">${esc(c.name)}</div>
            <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:3px;">${esc(c.contact)} · ${esc(c.email||'—')}</div>
            <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">
              <span style="background:rgba(39,174,96,.3);color:#2ecc71;border-radius:12px;padding:3px 12px;font-size:11px;font-weight:700;">✓ PLACED</span>
              <span style="background:rgba(255,255,255,.15);color:#fff;border-radius:12px;padding:3px 12px;font-size:11px;font-weight:600;">🏢 ${esc(c.placedCompany||'—')}</span>
              <span style="background:rgba(255,255,255,.15);color:#fff;border-radius:12px;padding:3px 12px;font-size:11px;font-weight:600;">📅 ${_fmtDate(c.placedDate)}</span>
            </div>
          </div>
        </div>
        <button onclick="document.getElementById('placed-detail-overlay').remove();"
          style="width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;font-size:20px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>

      <!-- SCROLLABLE BODY -->
      <div style="flex:1;overflow-y:auto;padding:24px 26px;">

        <!-- KEY INFO GRID -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
          ${_infoCard('🏢 Placed Company', c.placedCompany||'—', '#27ae60')}
          ${_infoCard('📅 Placement Date', _fmtDate(c.placedDate), '#1F9A94')}
          ${_infoCard('🌍 Country', c.country||'—', '#2980b9')}
          ${_infoCard('🎓 Qualification', c.qualification||'—', '#8e44ad')}
          ${_infoCard('💼 Experience', c.experience||'—', '#e67e22')}
          ${_infoCard('💰 Expected Salary', c.expectedSalary ? 'Rs. '+c.expectedSalary : '—', '#16a085')}
        </div>

        <!-- REGISTRATION INFO -->
        <div style="background:var(--bg-role);border:1px solid var(--border-div);border-radius:10px;padding:16px 18px;margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--text-tag);margin-bottom:12px;">📋 Registration Info</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
            <div>
              <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:3px;">Enrollment No.</div>
              <div style="font-size:13px;font-weight:700;color:var(--dark-blue);">${esc(c.enrollmentNo||'—')}</div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:3px;">Recruiter</div>
              <div style="font-size:13px;font-weight:700;color:var(--dark-blue);">${esc(c.recruiter||'—')}</div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:3px;">Interviewer</div>
              <div style="font-size:13px;font-weight:700;color:var(--dark-blue);">${esc(c.interviewer||'Ramya')}</div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:3px;">Submitted Date</div>
              <div style="font-size:13px;font-weight:700;color:var(--teal);">📅 ${esc(c.submittedDate||'—')}</div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:3px;">Submitted Time</div>
              <div style="font-size:13px;font-weight:700;color:#6c3fc1;">🕐 ${esc(c.submittedTime||'—')}</div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:3px;">BGV Status</div>
              <div style="margin-top:2px;"><span class="badge ${c.bgvStatus==='completed'?'b-green':'b-orange'}">${esc(c.bgvStatus||'—')}</span></div>
            </div>
          </div>
        </div>

        <!-- PAYMENT INFO -->
        <div style="background:linear-gradient(135deg,rgba(192,57,43,.06),rgba(22,46,90,.04));border:1.5px solid rgba(192,57,43,.2);border-radius:10px;padding:16px 18px;margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--text-tag);margin-bottom:12px;">💳 Payment Details</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
            <div>
              <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:3px;">Payment Status</div>
              <div style="margin-top:2px;"><span class="badge ${c.paymentStatus==='completed'?'b-green':'b-orange'}">${esc(c.paymentStatus||'—')}</span></div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:3px;">Amount</div>
              <div style="font-size:14px;font-weight:700;color:var(--dark-blue);">${c.paymentAmount ? 'Rs. '+esc(c.paymentAmount) : '—'}</div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:3px;">Payment Date</div>
              <div style="font-size:13px;font-weight:700;color:var(--dark-blue);">${_fmtDate(c.paymentDate)}</div>
            </div>
          </div>
        </div>

        <!-- BGV DOCUMENTS -->
        ${uploadedDocs.length > 0 ? `
        <div style="background:var(--suc-bg);border:1.5px solid var(--suc-bdr);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--suc);margin-bottom:10px;">
            📁 BGV Documents — ${uploadedDocs.length}/${BGV_DOCS.length} uploaded
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">${bgvDocsList}</div>
        </div>` : `
        <div style="background:var(--bg-role);border:1px solid var(--border-div);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--text-tag);margin-bottom:6px;">📁 BGV Documents</div>
          <div style="font-size:12px;color:var(--text-muted);">No documents uploaded yet.</div>
        </div>`}

        <!-- CONTRACT NOTES -->
        ${(c.contractNotes||[]).length > 0 ? `
        <div style="background:var(--bg-role);border:1px solid var(--border-div);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--text-tag);margin-bottom:10px;">
            📝 Contract Notes (${c.contractNotes.length})
          </div>
          ${noteCards}
        </div>` : ''}

        <!-- TRAINING PROGRESS -->
        <div style="background:var(--bg-role);border:1px solid var(--border-div);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--text-tag);margin-bottom:10px;">
            🎓 Training Progress — ${(c.trainingProgress||[]).length}/${TRAINING_STAGES.length} stages completed
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${TRAINING_STAGES.map(s => {
              const done = (c.trainingProgress||[]).includes(s);
              return `<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:16px;font-size:11.5px;font-weight:600;background:${done?'var(--suc-bg)':'var(--bg-white)'};border:1.5px solid ${done?'var(--suc-bdr)':'var(--border-btn)'};color:${done?'var(--suc)':'var(--text-muted)'};">
                ${done?'✓':''} ${esc(s)}
              </span>`;
            }).join('')}
          </div>
        </div>

        <!-- INTERVIEW HISTORY -->
        <div style="border:1px solid var(--border-div);border-radius:10px;overflow:hidden;margin-bottom:16px;">
          <div style="background:var(--bg-role);padding:12px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--text-tag);">
            📋 Interview History (${(c.interviewHistory||[]).length} record${(c.interviewHistory||[]).length !== 1?'s':''})
          </div>
          ${historyRows ? `
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f8fafc;">
              <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--text-tag);text-transform:uppercase;">#</th>
              <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--text-tag);text-transform:uppercase;">Company</th>
              <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--text-tag);text-transform:uppercase;">Date & Time</th>
              <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--text-tag);text-transform:uppercase;">Mode</th>
              <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--text-tag);text-transform:uppercase;">Outcome</th>
              <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--text-tag);text-transform:uppercase;">Recorded</th>
            </tr></thead>
            <tbody>${historyRows}</tbody>
          </table>` : `
          <div style="padding:20px;text-align:center;font-size:13px;color:var(--text-muted);">No interview records yet.</div>`}
        </div>

      </div>

      <!-- FOOTER -->
      <div style="padding:14px 26px;border-top:1px solid var(--border-div);display:flex;justify-content:flex-end;flex-shrink:0;background:#fff;">
        <button onclick="document.getElementById('placed-detail-overlay').remove();" class="btn btn-outline">Close</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
}

// ── INFO CARD HELPER ──────────────────────────────────
function _infoCard(label, value, color) {
  return `<div style="background:var(--bg-white);border:1.5px solid var(--border-div);border-radius:10px;padding:12px 14px;border-left:3px solid ${color};">
    <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:6px;">${label}</div>
    <div style="font-size:14px;font-weight:700;color:var(--dark-blue);">${esc(String(value||'—'))}</div>
  </div>`;
}

// ── SCHEDULED HISTORY TABLE ───────────────────────────
function renderScheduledTable() {
  const tb = document.getElementById('scheduled-tbody'); if (!tb) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('dtab-scheduled-cnt', INTERVIEW_HISTORY.length);
  set('sb-followup-scheduled-cnt', INTERVIEW_HISTORY.length);

  if (!INTERVIEW_HISTORY.length) {
    tb.innerHTML = '<tr><td colspan="7"><div class="empty"><p>No scheduled interviews yet.</p></div></td></tr>';
    return;
  }
  tb.innerHTML = INTERVIEW_HISTORY.map((h, i) => {
    const cand = PIPELINE.find(x => x.id === h.candidateId);
    const avatarHtml = cand && cand.photo
      ? `<img src="${esc(cand.photo)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:1.5px solid var(--border-btn);flex-shrink:0;">`
      : `<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--teal),var(--mid-blue));display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0;">${esc((h.candidateName||'?').charAt(0))}</div>`;
    return `<tr>
      <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
      <td><div style="display:flex;align-items:center;gap:8px;">${avatarHtml}<strong>${esc(h.candidateName||'—')}</strong></div></td>
      <td style="font-size:12px;font-weight:600;">${esc(h.company)}</td>
      <td style="font-size:12px;">${esc(h.date)} &nbsp;·&nbsp; ${esc(h.time)}</td>
      <td><span class="badge b-blue">${esc(h.mode)}</span></td>
      <td><span class="badge ${h.outcome==='Selected'?'b-green':h.outcome==='Rejected'?'b-red':h.outcome==='Waiting for Next Round'?'b-orange':'b-gray'}">${esc(h.outcome)}</span></td>
      <td style="font-size:11px;color:var(--text-muted);">${esc(h.recordedAt||'—')}</td>
    </tr>`;
  }).join('');
}

// ── PLACED SIDEBAR ────────────────────────────────────
function renderPlacedSidebar() {
  const container = document.getElementById('sb-placed-list'); if (!container) return;
  const cnt = document.getElementById('sb-placed-cnt'); if (cnt) cnt.textContent = PLACED_LIST.length;
  if (!PLACED_LIST.length) {
    container.innerHTML = `<div style="padding:10px 16px 10px 22px;font-size:11px;color:rgba(255,255,255,.35);font-style:italic;">No placed candidates yet</div>`;
    return;
  }
  container.innerHTML = PLACED_LIST.map((c) => `
    <div onclick="openPlacedCandidateModal('${c.id}')" style="display:flex;align-items:center;gap:10px;padding:9px 16px 9px 22px;border-left:3px solid #27ae60;background:rgba(39,174,96,.08);cursor:pointer;transition:background .15s;"
      onmouseenter="this.style.background='rgba(39,174,96,.16)'" onmouseleave="this.style.background='rgba(39,174,96,.08)'">
      <div style="width:28px;height:28px;border-radius:50%;flex-shrink:0;overflow:hidden;background:linear-gradient(135deg,#27ae60,#1a7a40);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;">
        ${c.photo ? `<img src="${esc(c.photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" onerror="this.style.display='none';">` : esc(c.name.charAt(0))}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.name)}</div>
        <div style="font-size:10px;color:rgba(255,255,255,.45);">${esc(c.country||'—')} · ${esc(c.placedCompany||'—')}</div>
      </div>
      <span style="font-size:9px;font-weight:700;color:#2ecc71;background:rgba(39,174,96,.25);border-radius:6px;padding:2px 6px;white-space:nowrap;">View</span>
    </div>`).join('');
}

// ── INTERVIEWER VIEW ──────────────────────────────────
function openInterviewerView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-interviewer').classList.add('active');

  const intName = name === 'ramya' ? 'Ramya' : name;
  document.getElementById('int-view-ttl').textContent = intName + "'s Candidates";

  const list = PIPELINE.filter(c => (c.interviewer||'Ramya') === intName);
  document.getElementById('int-view-sub').textContent = list.length + ' candidate' + (list.length !== 1 ? 's' : '') + ' in pipeline';

  document.getElementById('int-view-profile').innerHTML = `
    <div class="rec-view-ava">
      <img src="ramya.jpeg" alt="Ramya" onerror="this.style.display='none';this.parentNode.textContent='R';">
    </div>
    <div>
      <div class="rec-view-nm">${esc(intName)}</div>
      <div class="rec-view-rl">Interviewer · The JobSync</div>
    </div>`;

  const tb = document.getElementById('int-cand-tbody');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="8"><div class="empty"><p>No candidates submitted by this interviewer yet.</p></div></td></tr>';
    return;
  }
  tb.innerHTML = list.map((c, i) => `<tr>
    <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
    <td><div style="display:flex;align-items:center;gap:8px;">${_candAvatar(c, 30)}<strong>${esc(c.name)}</strong></div></td>
    <td style="font-size:12px;">${esc(c.contact)}</td>
    <td style="font-size:12px;color:var(--text-tag);">${esc(c.email||'—')}</td>
    <td><span class="badge b-teal">${esc(c.country||'—')}</span></td>
    <td>
      ${c.submittedDate
        ? `<div style="font-size:11px;">
             <span style="color:var(--teal);font-weight:700;">📅 ${esc(c.submittedDate)}</span>
             ${c.submittedTime ? `<span style="color:#6c3fc1;font-weight:600;margin-left:4px;">🕐 ${esc(c.submittedTime)}</span>` : ''}
           </div>`
        : '<span style="color:var(--text-muted);font-size:11px;">—</span>'}
    </td>
    <td><span class="badge ${STAGE_BADGE[c.stage]||'b-gray'}">${STAGE_LABELS[c.stage]||c.stage}</span></td>
    <td>
      ${c.stage === 'registered'
        ? `<button class="btn btn-dark btn-sm" onclick="openVerifyModal('${c.id}')">Verify</button>`
        : c.stage === 'placed'
          ? `<button class="btn btn-green btn-sm" onclick="openPlacedCandidateModal('${c.id}')">View Details</button>`
          : `<button class="btn btn-teal btn-sm" onclick="resumePipeline('${c.id}')">Resume</button>`}
    </td>
  </tr>`).join('');
}

// ── DASHBOARD VIEW ────────────────────────────────────
function showDashboard() {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-dashboard').classList.add('active');
  document.querySelectorAll('.dash-tab').forEach((b,i) => b.classList.toggle('active', i===0));
  document.querySelectorAll('.dash-section').forEach((s,i) => s.classList.toggle('active', i===0));
  renderAllTables();
  renderKPIs();
}

// ── VERIFY MODAL (BGV Step 1) ─────────────────────────
function openVerifyModal(id) {
  const c = PIPELINE.find(x => x.id === id); if (!c) return;
  curCandidate = c;
  currentStep  = 1;
  stepData     = { ...c };
  _openModal('BGV: Document Verification', 'Background Verification — Step 1 of 5', true);
  _renderStepsBar();
  renderBGVStep();
}

function resumePipeline(id) {
  const c = PIPELINE.find(x => x.id === id); if (!c) return;
  curCandidate = c;
  stepData     = { ...c };
  const prog = CANDIDATE_PROGRESS[id];
  if (prog) { currentStep = prog.step; Object.assign(stepData, prog.stepData); }
  else { currentStep = _stageToStep(c.stage); }
  _openModal(c.name + ' — Pipeline', 'Resuming from ' + (STAGE_LABELS[c.stage]||c.stage), true);
  _renderStepsBar();
  renderPipelineStep();
}

function _stageToStep(stage) {
  const map = { registered:1, bgv:1, payment:2, contract:3, training:4, placement_followup:5, placed:5 };
  return map[stage] || 1;
}

// ── MODAL HELPERS ─────────────────────────────────────
function _openModal(title, sub, showSteps) {
  document.getElementById('mod-ttl').textContent = title;
  document.getElementById('mod-sub').textContent = sub;
  document.getElementById('mod-overlay').classList.add('open');
  if (showSteps) _renderStepsBar();
  else document.getElementById('steps-bar').innerHTML = '';
}

function _renderStepsBar() {
  const steps = ['BGV', 'Payment', 'Contract', 'Training', 'Placement'];
  document.getElementById('steps-bar').innerHTML = steps.map((s,i) => {
    const n = i + 1;
    let cls = n < currentStep ? 'done' : n === currentStep ? 'active' : '';
    return `<div class="step-pill ${cls}">${n}. ${s}</div>`;
  }).join('');
}

function closeModal() {
  if (curCandidate && currentStep > 0) {
    CANDIDATE_PROGRESS[curCandidate.id] = { step: currentStep, stepData: { ...stepData } };
  }
  document.getElementById('mod-overlay').classList.remove('open');
  curCandidate = null; currentStep = 1; stepData = {};
  renderAllTables(); renderKPIs(); updateSidebarCounts();
}

function finalCloseModal() {
  if (curCandidate) delete CANDIDATE_PROGRESS[curCandidate.id];
  document.getElementById('mod-overlay').classList.remove('open');
  curCandidate = null; currentStep = 1; stepData = {};
  renderAllTables(); renderKPIs(); updateSidebarCounts(); renderPlacedSidebar();
}

// ── BGV STEP ──────────────────────────────────────────
function renderBGVStep() {
  const c = curCandidate;
  const docs = c.bgvDocs || {};
  const uploadedCount = BGV_DOCS.filter(d => !!docs[d.key]).length;
  const allUploaded   = uploadedCount === BGV_DOCS.length;

  const docGrid = BGV_DOCS.map(d => {
    const isUploaded = !!docs[d.key];
    return `<div class="doc-item ${isUploaded?'uploaded':''}" id="docitem-${d.key}">
      <label>
        <div class="doc-item-name">${esc(d.label)}</div>
        <div class="doc-item-status" id="docstatus-${d.key}">${isUploaded ? '✓ ' + esc(String(docs[d.key]).substring(0,22)) : 'Click to upload'}</div>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" onchange="handleDocUpload('${d.key}', this)"/>
      </label>
    </div>`;
  }).join('');

  document.getElementById('mod-body').innerHTML = `
    <div class="alert-strip" id="step-alert"></div>
    <div style="background:linear-gradient(135deg,rgba(142,68,173,.08),rgba(22,46,90,.05));border:1.5px solid rgba(142,68,173,.2);border-radius:12px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;gap:14px;">
      ${c.photo
        ? `<img src="${esc(c.photo)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid rgba(142,68,173,.4);flex-shrink:0;">`
        : `<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#8e44ad,#6c3fc1);display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;flex-shrink:0;">${esc(c.name.charAt(0))}</div>`}
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--dark-blue);">${esc(c.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">${esc(c.contact)} · ${esc(c.country||'—')} · Enrollment: ${esc(c.enrollmentNo||'—')}</div>
        ${c.submittedDate ? `<div style="font-size:11px;color:var(--teal);margin-top:3px;">📅 Submitted: ${esc(c.submittedDate)} ${c.submittedTime ? '🕐 '+esc(c.submittedTime) : ''}</div>` : ''}
      </div>
    </div>
    <div style="font-size:13px;font-weight:700;color:var(--dark-blue);margin-bottom:4px;">Upload Documents</div>
    <div style="font-size:11px;color:${allUploaded?'var(--suc)':'var(--text-muted)'};margin-bottom:12px;">
      ${uploadedCount}/${BGV_DOCS.length} uploaded — ${allUploaded ? '✓ All documents uploaded!' : 'Upload all ' + BGV_DOCS.length + ' documents to enable Completed.'}
    </div>
    <div class="doc-upload-grid">${docGrid}</div>
    <div style="margin-top:20px;padding:16px;background:var(--bg-role);border:1px solid var(--border-div);border-radius:10px;">
      <div style="font-size:13px;font-weight:700;color:var(--dark-blue);margin-bottom:12px;">BGV Status</div>
      <div class="opt-row">
        <button class="opt-btn ${allUploaded && c.bgvStatus==='completed' ? 'sel-yes' : ''}"
          id="bgv-completed"
          onclick="pickBGVStatus('completed')"
          style="${!allUploaded ? 'opacity:0.4;cursor:not-allowed;' : ''}">
          ✓ Completed ${!allUploaded ? '<br><small>(Upload all docs first)</small>' : ''}
        </button>
        <button class="opt-btn ${!c.bgvStatus || c.bgvStatus==='pending' ? 'sel-no' : ''}" id="bgv-pending" onclick="pickBGVStatus('pending')">Pending</button>
      </div>
    </div>`;

  document.getElementById('mod-ft').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-teal" onclick="submitBGVStep()">Next</button>`;

  if (!c.bgvStatus) { curCandidate.bgvStatus = 'pending'; stepData.bgvStatus = 'pending'; }
}

async function handleDocUpload(key, input) {
  const file = input.files[0];
  if (!file) return;

  const statusEl = document.getElementById('docstatus-' + key);
  const itemEl   = document.getElementById('docitem-' + key);
  if (statusEl) statusEl.textContent = '⏳ Uploading...';

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('candidateId', curCandidate.id);
    formData.append('docKey', key);

    const res = await fetch('/api/uploads/bgv-doc', {
      method: 'POST',
      headers: { 'x-session-token': getToken() },
      body: formData
    });

    const data = await res.json();

    if (!data.success) {
      showAlert('Upload failed: ' + data.error, 'err');
      if (statusEl) statusEl.textContent = '✗ Upload failed';
      return;
    }

    if (!curCandidate.bgvDocs) curCandidate.bgvDocs = {};
    curCandidate.bgvDocs[key] = data.path;

    const pipelineCandidate = PIPELINE.find(p => String(p.id) === String(curCandidate.id));
    if (pipelineCandidate) {
      if (!pipelineCandidate.bgvDocs) pipelineCandidate.bgvDocs = {};
      pipelineCandidate.bgvDocs[key] = data.path;
    }

    try { localStorage.setItem('pl_pipeline', JSON.stringify(PIPELINE)); } catch(e) {}

    showToast(file.name + ' uploaded!', 'ok');

    if (statusEl) statusEl.textContent = '✓ ' + file.name.substring(0, 22);
    if (itemEl)   itemEl.classList.add('uploaded');

    renderBGVStep();

  } catch (err) {
    console.error('Upload error:', err);
    showAlert('Upload error: ' + err.message, 'err');
    if (statusEl) statusEl.textContent = '✗ Upload failed';
  }
}

function pickBGVStatus(v) {
  const docs = curCandidate.bgvDocs || {};
  const uploadedCount = BGV_DOCS.filter(d => !!docs[d.key]).length;
  if (v === 'completed' && uploadedCount < BGV_DOCS.length) {
    showAlert('Please upload all ' + BGV_DOCS.length + ' documents before marking BGV as Completed.', 'err');
    return;
  }
  stepData.bgvStatus = v;
  curCandidate.bgvStatus = v;
  const compBtn = document.getElementById('bgv-completed');
  const pendBtn = document.getElementById('bgv-pending');
  if (compBtn) compBtn.className = 'opt-btn' + (v==='completed' ? ' sel-yes' : '');
  if (pendBtn) pendBtn.className = 'opt-btn' + (v==='pending'   ? ' sel-no'  : '');
}

function submitBGVStep() {
  const status = stepData.bgvStatus || curCandidate.bgvStatus;
  if (!status) { showAlert('Please select BGV status.', 'err'); return; }
  if (status === 'completed') {
    const docs = curCandidate.bgvDocs || {};
    if (BGV_DOCS.filter(d => !!docs[d.key]).length < BGV_DOCS.length) {
      showAlert('Please upload all ' + BGV_DOCS.length + ' documents before proceeding.', 'err');
      return;
    }
  }
  curCandidate.bgvStatus = status;
  if (status === 'pending') {
    curCandidate.stage = 'bgv';
    _saveData();
    _showSuccessBox('Stored in BGV Pending', 'BGV is marked as pending for <strong>' + esc(curCandidate.name) + '</strong>.');
    showToast(curCandidate.name + ' stored in BGV Pending.', 'ok');
  } else {
    curCandidate.stage = 'payment';
    curCandidate.paymentStatus = curCandidate.paymentStatus || '';
    _saveData();
    currentStep = 2;
    _openModal(curCandidate.name + ' — Payment', 'Step 2: Payment', true);
    _renderStepsBar();
    renderPaymentStep();
  }
  renderAllTables(); renderKPIs(); updateSidebarCounts();
}

// ── PAYMENT STEP ──────────────────────────────────────
function renderPaymentStep() {
  const c = curCandidate;
  document.getElementById('mod-body').innerHTML = `
    <div class="alert-strip" id="step-alert"></div>
    <div style="background:linear-gradient(135deg,rgba(192,57,43,.08),rgba(22,46,90,.05));border:1.5px solid rgba(192,57,43,.2);border-radius:12px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;gap:14px;">
      ${c.photo ? `<img src="${esc(c.photo)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid rgba(192,57,43,.4);flex-shrink:0;">` : `<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#c0392b,#e74c3c);display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;flex-shrink:0;">${esc(c.name.charAt(0))}</div>`}
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--dark-blue);">${esc(c.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">Payment Stage · ${esc(c.country||'—')}</div>
      </div>
    </div>
    <div class="decision-section">
      <div class="decision-lbl">Payment Status <span class="req">*</span></div>
      <div class="opt-row">
        <button class="opt-btn ${c.paymentStatus==='completed'?'sel-yes':''}" id="pay-completed" onclick="pickPaymentStatus('completed')">Received</button>
        <button class="opt-btn ${c.paymentStatus==='pending'||!c.paymentStatus?'sel-no':''}" id="pay-pending" onclick="pickPaymentStatus('pending')">Pending</button>
      </div>
    </div>
    <div id="pay-details-wrap" style="${c.paymentStatus==='completed'?'':'display:none;'}">
      <div class="decision-section">
        <div class="decision-lbl">Payment Mode <span class="req">*</span></div>
        <div class="opt-row">
          <button class="opt-btn ${c.paymentMode==='cash'?'sel-yes':''}" id="pay-cash" onclick="pickPayMode('cash')">Cash</button>
          <button class="opt-btn ${c.paymentMode==='netbanking'?'sel-yes':''}" id="pay-online" onclick="pickPayMode('netbanking')">Net Banking / UPI</button>
        </div>
      </div>
      <div class="f-grid" style="gap:12px;">
        <div class="f-grp"><label>Amount (Rs.) <span class="req">*</span></label><input type="number" id="pay-amount" value="${esc(c.paymentAmount||'')}" placeholder="e.g. 15000"/></div>
        <div class="f-grp"><label>Date <span class="req">*</span></label><input type="date" id="pay-date" value="${c.paymentDate||''}"/></div>
        <div id="pay-txn-wrap" class="f-grp" style="${c.paymentMode==='netbanking'?'':'display:none;'}"><label>Transaction / UTR No. <span class="req">*</span></label><input type="text" id="pay-txn" value="${esc(c.paymentTxn||'')}"/></div>
        <div class="f-grp"><label>Receipt No.</label><input type="text" id="pay-receipt" value="${esc(c.paymentReceipt||'')}"/></div>
        <div class="f-grp full"><label>Remarks</label><textarea id="pay-remarks" style="min-height:60px;">${esc(c.paymentRemarks||'')}</textarea></div>
      </div>
    </div>
    <div id="pay-pending-msg" style="${c.paymentStatus==='pending'||!c.paymentStatus?'':'display:none;'}margin-top:12px;">
      <div style="background:#fff3e6;border:1px solid rgba(230,126,34,.3);border-radius:8px;padding:10px 14px;font-size:12.5px;font-weight:600;color:#b85c00;">Payment pending — candidate stored in Payment Pending list.</div>
    </div>`;

  document.getElementById('mod-ft').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-teal" onclick="submitPaymentStep()">Next</button>`;
}

function pickPaymentStatus(v) {
  curCandidate.paymentStatus = v;
  document.getElementById('pay-completed').className = 'opt-btn' + (v==='completed'?' sel-yes':'');
  document.getElementById('pay-pending').className   = 'opt-btn' + (v==='pending'?' sel-no':'');
  document.getElementById('pay-details-wrap').style.display = v==='completed' ? '' : 'none';
  document.getElementById('pay-pending-msg').style.display  = v==='pending'   ? '' : 'none';
}
function pickPayMode(v) {
  curCandidate.paymentMode = v;
  document.getElementById('pay-cash').className   = 'opt-btn' + (v==='cash'?' sel-yes':'');
  document.getElementById('pay-online').className = 'opt-btn' + (v==='netbanking'?' sel-yes':'');
  const txnWrap = document.getElementById('pay-txn-wrap');
  if (txnWrap) txnWrap.style.display = v==='netbanking' ? '' : 'none';
}

function submitPaymentStep() {
  const status = curCandidate.paymentStatus;
  if (!status) { showAlert('Please select payment status.', 'err'); return; }
  if (status === 'pending') {
    curCandidate.stage = 'payment';
    _saveData();
    _showSuccessBox('Stored in Payment Pending', 'Payment is pending for <strong>' + esc(curCandidate.name) + '</strong>.');
    showToast(curCandidate.name + ' stored in Payment Pending.', 'ok');
    renderAllTables(); renderKPIs(); updateSidebarCounts();
    return;
  }
  if (!curCandidate.paymentMode) { showAlert('Please select payment mode.', 'err'); return; }
  const amount = (document.getElementById('pay-amount')||{}).value?.trim();
  const date   = (document.getElementById('pay-date')||{}).value?.trim();
  if (!amount) { showAlert('Please enter payment amount.', 'err'); return; }
  if (!date)   { showAlert('Please enter payment date.', 'err'); return; }
  if (curCandidate.paymentMode === 'netbanking') {
    const txn = (document.getElementById('pay-txn')||{}).value?.trim();
    if (!txn) { showAlert('Please enter transaction / UTR number.', 'err'); return; }
    curCandidate.paymentTxn = txn;
  }
  curCandidate.paymentAmount  = amount;
  curCandidate.paymentDate    = date;
  curCandidate.paymentReceipt = (document.getElementById('pay-receipt')||{}).value?.trim() || '';
  curCandidate.paymentRemarks = (document.getElementById('pay-remarks')||{}).value?.trim() || '';
  curCandidate.stage = 'contract';
  curCandidate.contractStatus = curCandidate.contractStatus || '';
  _saveData();
  currentStep = 3;
  _openModal(curCandidate.name + ' — Contract', 'Step 3: Contract Notes', true);
  _renderStepsBar();
  renderContractStep();
  renderAllTables(); renderKPIs(); updateSidebarCounts();
}

// ── CONTRACT STEP ─────────────────────────────────────
function renderContractStep() {
  const c = curCandidate;
  const notes = c.contractNotes || [];
  const hasNotes = notes.length > 0;

  document.getElementById('mod-body').innerHTML = `
    <div class="alert-strip" id="step-alert"></div>
    <div style="background:linear-gradient(135deg,rgba(230,126,34,.08),rgba(22,46,90,.05));border:1.5px solid rgba(230,126,34,.25);border-radius:12px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;gap:14px;">
      ${c.photo ? `<img src="${esc(c.photo)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0;">` : `<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#e67e22,#d35400);display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;flex-shrink:0;">${esc(c.name.charAt(0))}</div>`}
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--dark-blue);">${esc(c.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">Contract Stage · ${esc(c.country||'—')}</div>
      </div>
    </div>
    <div class="notes-section">
      <div style="font-size:13px;font-weight:700;color:var(--dark-blue);margin-bottom:10px;">Contract Notes</div>
      <div class="f-grp" style="margin-bottom:10px;">
        <label>Note <span class="req">*</span></label>
        <textarea id="contract-note" placeholder="Enter contract details or remarks..." style="min-height:80px;"></textarea>
      </div>
      <button class="btn btn-outline btn-sm" onclick="addContractNote()">Save Note</button>
      ${notes.length > 0 ? `
        <div class="notes-history" style="margin-top:14px;">
          <div style="font-size:11px;font-weight:700;color:var(--text-tag);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">Saved Notes (${notes.length})</div>
          ${notes.slice().reverse().map(n => `
            <div class="note-card">
              <div class="note-meta"><span class="note-date">${esc(n.date)}</span><span class="note-time">${esc(n.time)}</span></div>
              <div class="note-text">${esc(n.text)}</div>
            </div>`).join('')}
        </div>` : ''}
    </div>
    <div style="margin-top:20px;padding:16px;background:var(--bg-role);border:1px solid var(--border-div);border-radius:10px;">
      <div style="font-size:13px;font-weight:700;color:var(--dark-blue);margin-bottom:4px;">Contract Status</div>
      <div style="font-size:11px;color:${hasNotes?'var(--suc)':'var(--text-muted)'};margin-bottom:12px;">
        ${hasNotes ? '✓ Note saved. You can mark as Completed.' : '⚠ Write and save at least one note to enable Completed.'}
      </div>
      <div class="opt-row">
        <button class="opt-btn ${hasNotes && c.contractStatus==='completed' ? 'sel-yes' : ''}"
          id="contract-completed"
          onclick="pickContractStatus('completed')"
          style="${!hasNotes ? 'opacity:0.4;cursor:not-allowed;' : ''}">
          ✓ Completed ${!hasNotes ? '<br><small>(Save a note first)</small>' : ''}
        </button>
        <button class="opt-btn ${!c.contractStatus || c.contractStatus==='pending' ? 'sel-no' : ''}" id="contract-pending" onclick="pickContractStatus('pending')">Pending</button>
      </div>
    </div>`;

  document.getElementById('mod-ft').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-teal" onclick="submitContractStep()">Save & Next</button>`;
}

function addContractNote() {
  const text = (document.getElementById('contract-note')||{}).value?.trim() || '';
  if (!text) { showAlert('Please enter a note before saving.', 'err'); return; }
  const dt = getAutoDateTime();
  if (!curCandidate.contractNotes) curCandidate.contractNotes = [];
  curCandidate.contractNotes.push({ text, date: dt.readableDate, time: dt.readableTime });
  _saveData();
  showToast('Note saved!', 'ok');
  renderContractStep();
}

function pickContractStatus(v) {
  const notes = curCandidate.contractNotes || [];
  if (v === 'completed' && notes.length === 0) {
    showAlert('Please write and save at least one contract note before marking as Completed.', 'err');
    return;
  }
  curCandidate.contractStatus = v;
  const compBtn = document.getElementById('contract-completed');
  const pendBtn = document.getElementById('contract-pending');
  if (compBtn) compBtn.className = 'opt-btn' + (v==='completed' ? ' sel-yes' : '');
  if (pendBtn) pendBtn.className = 'opt-btn' + (v==='pending'   ? ' sel-no'  : '');
}

function submitContractStep() {
  const noteEl = document.getElementById('contract-note');
  const note = noteEl ? noteEl.value.trim() : '';
  if (note) {
    const dt = getAutoDateTime();
    if (!curCandidate.contractNotes) curCandidate.contractNotes = [];
    curCandidate.contractNotes.push({ text: note, date: dt.readableDate, time: dt.readableTime });
  }
  const status = curCandidate.contractStatus;
  if (!status) { showAlert('Please select contract status.', 'err'); return; }
  if (status === 'completed' && (!curCandidate.contractNotes || curCandidate.contractNotes.length === 0)) {
    showAlert('Please write and save at least one contract note before marking as Completed.', 'err');
    return;
  }
  if (status === 'pending') {
    _saveData();
    _showSuccessBox('Stored in Contract Pending', 'Contract is marked as pending for <strong>' + esc(curCandidate.name) + '</strong>.');
    showToast(curCandidate.name + ' stored in Contract Pending.', 'ok');
    renderAllTables(); renderKPIs(); updateSidebarCounts();
    return;
  }
  curCandidate.stage = 'training';
  curCandidate.trainingProgress = curCandidate.trainingProgress || [];
  _saveData();
  currentStep = 4;
  _openModal(curCandidate.name + ' — Training', 'Step 4: Training', true);
  _renderStepsBar();
  renderTrainingStepModal();
  renderAllTables(); renderKPIs(); updateSidebarCounts();
}

// ── TRAINING STEP MODAL ───────────────────────────────
function openTrainingModal(id) {
  const c = PIPELINE.find(x => x.id === id); if (!c) return;
  curCandidate = c; stepData = { ...c }; currentStep = 4;
  _openModal(c.name + ' — Training Stages', 'Update training progress', true);
  _renderStepsBar();
  renderTrainingStepModal();
}

function renderTrainingStepModal() {
  const c = curCandidate;
  const done = c.trainingProgress || [];
  const stageItems = TRAINING_STAGES.map((s, i) => {
    const isDone = done.includes(s);
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;background:${isDone?'var(--suc-bg)':'var(--bg-role)'};border:1.5px solid ${isDone?'var(--suc-bdr)':'var(--border-div)'};margin-bottom:8px;">
      <div style="width:26px;height:26px;border-radius:50%;background:${isDone?'var(--suc-bdr)':'var(--border-btn)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;color:#fff;font-weight:700;">${isDone?'✓':(i+1)}</div>
      <div style="flex:1;font-size:13px;font-weight:600;color:var(--dark-blue);">${esc(s)}</div>
      ${isDone
        ? `<span style="font-size:11px;font-weight:700;color:var(--suc);">Completed</span>`
        : `<button class="btn btn-teal btn-sm" onclick="markTrainingStage('${s}')">Mark Done</button>`}
    </div>`;
  }).join('');
  const allDone = done.length >= TRAINING_STAGES.length;
  document.getElementById('mod-body').innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-size:13px;font-weight:700;color:var(--dark-blue);margin-bottom:4px;">${esc(c.name)} — Training Progress</div>
      <div style="font-size:11px;color:var(--text-muted);">${done.length}/${TRAINING_STAGES.length} stages completed</div>
    </div>
    ${stageItems}
    ${allDone ? `<div style="background:var(--suc-bg);border:1.5px solid var(--suc-bdr);border-radius:10px;padding:14px;text-align:center;margin-top:16px;">
      <div style="font-size:14px;font-weight:700;color:var(--suc);">All Stages Complete!</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Ready to move to Placement Follow-up</div>
    </div>` : ''}`;
  document.getElementById('mod-ft').innerHTML = allDone
    ? `<button class="btn btn-outline" onclick="finalCloseModal()">Close</button>
       <button class="btn btn-green" onclick="moveToPlacementFollowupFromModal()">Move to Placement</button>`
    : `<button class="btn btn-outline" onclick="finalCloseModal()">Close</button>`;
}

function markTrainingStage(stage) {
  if (!curCandidate.trainingProgress) curCandidate.trainingProgress = [];
  if (!curCandidate.trainingProgress.includes(stage)) {
    curCandidate.trainingProgress.push(stage);
    _saveData();
    showToast(stage + ' marked as complete!', 'ok');
  }
  renderTrainingStepModal();
  renderAllTables(); renderKPIs(); updateSidebarCounts();
}

function moveToPlacementFollowupFromModal() {
  moveToPlacementFollowup(curCandidate.id);
  finalCloseModal();
}

function moveToPlacementFollowup(id) {
  const c = PIPELINE.find(x => x.id === id); if (!c) return;
  if ((c.trainingProgress||[]).length < TRAINING_STAGES.length) {
    showToast('Complete all 7 training stages first.', 'err');
    return;
  }
  c.stage = 'placement_followup';
  c.joinedDate = c.joinedDate || getAutoDateTime().isoDate;
  _saveData();
  renderAllTables(); renderKPIs(); updateSidebarCounts(); renderPlacedSidebar();
  showToast(c.name + ' moved to Placement Follow-up!', 'ok');
}

function renderPipelineStep() {
  switch (curCandidate?.stage) {
    case 'bgv':      currentStep=1; _renderStepsBar(); renderBGVStep();           break;
    case 'payment':  currentStep=2; _renderStepsBar(); renderPaymentStep();       break;
    case 'contract': currentStep=3; _renderStepsBar(); renderContractStep();      break;
    case 'training': currentStep=4; _renderStepsBar(); renderTrainingStepModal(); break;
    default:         currentStep=1; _renderStepsBar(); renderBGVStep();
  }
}

// ── PLACEMENT FOLLOWUP VIEW ───────────────────────────
function renderPlacementFollowupTable() {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-placement-followup').classList.add('active');

  const tb = document.getElementById('placement-followup-tbody');
  if (!PLACEMENT_FOLLOWUP.length) {
    tb.innerHTML = '<tr><td colspan="8"><div class="empty"><p>No candidates in placement follow-up yet.</p></div></td></tr>';
    return;
  }
  tb.innerHTML = PLACEMENT_FOLLOWUP.map((c, i) => {
    const history = c.interviewHistory || [];
    const historyBtn = history.length
      ? `<button class="btn btn-outline btn-sm" onclick="openInterviewHistory('${c.id}')">${history.length} Record${history.length>1?'s':''}</button>`
      : '<span style="color:var(--text-muted);font-size:11px;">No history</span>';
    return `<tr>
      <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
      <td><div style="display:flex;align-items:center;gap:10px;">${_candAvatar(c, 32)}<strong>${esc(c.name)}</strong></div></td>
      <td style="font-size:12px;">${esc(c.contact)}</td>
      <td><span class="badge b-teal">${esc(c.country||'—')}</span></td>
      <td style="font-size:12px;">${c.expectedSalary?'Rs. '+esc(c.expectedSalary):'—'}</td>
      <td style="font-size:12px;">${esc(c.qualification||'—')}</td>
      <td>${historyBtn}</td>
      <td><button class="btn btn-teal btn-sm" onclick="openPlacementInterview('${c.id}')">Schedule Interview</button></td>
    </tr>`;
  }).join('');
}

// ── PLACEMENT INTERVIEW MODAL ─────────────────────────
function openPlacementInterview(id) {
  const c = PIPELINE.find(x => x.id === id); if (!c) return;
  curCandidate = c;
  document.getElementById('placement-interview-overlay').classList.add('open');
  document.getElementById('pi-ttl').textContent = c.name + ' — Placement Interview';
  document.getElementById('pi-sub').textContent = (c.country||'') + ' · ' + (c.expectedSalary ? 'Rs. ' + c.expectedSalary : 'Salary not specified');
  renderPlacementInterviewForm(c);
}

function closePlacementInterviewModal() {
  document.getElementById('placement-interview-overlay').classList.remove('open');
  curCandidate = null;
}

function renderPlacementInterviewForm(c) {
  const photoContent = c.photo
    ? `<img src="${esc(c.photo)}" alt="${esc(c.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" onerror="this.style.display='none';this.parentNode.innerHTML='<span style=\'font-size:28px;font-weight:700;color:#fff;\'>${esc(c.name.charAt(0))}</span>';"/>`
    : `<span style="font-size:28px;font-weight:700;color:#fff;">${esc(c.name.charAt(0))}</span>`;

  const companyOptions = CLIENT_COMPANIES.length
    ? CLIENT_COMPANIES.map(co =>
        `<option value="${esc(co.name)}">${esc(co.name)}${co.type ? ' ('+esc(co.type)+')' : ''}</option>`
      ).join('')
    : '<option value="">No companies added yet</option>';

  document.getElementById('pi-body').innerHTML = `
    <div class="cand-profile-card">
      <div class="cand-profile-photo" style="display:flex;align-items:center;justify-content:center;">${photoContent}</div>
      <div class="cand-profile-info">
        <div class="cand-profile-name">${esc(c.name)}</div>
        <div class="cand-profile-meta">
          <div class="cand-meta-item"><span class="cand-meta-label">Enrollment</span>${esc(c.enrollmentNo||'—')}</div>
          <div class="cand-meta-item"><span class="cand-meta-label">Country</span>${esc(c.country||'—')}</div>
          <div class="cand-meta-item"><span class="cand-meta-label">Contact</span>${esc(c.contact)}</div>
          <div class="cand-meta-item"><span class="cand-meta-label">Qualification</span>${esc(c.qualification||'—')}</div>
        </div>
      </div>
    </div>
    <div class="alert-strip" id="pi-alert"></div>
    <div class="f-grid" style="gap:14px;">
      <div class="f-grp full">
        <label>Company Name <span class="req">*</span></label>
        <select id="pi-company" style="width:100%;padding:9px 12px;border:1.5px solid var(--border-inp);border-radius:8px;font-size:13px;">
          <option value="">— Select Company —</option>
          ${companyOptions}
          <option value="__other__">Other (type below)</option>
        </select>
      </div>
      <div class="f-grp full" id="pi-company-other-wrap" style="display:none;">
        <label>Company Name (Other)</label>
        <input type="text" id="pi-company-other" placeholder="Enter company name"/>
      </div>
      <div class="f-grp"><label>Interview Date <span class="req">*</span></label><input type="date" id="pi-date"/></div>
      <div class="f-grp"><label>Interview Time <span class="req">*</span></label><input type="time" id="pi-time"/></div>
      <div class="f-grp full"><label>Mode of Interview <span class="req">*</span></label>
        <select id="pi-mode">
          <option value="">-- Select Mode --</option>
          <option value="In Person">In Person</option>
          <option value="Video Call">Video Call</option>
          <option value="Phone Call">Phone Call</option>
          <option value="Online Test">Online Test</option>
        </select>
      </div>
      <div class="f-grp full"><label>Interview Outcome <span class="req">*</span></label>
        <select id="pi-stage-outcome">
          <option value="">-- Select Outcome --</option>
          <option value="Selected">Selected</option>
          <option value="Rejected">Rejected</option>
          <option value="Waiting for Next Round">Waiting for Next Round</option>
          <option value="On Hold">On Hold</option>
        </select>
      </div>
    </div>`;

  setTimeout(() => {
    const compSel = document.getElementById('pi-company');
    if (compSel) {
      compSel.onchange = () => {
        const otherWrap = document.getElementById('pi-company-other-wrap');
        if (otherWrap) otherWrap.style.display = compSel.value === '__other__' ? '' : 'none';
      };
    }
  }, 50);

  document.getElementById('pi-ft').innerHTML = `
    <button class="btn btn-outline" onclick="closePlacementInterviewModal()">Cancel</button>
    <button class="btn btn-teal" onclick="submitPlacementInterview()">Save Interview</button>`;
}

function submitPlacementInterview() {
  let company = val('pi-company');
  if (company === '__other__') company = val('pi-company-other');
  const date = val('pi-date'), time = val('pi-time');
  const mode = val('pi-mode'), outcome = val('pi-stage-outcome');
  if (!company) { showPIAlert('Please select or enter company name.', 'err'); return; }
  if (!date)    { showPIAlert('Please select interview date.', 'err'); return; }
  if (!time)    { showPIAlert('Please select interview time.', 'err'); return; }
  if (!mode)    { showPIAlert('Please select interview mode.', 'err'); return; }
  if (!outcome) { showPIAlert('Please select interview outcome.', 'err'); return; }

  const dt = getAutoDateTime();
  const [hh, mm] = time.split(':');
  const hNum = parseInt(hh,10);
  const ap12 = hNum >= 12 ? 'PM' : 'AM';
  const h12  = hNum % 12 || 12;
  const timeDisplay = pad(h12) + ':' + mm + ' ' + ap12;

  const record = { company, date, time: timeDisplay, mode, outcome, recordedAt: dt.readableDate + ' ' + dt.readableTime };

  if (!curCandidate.interviewHistory) curCandidate.interviewHistory = [];
  curCandidate.interviewHistory.push(record);
  INTERVIEW_HISTORY.push({ candidateId: curCandidate.id, candidateName: curCandidate.name, ...record });

  const savedName = curCandidate.name;
  if (outcome === 'Selected') {
    curCandidate.stage         = 'placed';
    curCandidate.placedCompany = company;
    curCandidate.placedDate    = date;
    _saveData();
    closePlacementInterviewModal();
    renderAllTables(); renderKPIs(); updateSidebarCounts(); renderPlacedSidebar();
    showToast(savedName + ' has been Placed at ' + company + '!', 'ok');
    curCandidate = null;
  } else {
    _saveData();
    closePlacementInterviewModal();
    curCandidate = null;
    renderPlacementFollowupTable();
    renderScheduledTable();
    renderKPIs(); updateSidebarCounts();
    showToast('Interview record saved for ' + savedName + '.', 'ok');
  }
}

function showPIAlert(msg, type) {
  const el = document.getElementById('pi-alert'); if (!el) return;
  el.textContent = msg; el.className = 'alert-strip ' + type + ' show';
  setTimeout(() => el.classList.remove('show'), 4000);
}

// ── INTERVIEW HISTORY POPUP ───────────────────────────
function openInterviewHistory(id) {
  const c = PIPELINE.find(x => x.id === id); if (!c) return;
  const history = c.interviewHistory || [];
  const overlay = document.createElement('div');
  overlay.id = 'history-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(22,46,90,.6);backdrop-filter:blur(4px);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px;';
  const rows = history.map((h, i) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid var(--border-div);font-size:12px;color:var(--text-muted);">${i+1}</td>
      <td style="padding:10px 12px;border-bottom:1px solid var(--border-div);font-size:13px;font-weight:600;">${esc(h.company)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid var(--border-div);font-size:12px;">${esc(h.date)} ${esc(h.time)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid var(--border-div);font-size:12px;">${esc(h.mode)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid var(--border-div);">
        <span class="badge ${h.outcome==='Selected'?'b-green':h.outcome==='Rejected'?'b-red':'b-blue'}">${esc(h.outcome)}</span>
      </td>
    </tr>`).join('');
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:720px;max-width:98vw;max-height:90vh;box-shadow:0 24px 80px rgba(22,46,90,.4);overflow:hidden;display:flex;flex-direction:column;">
      <div style="background:linear-gradient(135deg,var(--dark-blue),var(--mid-blue));padding:18px 24px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div><div style="font-size:16px;font-weight:700;color:#fff;">${esc(c.name)} — Interview History</div>
        <div style="font-size:11px;color:rgba(255,255,255,.6);">${history.length} record(s)</div></div>
        <button onclick="document.getElementById('history-overlay').remove();" style="width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;font-size:18px;cursor:pointer;">✕</button>
      </div>
      <div style="flex:1;overflow-y:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--bg-role);">
            <th style="padding:10px 12px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-tag);text-align:left;">SNO</th>
            <th style="padding:10px 12px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-tag);text-align:left;">Company</th>
            <th style="padding:10px 12px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-tag);text-align:left;">Date & Time</th>
            <th style="padding:10px 12px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-tag);text-align:left;">Mode</th>
            <th style="padding:10px 12px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-tag);text-align:left;">Outcome</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted);">No history yet.</td></tr>'}</tbody>
        </table>
      </div>
      <div style="padding:14px 24px;border-top:1px solid var(--border-div);display:flex;justify-content:flex-end;">
        <button onclick="document.getElementById('history-overlay').remove();" class="btn btn-outline">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

// ── ADD CANDIDATE MODAL ───────────────────────────────
let _addPhotoDataUrl = '';

function openAddCandidateModal() {
  _addPhotoDataUrl = '';
  document.getElementById('mod-ttl').textContent = 'Add New Candidate';
  document.getElementById('mod-sub').textContent = 'Register a new candidate into the pipeline';
  document.getElementById('steps-bar').innerHTML = '';
  document.getElementById('mod-overlay').classList.add('open');

  const countries = ['UAE','Saudi Arabia','Qatar','Kuwait','Bahrain','Oman','Singapore','Malaysia','Canada','Australia','UK','Germany','USA','New Zealand','Japan','South Korea','Other'];
  const countryOpts = countries.map(c => `<option value="${c}">${c}</option>`).join('');

  document.getElementById('mod-body').innerHTML = `
    <div class="alert-strip" id="step-alert"></div>
    <div class="f-grid">
      <div class="f-grp"><label>Full Name <span class="req">*</span></label><input type="text" id="add-name" placeholder="e.g. Arun Kumar"/></div>
      <div class="f-grp"><label>Contact Number <span class="req">*</span></label><input type="text" id="add-contact" placeholder="e.g. 9876543210"/></div>
      <div class="f-grp"><label>Email Address</label><input type="email" id="add-email" placeholder="e.g. arun@email.com"/></div>
      <div class="f-grp"><label>Country <span class="req">*</span></label>
        <select id="add-country"><option value="">-- Select Country --</option>${countryOpts}</select>
      </div>
      <div class="f-grp"><label>Qualification</label><input type="text" id="add-qual" placeholder="e.g. B.E. Mechanical"/></div>
      <div class="f-grp"><label>Experience</label><input type="text" id="add-exp" placeholder="e.g. 2 Years / Fresher"/></div>
      <div class="f-grp"><label>Expected Salary (Rs.)</label><input type="number" id="add-salary" placeholder="e.g. 30000"/></div>
      <div class="f-grp"><label>Candidate Photo</label><input type="file" id="add-photo" accept="image/*" onchange="previewAddPhoto(this)"/></div>
      <div class="f-grp" style="align-items:center;justify-content:center;"><label>Preview</label>
        <div id="add-photo-preview" style="width:56px;height:56px;border-radius:50%;background:var(--bg-role);border:2px dashed var(--border-btn);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text-muted);overflow:hidden;">No photo</div>
      </div>
    </div>`;
  document.getElementById('mod-ft').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-teal" onclick="submitAddCandidate()">Add Candidate</button>`;
}

function previewAddPhoto(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    _addPhotoDataUrl = e.target.result;
    const preview = document.getElementById('add-photo-preview');
    if (preview) preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  };
  reader.readAsDataURL(file);
}

function submitAddCandidate() {
  const name    = val('add-name');
  const contact = val('add-contact');
  const country = val('add-country');
  if (!name)    { showAlert('Please enter candidate name.', 'err');   return; }
  if (!contact) { showAlert('Please enter contact number.', 'err');   return; }
  if (!country) { showAlert('Please select country.', 'err');         return; }
  if (PIPELINE.find(c => c.contact === contact)) {
    showAlert('A candidate with this contact number already exists.', 'err'); return;
  }
  const dt = getAutoDateTime();
  PIPELINE.push({
    id: 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2,5),
    name, contact, email: val('add-email'),
    photo: _addPhotoDataUrl || '',
    country, qualification: val('add-qual'), experience: val('add-exp'),
    expectedSalary: val('add-salary'),
    joinedDate: dt.isoDate,
    submittedDate: dt.readableDate,
    submittedTime: dt.readableTime,
    interviewer: 'Ramya',
    stage: 'registered', bgvDocs: {}, bgvStatus: '',
    contractNotes: [], contractStatus: '', paymentStatus: '',
    paymentAmount: '', paymentDate: '',
    trainingProgress: [], interviewHistory: [], notes: []
  });
  _addPhotoDataUrl = '';
  _saveData();
  finalCloseModal();
  showToast(name + ' added successfully!', 'ok');
}

// ── SUCCESS BOX ───────────────────────────────────────
function _showSuccessBox(title, subHtml) {
  document.getElementById('mod-body').innerHTML = `
    <div class="success-box">
      <div class="success-icon">✓</div>
      <div class="success-ttl">${esc(title)}</div>
      <div class="success-sub">${subHtml}</div>
    </div>`;
  document.getElementById('steps-bar').innerHTML = '';
  document.getElementById('mod-ft').innerHTML = `<button class="btn btn-teal" onclick="finalCloseModal()">Done</button>`;
}

// ── LOGOUT ────────────────────────────────────────────
function logoutUser() {
  fetch('/api/attendance/logout', { method: 'POST', headers: { 'x-session-token': getToken() } }).catch(() => {});
  fetch('/api/attendance/logout', { method: 'POST', headers: { 'x-session-token': getToken() } }).catch(()=>{}); fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'x-session-token': getToken() }
  }).catch(() => {});
  sessionStorage.clear();
  showToast('Logging out...', 'ok');
  setTimeout(() => { window.location.href = 'login.html'; }, 800);
}

// ── HELPERS ───────────────────────────────────────────
function showAlert(msg, type) {
  const el = document.getElementById('step-alert'); if (!el) return;
  el.textContent = msg; el.className = 'alert-strip ' + type + ' show';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => el.classList.remove('show'), 4000);
}
function showToast(msg, type) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}