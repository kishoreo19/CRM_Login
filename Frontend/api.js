// =====================================================
// THE GOJOBSYNC CRM — api.js
// Web adapter: replaces window.electronAPI with fetch()
// Include this in ALL HTML pages BEFORE any other script
// =====================================================

(function () {
  'use strict';

  const BASE = ''; // same origin — server serves frontend too

  // ── SESSION TOKEN HELPERS ─────────────────────────────
  function getToken() {
    return sessionStorage.getItem('crm_token') || '';
  }

  function authHeaders(extra) {
    return Object.assign({ 'Content-Type': 'application/json', 'x-session-token': getToken() }, extra);
  }

  // ── GENERIC FETCH WRAPPERS ────────────────────────────
  async function apiFetch(method, url, body) {
    const opts = { method, headers: authHeaders() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(BASE + url, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }

  const GET    = (url)       => apiFetch('GET',    url);
  const POST   = (url, body) => apiFetch('POST',   url, body);
  const PUT    = (url, body) => apiFetch('PUT',    url, body);
  const DELETE = (url)       => apiFetch('DELETE', url);

  // ── AUTH ──────────────────────────────────────────────
  async function login(username, password) {
    try {
      const data = await POST('/api/auth/login', { username, password });
      if (data.success) {
        sessionStorage.setItem('crm_token',        data.token);
        sessionStorage.setItem('crm_role',         data.role);
        sessionStorage.setItem('crm_recruiter_id', String(data.id));
        sessionStorage.setItem('crm_username',     data.username);
        sessionStorage.setItem('crm_user_name',    data.name  || '');
        sessionStorage.setItem('crm_user_img',     data.img   || '');
        sessionStorage.setItem('crm_empid',        data.empid || '');
        sessionStorage.setItem('crm_doj',          data.doj   || '');
        sessionStorage.setItem('crm_profile',      _usernameToProfile(data.username));
      }
      return data;
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async function logout() {
    try { await POST('/api/auth/logout', {}); } catch (_) {}
    sessionStorage.clear();
  }

  function _usernameToProfile(u) {
    const map = { rec001: 'soundariya', rec002: 'tharshini' };
    return map[u] || 'soundariya';
  }

  // ── CANDIDATES ────────────────────────────────────────
  async function getAllCandidates(recruiterId, createdBy) {
    const data = await GET('/api/candidates');
    return data.candidates || [];
  }

  async function getScheduledCandidates() {
    const data = await GET('/api/candidates');
    return data.candidates || [];
  }

  async function addCandidate(candidate, recruiterId, createdBy) {
    const data = await POST('/api/candidates', candidate);
    return data; // { success, id, enrollment_no }
  }

  async function updateCandidate(id, candidate, createdBy) {
    return await PUT(`/api/candidates/${id}`, candidate);
  }

  async function deleteCandidate(id) {
    return await DELETE(`/api/candidates/${id}`);
  }

  async function updateCandidateStatus(candidateId, status, extra) {
    return await POST('/api/candidates/update-status', { candidateId, status, ...extra });
  }

  async function scheduleCandidate(candidateId, notes, followupDate, followupTime) {
    return await POST('/api/candidates/update-status', {
      candidateId, status: 'scheduled', notes, followupDate, followupTime
    });
  }

  async function submitToHR(candidateId, interviewerNotes) {
    return await POST('/api/candidates/update-status', {
      candidateId, status: 'submitted', interviewerNotes
    });
  }

  async function rejectCandidate(candidateId, notes) {
    return await POST('/api/candidates/update-status', {
      candidateId, status: 'rejected', notes
    });
  }

  // ── CLIENTS ───────────────────────────────────────────
  async function getAllClients() {
    const data = await GET('/api/clients');
    return data.clients || [];
  }

  async function addClient(client) {
    return await POST('/api/clients', client);
  }

  async function updateClient(id, client) {
    return await PUT(`/api/clients/${id}`, client);
  }

  async function deleteClient(id) {
    return await DELETE(`/api/clients/${id}`);
  }

  // ── FILE UPLOADS ──────────────────────────────────────
  async function uploadFile(endpoint, fieldName, file) {
    const form = new FormData();
    form.append(fieldName, file);
    const r = await fetch(BASE + endpoint, {
      method: 'POST',
      headers: { 'x-session-token': getToken() },
      body: form,
    });
    return await r.json();
  }

  async function uploadResume(candidateId, file) {
    return uploadFile(`/api/uploads/resume/${candidateId}`, 'resume', file);
  }

  async function uploadPhoto(candidateId, file) {
    return uploadFile(`/api/uploads/photo/${candidateId}`, 'photo', file);
  }

  async function uploadPaymentProof(candidateId, file) {
    return uploadFile(`/api/uploads/payment/${candidateId}`, 'proof', file);
  }

  // ── EXPOSE AS window.electronAPI SHIM ─────────────────
  // This makes ALL existing frontend code (crm.js, interview.js, etc.)
  // work without any changes — they all call window.electronAPI.*
  window.electronAPI = {
    // Auth
    login,
    logout,

    // Candidates
    getAllCandidates,
    getScheduledCandidates,
    addCandidate,
    updateCandidate,
    deleteCandidate,
    updateCandidateStatus,
    scheduleCandidate,
    submitToHR,
    rejectCandidate,

    // Clients
    getAllClients,
    addClient,
    updateClient,
    deleteClient,

    // Uploads
    uploadResume,
    uploadPhoto,
    uploadPaymentProof,

    // Break status (kept in localStorage for real-time sync between tabs)
    setBreakStatus: (status) => {
      if (status === 'present') localStorage.removeItem('ramya_break_status');
      else localStorage.setItem('ramya_break_status', JSON.stringify({ status, since: new Date().toLocaleTimeString() }));
    },
    getBreakStatus: () => {
      try { return JSON.parse(localStorage.getItem('ramya_break_status') || 'null'); } catch { return null; }
    },

    // Placement data sync via localStorage (fast cross-tab communication)
    pushToPlacement: (candidates) => {
      localStorage.setItem('pl_submitted_candidates', JSON.stringify(candidates));
    },
    getPlacementCandidates: () => {
      try { return JSON.parse(localStorage.getItem('pl_submitted_candidates') || '[]'); } catch { return []; }
    },

    // Helper: raw API access for custom calls
    _fetch: apiFetch,
  };

  // ── AUTH GUARD ─────────────────────────────────────────
  // Pages that require login will call this
  window.requireLogin = function (allowedRoles) {
    const token = getToken();
    const role  = sessionStorage.getItem('crm_role');
    if (!token) { window.location.href = '/login.html'; return false; }
    if (allowedRoles && !allowedRoles.includes(role)) {
      // Redirect to correct page for role
      const map = { recruiter: '/crm.html', interviewer: '/interview.html', hr: '/placement.html' };
      window.location.href = map[role] || '/login.html';
      return false;
    }
    return true;
  };

  console.log('[JobSync] Web API adapter loaded ✓');
})();

// ── ADDITIONAL METHODS (appended) ─────────────────────
// Extend window.electronAPI after initial definition
(function extendAPI() {
  const _api = window.electronAPI;

  // File dialog → input[type=file] picker
  _api.openFileDialog = function () {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.doc,.docx';
      input.onchange = () => resolve(input.files[0] ? { filePath: '__web__', file: input.files[0] } : null);
      input.click();
    });
  };

  // Open resume: open URL in new tab
  _api.openResume = function (path) {
    if (path) window.open(path, '_blank');
    return Promise.resolve();
  };

  // saveResume: upload file to server
  _api.saveResume = async function (fileOrPath, candidateName) {
    // In web mode, file was already uploaded via uploadResume
    return Promise.resolve({ success: true });
  };

  // saveClients: persist via API
  _api.saveClients = async function (clients) {
    // Individual add/update/delete calls handle this — no batch needed
    return Promise.resolve({ success: true });
  };

  // nextEnrollmentNo: get from server
  _api.nextEnrollmentNo = async function () {
    try {
      const data = await fetch('/api/candidates/next-enrollment', {
        headers: { 'x-session-token': sessionStorage.getItem('crm_token') || '' }
      }).then(r => r.json());
      return { success: true, enrollmentNo: data.enrollmentNo };
    } catch {
      return { success: true, enrollmentNo: 'JS-' + String(Date.now()).slice(-5) };
    }
  };

  // saveEnrollment: update candidate with full enrollment data
  _api.saveEnrollment = async function (candidateId, data) {
    try {
      const token = sessionStorage.getItem('crm_token') || '';
      const payload = {
        father_name:        data.fatherName         || '',
        mother_name:        data.motherName         || '',
        dob:                data.dob                || null,
        gender:             data.gender             || '',
        marital_status:     data.maritalStatus      || '',
        address_present:    data.addrPresent        || '',
        address_permanent:  data.addrPerm           || '',
        add_qual:           data.addQual            || '',
        nationality:        data.nationality        || 'Indian',
        aadhaar:            data.aadhaar            || '',
        emergency_contact:  data.emergency          || '',
        passport_no:        data.passportNo         || '',
        passport_info:      data.passportInfo       || '',
        preferred_country:  data.preferredCountry   || '',
        reason_relocation:  data.reasonRelocation   || '',
        edu_json:           data.edu                || [],
        exp_json:           data.exp                || [],
        ref_json:           data.ref                || [],
        payment_amount:     data.paymentAmount      || '',
        payment_date:       data.paymentDate        || null,
        notes:              data.notes              || '',
      };
      await fetch(`/api/candidates/${candidateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token },
        body: JSON.stringify(payload),
      });
      // Then update status to submitted
      await fetch('/api/candidates/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token },
        body: JSON.stringify({ candidateId, status: 'submitted', interviewerNotes: data.notes || '' }),
      });
    } catch (e) {
      console.error('saveEnrollment error:', e);
    }
    return { success: true };
  };

  // deleteCandidate (for crm.js)
  if (!_api.deleteCandidate) {
    _api.deleteCandidate = async function (id) {
      return await fetch(`/api/candidates/${id}`, {
        method: 'DELETE',
        headers: { 'x-session-token': sessionStorage.getItem('crm_token') || '' }
      }).then(r => r.json());
    };
  }

  console.log('[JobSync] API extensions loaded ✓');
})();
