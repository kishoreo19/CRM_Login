// =====================================================
// THE GOJOBSYNC — interview_persistence_patch.js  (v4)
// KEY FIX: capture curCandidate.id and stepData snapshot
//          BEFORE calling _origSubmitToHR (which clears them)
// Also loads all data from DB on page load so counts are
// always correct after refresh.
// =====================================================

const SK = {
  PLACEMENT:        'jobsync_placement_list',
  PAYMENT_PENDING:  'jobsync_payment_pending',
  REG_PENDING:      'jobsync_reg_pending',
  FOLLOWUP_NOTES:   'jobsync_followup_notes',
  CAND_PROGRESS:    'jobsync_candidate_progress',
  TOTAL_SCHEDULED:  'jobsync_total_scheduled',
  INTERVIEWS_TAKEN: 'jobsync_interviews_taken',
  CONVERSIONS:      'jobsync_conversions',
  ATTENDANCE:       'attendance_ramya',
};

function _storeSave(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
}
function _storeLoad(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
  catch(e) { return fallback; }
}
function _token() { return sessionStorage.getItem('crm_token') || ''; }

async function _api(method, url, body) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json', 'x-session-token': _token() } };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(url, opts);
    const data = await res.json();
    return data;
  } catch(e) {
    console.error('API error:', method, url, e);
    return { success: false, error: e.message };
  }
}

// ── ATTENDANCE ────────────────────────────────────────
async function markAttendance() {
  const today = new Date().toISOString().split('T')[0];
  const badge = document.getElementById('sb-att-badge');
  if (badge) badge.style.display = 'inline-flex';
  const already = _storeLoad(SK.ATTENDANCE, null);
  if (already === today) return;
  const res = await _api('POST', '/api/attendance/mark', {});
  if (res.success) {
    _storeSave(SK.ATTENDANCE, today);
    setTimeout(() => showToast('✅ Attendance marked — ' + new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}), 'ok'), 1500);
  }
}

// ── BREAK SYSTEM ──────────────────────────────────────
let __breakActive = false, __breakInterval = null, __breakId = null;

function startTopbarBreak(type) {
  if (__breakActive) { showToast('⚠️ A break is already running — it cannot be stopped.', 'err'); return; }
  const mins = type === 'short' ? 15 : 30;
  const label = type === 'short' ? '☕ Short Break' : '🍽️ Lunch Break';
  __breakActive = true;
  let secs = mins * 60;
  const shortBtn = document.getElementById('topbar-break-short');
  const lunchBtn = document.getElementById('topbar-break-lunch');
  const timerEl  = document.getElementById('topbar-break-timer');
  const timerWrap= document.getElementById('topbar-break-display');
  const labelEl  = document.getElementById('topbar-break-label');
  if (shortBtn)  { shortBtn.disabled = true; shortBtn.style.opacity = '0.4'; shortBtn.style.cursor = 'not-allowed'; }
  if (lunchBtn)  { lunchBtn.disabled = true; lunchBtn.style.opacity = '0.4'; lunchBtn.style.cursor = 'not-allowed'; }
  if (timerWrap) timerWrap.style.display = 'flex';
  if (labelEl)   labelEl.textContent = label;
  if (timerEl)   timerEl.textContent  = String(Math.floor(secs/60)).padStart(2,'0') + ':00';
  _api('POST', '/api/attendance/break/start', { breakType: type }).then(r => { if (r.success) __breakId = r.breakId; });
  __breakInterval = setInterval(() => {
    secs--;
    const mm = Math.floor(secs/60), ss = secs % 60;
    if (timerEl) timerEl.textContent = String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0');
    if (secs <= 0) {
      clearInterval(__breakInterval); __breakActive = false;
      if (__breakId) _api('POST', '/api/attendance/break/end', { breakId: __breakId });
      __breakId = null;
      if (timerWrap) timerWrap.style.display = 'none';
      if (shortBtn) { shortBtn.disabled = false; shortBtn.style.opacity='1'; shortBtn.style.cursor='pointer'; }
      if (lunchBtn) { lunchBtn.disabled = false; lunchBtn.style.opacity='1'; lunchBtn.style.cursor='pointer'; }
      showToast('✅ Break ended. Welcome back, Ramya!', 'ok');
    }
  }, 1000);
  showToast(label + ' started — ' + mins + ' min. Cannot be stopped.', 'ok');
}

// ── LOGOUT ────────────────────────────────────────────
async function logoutRamya() {
  await _api('POST', '/api/attendance/logout', {});
  saveAllState();
  showToast('Logging out...', 'ok');
  setTimeout(() => { window.location.href = '/login.html'; }, 900);
}

