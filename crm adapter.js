// =====================================================
// THE GOJOBSYNC CRM — crm-adapter.js
// Patches crm.js to use REST API instead of localStorage/electronAPI.
// Include this BEFORE crm.js in crm.html.
// =====================================================

// ── AUTH GUARD ────────────────────────────────────────
// Redirect non-recruiters immediately
(function() {
  const role = sessionStorage.getItem('crm_role');
  const token = sessionStorage.getItem('crm_token');
  if (!token) { window.location.href = 'login.html'; return; }
  if (role && role !== 'recruiter') {
    const pages = { interviewer: 'interview.html', hr: 'placement.html' };
    window.location.href = pages[role] || 'login.html';
  }
})();

// ── POLYFILL: window.electronAPI ─────────────────────
// crm.js calls window.electronAPI.* — we intercept them here
window.electronAPI = {
  // Called by crm.js on load
  getAllCandidates: async () => {
    const res = await CandidatesAPI.getAll();
    return res.candidates || [];
  },

  addCandidate: async (data) => {
    const res = await CandidatesAPI.add(data);
    return res;
  },

  updateCandidate: async (id, data) => {
    return CandidatesAPI.update(id, data);
  },

  deleteCandidate: async (id) => {
    return CandidatesAPI.delete(id);
  },

  updateStatus: async (id, status, extras) => {
    return CandidatesAPI.updateStatus(id, status, extras);
  },

  // Client management
  getAllClients: async () => {
    const res = await ClientsAPI.getAll();
    return res.clients || [];
  },
  saveClients: () => {},  // no-op; use ClientsAPI directly

  // File uploads
  uploadResume: (id, file) => UploadsAPI.uploadResume(id, file),
  uploadPhoto:  (id, file) => UploadsAPI.uploadPhoto(id, file),

  // Auth
  login: (u, p) => AuthAPI.login(u, p),
};

// ── LOGOUT OVERRIDE ───────────────────────────────────
window.logoutUser = function() {
  AuthAPI.logout();
};

// ── PROFILE DISPLAY ───────────────────────────────────
// crm.js reads from PROFILES[curProfile] — we patch it with live session data
window.__CRM_PROFILE_OVERRIDE__ = {
  name:  Session.name  || 'Recruiter',
  empid: Session.empid || 'EMP-001',
  doj:   Session.doj   || '',
  img:   Session.img   || '',
};

// ── FILE URL HELPER ───────────────────────────────────
// crm.js may reference file paths — prefix them with API base
window.__fileUrl = (path) => UploadsAPI.fileUrl(path);

console.log('✅ CRM Adapter loaded for user:', Session.username, '| Role:', Session.role);