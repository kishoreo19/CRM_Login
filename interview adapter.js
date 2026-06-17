// =====================================================
// THE GOJOBSYNC CRM — interview-adapter.js
// Patches interview.js to use REST API
// Include BEFORE interview.js
// =====================================================

(function() {
  const token = sessionStorage.getItem('crm_token');
  const role  = sessionStorage.getItem('crm_role');
  if (!token) { window.location.href = 'login.html'; return; }
  if (role !== 'interviewer') {
    const pages = { recruiter: 'crm.html', hr: 'placement.html' };
    window.location.href = pages[role] || 'login.html';
  }
})();

window.electronAPI = {
  // Interviewers see candidates with status='scheduled'
  getAllCandidates: async () => {
    const res = await CandidatesAPI.getAll();
    return res.candidates || [];
  },

  updateStatus: async (id, status, extras) => {
    return CandidatesAPI.updateStatus(id, status, extras);
  },

  updateCandidate: async (id, data) => {
    return CandidatesAPI.update(id, data);
  },

  uploadResume: (id, file) => UploadsAPI.uploadResume(id, file),
  uploadPhoto:  (id, file) => UploadsAPI.uploadPhoto(id, file),
};

window.logoutUser = function() {
  AuthAPI.logout();
};

window.__fileUrl = (path) => UploadsAPI.fileUrl(path);

console.log('✅ Interview Adapter loaded for user:', Session.username);