// ── STATE HELPERS ─────────────────────────────────────
function saveAllState() {
  _storeSave(SK.PLACEMENT,        PLACEMENT_LIST);
  _storeSave(SK.PAYMENT_PENDING,  PAYMENT_PENDING_LIST);
  _storeSave(SK.REG_PENDING,      REG_PENDING_LIST);
  _storeSave(SK.FOLLOWUP_NOTES,   FOLLOWUP_NOTES);
  _storeSave(SK.CAND_PROGRESS,    CANDIDATE_PROGRESS);
  _storeSave(SK.INTERVIEWS_TAKEN, totalInterviewsTaken);
  _storeSave(SK.CONVERSIONS,      totalConversions);
  _storeSave(SK.TOTAL_SCHEDULED,  Math.max(getCumulativeTotal(), _storeLoad(SK.TOTAL_SCHEDULED, 0)));
}

function restoreAllState() {
  _storeLoad(SK.PLACEMENT, []).forEach(p => { if (!PLACEMENT_LIST.find(x => x.contact===p.contact && x.name===p.name)) PLACEMENT_LIST.push(p); });
  _storeLoad(SK.PAYMENT_PENDING, []).forEach(p => { if (!PAYMENT_PENDING_LIST.find(x => x.contact===p.contact && x.name===p.name)) PAYMENT_PENDING_LIST.push(p); });
  _storeLoad(SK.REG_PENDING, []).forEach(p => { if (!REG_PENDING_LIST.find(x => x.contact===p.contact && x.name===p.name)) REG_PENDING_LIST.push(p); });
  const fn = _storeLoad(SK.FOLLOWUP_NOTES, {});
  Object.keys(fn).forEach(id => {
    if (!FOLLOWUP_NOTES[id]) FOLLOWUP_NOTES[id] = [];
    fn[id].forEach(note => { if (!FOLLOWUP_NOTES[id].find(n => n.date===note.date && n.time===note.time && n.note===note.note)) FOLLOWUP_NOTES[id].push(note); });
  });
  const cp = _storeLoad(SK.CAND_PROGRESS, {});
  Object.keys(cp).forEach(id => { if (!CANDIDATE_PROGRESS[id]) CANDIDATE_PROGRESS[id] = cp[id]; });
  const taken = _storeLoad(SK.INTERVIEWS_TAKEN, 0);
  const conv  = _storeLoad(SK.CONVERSIONS, 0);
  if (taken > totalInterviewsTaken) totalInterviewsTaken = taken;
  if (conv  > totalConversions)     totalConversions     = conv;
}

// ── LOAD ALL FROM DB ──────────────────────────────────
async function _loadAllFromDB() {
  try {
    const res = await fetch('/api/candidates', { headers: { 'x-session-token': _token() } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const allRows = data.candidates || [];

    allRows.filter(r => r.status === 'payment_pending').forEach(r => {
      if (!PAYMENT_PENDING_LIST.find(x => x.contact===r.contact && x.name===r.name)) {
        PAYMENT_PENDING_LIST.push({ name:r.name||'', contact:r.contact||'', email:r.email||'', qual:r.qual||'—', exp:r.expType||'—', recruiter:r.recruiter_name||'—', preferredCountry:r.preferred_country||'—', candidateId:r.id });
      }
    });

    allRows.filter(r => r.status === 'reg_pending').forEach(r => {
      if (!REG_PENDING_LIST.find(x => x.contact===r.contact && x.name===r.name)) {
        REG_PENDING_LIST.push({ name:r.name||'', contact:r.contact||'', email:r.email||'', qual:r.qual||'—', exp:r.expType||'—', recruiter:r.recruiter_name||'—', preferredCountry:r.preferred_country||'—', candidateId:r.id });
      }
    });

    allRows.filter(r => ['submitted','placement','placed'].includes(r.status)).forEach(r => {
      if (!PLACEMENT_LIST.find(x => x.contact===r.contact && x.name===r.name)) {
        const edu = Array.isArray(r.edu_json) ? r.edu_json : [];
        const exp = Array.isArray(r.exp_json) ? r.exp_json : [];
        const ref = Array.isArray(r.ref_json) ? r.ref_json : [];
        const sd = {
          name:r.name||'', contact:r.contact||'', email:r.email||'', qual:r.qual||'', exp:r.expType||'',
          preferredCountry:r.preferred_country||'', enrlNo:r.enrollment_no||'',
          paymentMode:r.payment_mode||'', paymentDone:'yes', payAmount:r.payment_amount||'',
          payDate: r.payment_date ? r.payment_date.split('T')[0] : '',
          payMethod:r.payment_method||'', payRemarks:r.payment_remarks||'',
          _payProofDataUrl:r.payment_proof_url||'', _payProofUploadDT:r.payment_proof_dt||'',
          _photoDataUrl:r.ef_photo_data||'', _sigData:r.signature_data||'', _hasSig:!!r.signature_data,
          ef_name:r.name||'', ef_father:r.father_name||'', ef_mother:r.mother_name||'',
          ef_dob: r.dob ? r.dob.split('T')[0] : '', ef_sex:r.gender||'', ef_marital:r.marital_status||'',
          ef_contact:r.contact||'', ef_email:r.email||'',
          ef_addrPresent:r.address_present||'', ef_addrPerm:r.address_permanent||'',
          ef_addQual:r.add_qual||'', ef_nationality:r.nationality||'Indian',
          ef_aadhaar:r.aadhaar||'', ef_emergency:r.emergency_contact||'',
          ef_passport:r.passport_no||'', ef_passportInfo:r.passport_info||'',
          ef_reason:r.reason_relocation||'', ef_place:r.ef_place||'',
          selected:'yes', regStatus:'done', _chkUnderstood:true, _chkFeeNonRefundable:true,
        };
        edu.forEach((e,i) => { const n=i+1; sd['ef_edu_deg_'+n]=e.deg||''; sd['ef_edu_sub_'+n]=e.sub||''; sd['ef_edu_inst_'+n]=e.inst||''; sd['ef_edu_yr_'+n]=e.yr||''; sd['ef_edu_marks_'+n]=e.marks||''; sd['ef_edu_dur_'+n]=e.dur||''; });
        exp.forEach((e,i) => { const n=i+1; sd['ef_exp_co_'+n]=e.co||''; sd['ef_exp_dur_'+n]=e.dur||''; sd['ef_exp_des_'+n]=e.des||''; sd['ef_exp_hr_'+n]=e.hr||''; sd['ef_exp_sal_'+n]=e.sal||''; sd['ef_exp_rsn_'+n]=e.rsn||''; });
        ref.forEach((e,i) => { const n=i+1; sd['ef_ref_name_'+n]=e.name||''; sd['ef_ref_qual_'+n]=e.qual||''; sd['ef_ref_cont_'+n]=e.cont||''; });
        PLACEMENT_LIST.push({
          name:r.name||'', contact:r.contact||'', email:r.email||'',
          country:r.preferred_country||'—', recruiter:r.recruiter_name||'—',
          payMode:r.payment_mode||'', payAmount:r.payment_amount||'',
          enrlNo:r.enrollment_no||'—', submittedDate:r.submitted_date||'', submittedTime:r.submitted_time||'',
          candidateId:r.id, stepData:sd
        });
      }
    });

    const submittedCount = allRows.filter(r => ['submitted','placement','placed'].includes(r.status)).length;
    if (submittedCount > totalConversions)  { totalConversions = submittedCount; _storeSave(SK.CONVERSIONS, totalConversions); }
    const takenCount = allRows.filter(r => r.status !== 'fresh').length;
    if (takenCount > totalInterviewsTaken) { totalInterviewsTaken = takenCount; _storeSave(SK.INTERVIEWS_TAKEN, totalInterviewsTaken); }

  } catch(e) {
    console.warn('_loadAllFromDB failed, using localStorage:', e.message);
    restoreAllState();
  }
}

function getCumulativeTotal() {
  const scheduled = (CANDIDATES.soundariya||[]).filter(c=>c.status==='scheduled').length + (CANDIDATES.tharshini||[]).filter(c=>c.status==='scheduled').length;
  return Math.max(scheduled + PLACEMENT_LIST.length + PAYMENT_PENDING_LIST.length + REG_PENDING_LIST.length, _storeLoad(SK.TOTAL_SCHEDULED, 0));
}

// ── DROPDOWN / NAV HELPERS ────────────────────────────
const dropdownState = { rec: false, followup: false };
function toggleDropdown(key) {
  dropdownState[key] = !dropdownState[key];
  document.getElementById('sb-'+key+'-toggle').classList.toggle('open', dropdownState[key]);
  document.getElementById('sb-'+key+'-items').classList.toggle('open',  dropdownState[key]);
}
function ensureDropdownOpen(key) { if (!dropdownState[key]) toggleDropdown(key); }

function openFollowupTab(tab) {
  document.getElementById('nav-dashboard').classList.add('active');
  document.querySelectorAll('.sb-recruiter-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sb-followup-item').forEach(el => el.classList.remove('active'));
  const navMap = { payment:'nav-pay-pending', regpending:'nav-reg-pending', notes:'nav-notes' };
  const navEl = document.getElementById(navMap[tab]); if (navEl) navEl.classList.add('active');
  document.getElementById('view-dashboard').classList.add('active');
  document.getElementById('view-recruiter').classList.remove('active');
  renderPaymentPendingTable(); renderRegPendingTable(); renderDashboardNotesTable(); renderKPIs();
  document.querySelectorAll('.dash-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  const tabIdx = { payment:0, regpending:1, notes:2 };
  const tabs = document.querySelectorAll('.dash-tab');
  if (tabs[tabIdx[tab]]) tabs[tabIdx[tab]].classList.add('active');
  const secEl = document.getElementById({ payment:'dsec-payment', regpending:'dsec-regpending', notes:'dsec-notes' }[tab]);
  if (secEl) secEl.classList.add('active');
}

function switchDashTab(el, tab) {
  document.querySelectorAll('.dash-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  document.getElementById('dsec-'+tab).classList.add('active');
  document.querySelectorAll('.sb-followup-item').forEach(e => e.classList.remove('active'));
  const navEl = document.getElementById({ payment:'nav-pay-pending', regpending:'nav-reg-pending', notes:'nav-notes' }[tab]);
  if (navEl) navEl.classList.add('active');
  if (tab === 'notes')        renderDashboardNotesTable();
  if (tab === 'placement')    renderPlacementTable();
  if (tab === 'mycandidates') renderMyCandidatesTable();
}

// ── PLACEMENT TABLES ──────────────────────────────────
function renderPlacementTable() {
  const tb = document.getElementById('placement-tbody'); if (!tb) return;
  if (!PLACEMENT_LIST.length) { tb.innerHTML = '<tr><td colspan="12"><div class="empty"><p>No candidates submitted to HR yet.</p></div></td></tr>'; return; }
  tb.innerHTML = PLACEMENT_LIST.map((p,i) => `<tr>
    <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
    <td><strong>${esc(p.name)}</strong></td><td>${esc(p.contact)}</td>
    <td style="color:var(--text-tag);">${esc(p.email||'—')}</td><td>${esc(p.recruiter)}</td>
    <td><span class="badge b-teal">${esc(p.country)}</span></td>
    <td>${p.payMode==='cash'?'💵 Cash':'📱 Online'}</td>
    <td style="font-weight:700;">₹${esc(p.payAmount||'—')}</td><td>${esc(p.enrlNo||'—')}</td>
    <td style="font-size:11px;"><div style="color:var(--teal);font-weight:700;">📅 ${esc(p.submittedDate||'')}</div><div style="color:#6c3fc1;font-weight:600;">🕐 ${esc(p.submittedTime||'')}</div></td>
    <td><span class="badge b-green">✓ Verified & Placed</span></td>
    <td><button class="btn btn-outline btn-sm" onclick="openPlacementDoc(${i})">📄 View</button></td>
  </tr>`).join('');
  const cnt = document.getElementById('dtab-placement-cnt'); if (cnt) cnt.textContent = PLACEMENT_LIST.length;
}

function renderMyCandidatesTable() {
  const tb = document.getElementById('mycandidates-tbody'); if (!tb) return;
  if (!PLACEMENT_LIST.length) { tb.innerHTML = '<tr><td colspan="12"><div class="empty"><p>No candidates submitted yet.</p></div></td></tr>'; return; }
  tb.innerHTML = PLACEMENT_LIST.map((p,i) => `<tr>
    <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
    <td><div style="display:flex;align-items:center;gap:8px;"><div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--teal),var(--mid-blue));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;">${esc(p.name.charAt(0))}</div><strong>${esc(p.name)}</strong></div></td>
    <td>${esc(p.contact)}</td><td style="color:var(--text-tag);">${esc(p.email||'—')}</td>
    <td>${esc(p.recruiter)}</td><td><span class="badge b-teal">${esc(p.country)}</span></td>
    <td>${p.payMode==='cash'?'💵 Cash':'📱 Online'}</td>
    <td style="font-weight:700;color:var(--teal);">₹${esc(p.payAmount||'—')}</td><td>${esc(p.enrlNo||'—')}</td>
    <td style="font-size:11px;"><div style="color:var(--teal);font-weight:700;">📅 ${esc(p.submittedDate||'')}</div><div style="color:#6c3fc1;font-weight:600;">🕐 ${esc(p.submittedTime||'')}</div></td>
    <td><span class="badge b-green">✓ Verified & Placed</span></td>
    <td><button class="btn btn-outline btn-sm" onclick="openPlacementDoc(${i})">📄 View</button></td>
  </tr>`).join('');
  const cnt = document.getElementById('dtab-mycand-cnt'); if (cnt) cnt.textContent = PLACEMENT_LIST.length;
}

// ── MAIN INIT ─────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async function() {

  markAttendance();
  restoreAllState();          // fast local cache first
  await _loadAllFromDB();     // then accurate DB data

  setTimeout(() => {
    if (typeof renderKPIs                 === 'function') renderKPIs();
    if (typeof renderPaymentPendingTable  === 'function') renderPaymentPendingTable();
    if (typeof renderRegPendingTable      === 'function') renderRegPendingTable();
    if (typeof renderDashboardNotesTable  === 'function') renderDashboardNotesTable();
    if (typeof renderPlacementTable       === 'function') renderPlacementTable();
    if (typeof renderMyCandidatesTable    === 'function') renderMyCandidatesTable();
    if (typeof renderPlacementSidebar     === 'function') renderPlacementSidebar();
    if (typeof updateSidebarFollowupCounts === 'function') updateSidebarFollowupCounts();
    _updatePlacementCounts(); _updateNotesSidebarCount();
    const el = document.getElementById('k-total'); if (el) el.textContent = getCumulativeTotal();
    const kt = document.getElementById('k-interviews-taken'); if (kt) kt.textContent = totalInterviewsTaken;
    const kc = document.getElementById('k-conversions'); if (kc) kc.textContent = totalConversions;
    saveAllState();
  }, 400);

  // renderTable: only scheduled
  window.renderTable = function() {
    const data = (CANDIDATES[curRecruiter]||[]).filter(c => c.status === 'scheduled');
    const tb = document.getElementById('cand-tbody');
    if (!data.length) { tb.innerHTML = '<tr><td colspan="10"><div class="empty"><p>No scheduled candidates.</p></div></td></tr>'; return; }
    tb.innerHTML = data.map((c,i) => {
      const prog = CANDIDATE_PROGRESS[c.id];
      const actionBtn = prog
        ? `<button class="btn btn-teal btn-sm" onclick="resumeProceed(${c.id})">▶ Resume (Step ${prog.step})</button>`
        : `<button class="btn btn-dark btn-sm" onclick="openProceed(${c.id})">Proceed</button>`;
      const resumeBtn = c.resumeName ? `<button class="btn-resume-corner" onclick="previewResume(${c.id})">📄 PDF</button>` : `<span style="color:var(--text-muted);font-size:11px;">—</span>`;
      const notes = FOLLOWUP_NOTES[c.id]||[]; const lastNote = notes.length ? notes[notes.length-1] : null;
      const dtCell = lastNote ? `<div style="font-size:11px;"><div style="color:var(--teal);font-weight:700;">📅 ${esc(lastNote.date)}</div><div style="color:#6c3fc1;font-weight:600;">🕐 ${esc(lastNote.time)}</div></div>` : `<span style="color:var(--text-muted);font-size:11px;">—</span>`;
      return `<tr><td style="color:var(--text-muted);font-size:12px;">${i+1}</td><td><strong>${esc(c.name)}</strong></td><td>${esc(c.contact)}</td><td style="color:var(--text-tag);">${esc(c.email)}</td><td>${esc(c.qual)}</td><td>${esc(c.exp)}</td><td>${badge(c.status)}</td><td>${dtCell}</td><td>${resumeBtn}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap;">${actionBtn}</div></td></tr>`;
    }).join('');
  };

  // Notes tab fix
  const _origFN = window.openFollowupNotes;
  window.openFollowupNotes = function(id) {
    const saved = stepData ? stepData.preferredCountry : undefined;
    if (_origFN) _origFN(id);
    if (saved !== undefined && stepData) stepData.preferredCountry = saved;
  };

  // submitStep4 — Aadhaar NOT mandatory
  window.submitStep4 = function() {
    if (typeof collectFormFields === 'function') collectFormFields();
    const chk1 = document.getElementById('chk-understood');
    const chk2 = document.getElementById('chk-fee-nonrefundable');
    if (chk1) stepData._chkUnderstood      = chk1.checked;
    if (chk2) stepData._chkFeeNonRefundable = chk2.checked;
    if (!stepData.regStatus) { showAlert('Please select registration status.', 'err'); return; }
    if (stepData.regStatus === 'pending') { if (typeof _storeRegPending === 'function') _storeRegPending(); return; }
    const errors = []; const hi = (id, msg) => { const el = document.getElementById(id); if (el) el.style.borderColor='var(--err-bdr)'; errors.push(msg); };
    if (!stepData.ef_name)        hi('ef-name',        'Name is required');
    if (!stepData.ef_father)      hi('ef-father',      'Father name is required');
    if (!stepData.ef_mother)      hi('ef-mother',      'Mother name is required');
    if (!stepData.ef_dob)         hi('ef-dob',         'Date of birth is required');
    if (!stepData.ef_sex)         hi('ef-sex',         'Sex is required');
    if (!stepData.ef_contact || !/^\d{10}$/.test(stepData.ef_contact)) hi('ef-contact','Valid 10-digit contact is required');
    if (!stepData.ef_email || !stepData.ef_email.includes('@')) hi('ef-email','Valid email is required');
    if (!stepData.ef_addrPresent) hi('ef-addr-present','Present address is required');
    if (!stepData.ef_passport)    hi('ef-passport',    'Passport number is required');
    if (!stepData.ef_place)       hi('ef-place',       'Place is required');
    if (!stepData._chkUnderstood)       errors.push('Please tick the terms & conditions checkbox');
    if (!stepData._chkFeeNonRefundable) errors.push('Please tick the fee non-refundable checkbox');
    if (!stepData._hasSig)              errors.push('Candidate signature is required');
    if (errors.length > 0) { showAlert(errors[0], 'err'); return; }
    if (typeof _showRegistrationConfirmDialog === 'function') _showRegistrationConfirmDialog();
  };

  // Notes DB save
  window.addFollowupNote = function(id) {
    const note = (document.getElementById('fn-note')||{}).value?.trim()||'';
    if (!note) { showToast('Please enter a note.', 'err'); return; }
    const dt = typeof getAutoDateTime==='function' ? getAutoDateTime() : { readableDate:'', readableTime:'' };
    if (!FOLLOWUP_NOTES[id]) FOLLOWUP_NOTES[id] = [];
    FOLLOWUP_NOTES[id].push({ note, date:dt.readableDate, time:dt.readableTime });
    _api('POST', `/api/candidates/${id}/notes`, { note, note_date:dt.readableDate, note_time:dt.readableTime });
    showToast('Note added!', 'ok');
    if (typeof addActivity==='function') addActivity('noted', _getCandidateName(id), 'Follow-up note added');
    if (typeof openFollowupNotes==='function') openFollowupNotes(id);
    if (typeof renderTable==='function') renderTable();
    if (typeof renderDashboardNotesTable==='function') renderDashboardNotesTable();
    if (typeof _updateNotesSidebarCount==='function') _updateNotesSidebarCount();
    saveAllState();
  };

  window.quickAddNote = function(id) {
    const note = (document.getElementById('s1-fn-note')||{}).value?.trim()||'';
    if (!note) { showAlert('Please enter a note.', 'err'); return; }
    const dt = typeof getAutoDateTime==='function' ? getAutoDateTime() : { readableDate:'', readableTime:'' };
    if (!FOLLOWUP_NOTES[id]) FOLLOWUP_NOTES[id] = [];
    FOLLOWUP_NOTES[id].push({ note, date:dt.readableDate, time:dt.readableTime });
    _api('POST', `/api/candidates/${id}/notes`, { note, note_date:dt.readableDate, note_time:dt.readableTime });
    showToast('Note saved!', 'ok');
    if (typeof renderTable==='function') renderTable();
    if (typeof renderDashboardNotesTable==='function') renderDashboardNotesTable();
    if (typeof _updateNotesSidebarCount==='function') _updateNotesSidebarCount();
    if (typeof renderStep1==='function') renderStep1();
    saveAllState();
  };

  // ══════════════════════════════════════════════════════
  // ✅ THE KEY FIX: snapshot BEFORE _origSubmitToHR runs
  // ══════════════════════════════════════════════════════
  const _origSubmitToHR = window.submitToHR;
  window.submitToHR = async function() {

    // 1. Capture everything NOW before original clears curCandidate & stepData
    const candId        = curCandidate ? curCandidate.id : null;
    const snapStepData  = { ...stepData };
    const snapRecruiter = curRecruiter;
    const dt = typeof getCurrentDateTime==='function' ? getCurrentDateTime() : { date:'', time:'' };

    // 2. Run original (shows success box, calls finalCloseModal which nulls curCandidate)
    if (_origSubmitToHR) await _origSubmitToHR();

    // 3. Now save to DB using snapshot
    if (!candId) { showToast('⚠️ Missing candidate ID — DB not saved.', 'err'); return; }

    const edu = [1,2,3].map(n => ({ deg:snapStepData['ef_edu_deg_'+n]||'', sub:snapStepData['ef_edu_sub_'+n]||'', inst:snapStepData['ef_edu_inst_'+n]||'', yr:snapStepData['ef_edu_yr_'+n]||'', marks:snapStepData['ef_edu_marks_'+n]||'', dur:snapStepData['ef_edu_dur_'+n]||'' }));
    const exp = [1,2,3].map(n => ({ co:snapStepData['ef_exp_co_'+n]||'', dur:snapStepData['ef_exp_dur_'+n]||'', des:snapStepData['ef_exp_des_'+n]||'', hr:snapStepData['ef_exp_hr_'+n]||'', sal:snapStepData['ef_exp_sal_'+n]||'', rsn:snapStepData['ef_exp_rsn_'+n]||'' }));
    const ref = [1,2].map(n => ({ name:snapStepData['ef_ref_name_'+n]||'', qual:snapStepData['ef_ref_qual_'+n]||'', cont:snapStepData['ef_ref_cont_'+n]||'' }));

    const r = await _api('POST', `/api/candidates/${candId}/submit-to-hr`, {
      enrlNo:           snapStepData.enrlNo           || '',
      submittedDate:    dt.date,  submittedTime: dt.time,
      preferredCountry: snapStepData.preferredCountry || '',
      paymentMode:      snapStepData.paymentMode       || '',
      payAmount:        snapStepData.payAmount         || '',
      payDate:          snapStepData.payDate           || null,
      payReceipt:       snapStepData.payReceipt        || '',
      payTxn:           snapStepData.payTxn            || '',
      payMethod:        snapStepData.payMethod         || '',
      payRemarks:       snapStepData.payRemarks        || '',
      payProofUrl:      snapStepData._payProofDataUrl  || '',
      payProofDt:       snapStepData._payProofUploadDT || '',
      ef_father:        snapStepData.ef_father         || '',
      ef_mother:        snapStepData.ef_mother         || '',
      ef_dob:           snapStepData.ef_dob            || null,
      ef_sex:           snapStepData.ef_sex            || '',
      ef_marital:       snapStepData.ef_marital        || '',
      ef_addrPresent:   snapStepData.ef_addrPresent    || '',
      ef_addrPerm:      snapStepData.ef_addrPerm       || '',
      ef_addQual:       snapStepData.ef_addQual        || '',
      ef_nationality:   snapStepData.ef_nationality    || 'Indian',
      ef_aadhaar:       snapStepData.ef_aadhaar        || '',
      ef_emergency:     snapStepData.ef_emergency      || '',
      ef_passport:      snapStepData.ef_passport       || '',
      ef_passportInfo:  snapStepData.ef_passportInfo   || '',
      ef_reason:        snapStepData.ef_reason         || '',
      ef_place:         snapStepData.ef_place          || '',
      sigData:          snapStepData._sigData          || null,
      photoDataUrl:     snapStepData._photoDataUrl     || null,
      edu, exp, ref
    });

    if (r.success) {
      showToast('✅ Saved to database!', 'ok');
    } else {
      console.error('submit-to-hr DB save failed:', r.error);
      showToast('⚠️ DB sync failed: ' + (r.error||'unknown error'), 'err');
    }

    // Push to localStorage for placement.js
    try {
      const existing = JSON.parse(localStorage.getItem('pl_submitted_candidates')||'[]');
      if (!existing.find(e => e.contact===snapStepData.contact && e.name===snapStepData.name)) {
        existing.push({ id:'int_'+String(candId), name:snapStepData.name||'', contact:snapStepData.contact||'', email:snapStepData.email||'', photo:snapStepData._photoDataUrl||'', _photoDataUrl:snapStepData._photoDataUrl||'', preferredCountry:snapStepData.preferredCountry||'', country:snapStepData.preferredCountry||'', qual:snapStepData.qual||'', exp:snapStepData.exp||'', enrlNo:snapStepData.enrlNo||'', enrollmentNo:snapStepData.enrlNo||'', interviewer:'Ramya', submittedDate:dt.date, submittedTime:dt.time, recruiter:RECRUITER_META[snapRecruiter]?.name||snapRecruiter });
        localStorage.setItem('pl_submitted_candidates', JSON.stringify(existing));
      }
    } catch(e) {}

    saveAllState();
  };

  // DB: payment_pending
  const _origPP = window._storePaymentPending;
  if (_origPP) window._storePaymentPending = function() {
    const id = curCandidate ? curCandidate.id : null;
    _origPP();
    if (id) _api('POST', '/api/candidates/update-status', { candidateId:id, status:'payment_pending' });
    saveAllState();
  };

  // DB: reg_pending
  const _origRP = window._storeRegPending;
  if (_origRP) window._storeRegPending = function() {
    const id = curCandidate ? curCandidate.id : null;
    _origRP();
    if (id) _api('POST', '/api/candidates/update-status', { candidateId:id, status:'reg_pending' });
    saveAllState();
  };

  // Auto-save hooks
  ['renderPlacementSidebar','renderPaymentPendingTable','renderRegPendingTable'].forEach(name => {
    const orig = window[name]; if (!orig) return;
    window[name] = function(...args) {
      const r = orig.apply(this, args); saveAllState();
      if (name==='renderPlacementSidebar') { _updatePlacementCounts(); const el=document.getElementById('k-total'); if(el) el.textContent=getCumulativeTotal(); }
      return r;
    };
  });

  window.openProceed = (function(o){ return function(id){ if(o) o(id); saveAllState(); }; })(window.openProceed);
  window.openRecruiterView = (function(o){ return function(r){ ensureDropdownOpen('rec'); document.getElementById('nav-dashboard').classList.remove('active'); document.querySelectorAll('.sb-recruiter-item').forEach(el=>el.classList.remove('active')); document.querySelectorAll('.sb-followup-item').forEach(el=>el.classList.remove('active')); const a=document.getElementById('sb-'+r); if(a) a.classList.add('active'); if(o) o(r); }; })(window.openRecruiterView);
  window.showDashboard = (function(o){ return function(){ document.getElementById('nav-dashboard').classList.add('active'); document.querySelectorAll('.sb-recruiter-item').forEach(el=>el.classList.remove('active')); document.querySelectorAll('.sb-followup-item').forEach(el=>el.classList.remove('active')); if(o) o(); }; })(window.showDashboard);

  window.renderKPIs = (function(o){ return function(){
    if(o) o();
    const sc=document.getElementById('sb-cnt-soundariya'); if(sc) sc.textContent=(CANDIDATES.soundariya||[]).filter(c=>c.status==='scheduled').length;
    const tc=document.getElementById('sb-cnt-tharshini');  if(tc) tc.textContent=(CANDIDATES.tharshini||[]).filter(c=>c.status==='scheduled').length;
    const pc=document.getElementById('dtab-pay-cnt'); if(pc) pc.textContent=PAYMENT_PENDING_LIST.length;
    const rc=document.getElementById('dtab-reg-cnt'); if(rc) rc.textContent=REG_PENDING_LIST.length;
    if(typeof updateSidebarFollowupCounts==='function') updateSidebarFollowupCounts();
    _updateNotesSidebarCount(); _updatePlacementCounts();
    const te=document.getElementById('k-total'); if(te) te.textContent=getCumulativeTotal();
    const kt=document.getElementById('k-interviews-taken'); if(kt) kt.textContent=totalInterviewsTaken;
    const kc=document.getElementById('k-conversions'); if(kc) kc.textContent=totalConversions;
  }; })(window.renderKPIs);

  window.addEventListener('beforeunload', saveAllState);

}, { once: true });

function _updateNotesSidebarCount() {
  const all=[...(CANDIDATES.soundariya||[]),...(CANDIDATES.tharshini||[])];
  let total=0; all.forEach(c=>{ total+=(FOLLOWUP_NOTES[c.id]||[]).length; });
  const el=document.getElementById('sb-followup-notes-cnt'); if(el) el.textContent=total;
  const cnt=document.getElementById('dtab-notes-cnt'); if(cnt) cnt.textContent=total;
}
function _updatePlacementCounts() {
  const cnt=document.getElementById('dtab-placement-cnt'); if(cnt) cnt.textContent=PLACEMENT_LIST.length;
  const sb=document.getElementById('sb-placement-cnt'); if(sb) sb.textContent=PLACEMENT_LIST.length;
  const mc=document.getElementById('dtab-mycand-cnt'); if(mc) mc.textContent=PLACEMENT_LIST.length;
}
function fmtTime(d) {
  let h=d.getHours(), m=d.getMinutes(); const ap=h>=12?'PM':'AM'; h=h%12||12;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+' '+ap;
}