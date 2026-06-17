// =====================================================
// THE GOJOBSYNC CRM — placement-adapter.js
// Patches placement.js to use REST API
// Include BEFORE placement.js
// =====================================================

(function() {
  const token = sessionStorage.getItem('crm_token');
  const role  = sessionStorage.getItem('crm_role');
  if (!token) { window.location.href = 'login.html'; return; }
  if (role !== 'hr') {
    const pages = { recruiter: 'crm.html', interviewer: 'interview.html' };
    window.location.href = pages[role] || 'login.html';
  }
})();

window.electronAPI = {
  // HR sees submitted/payment_pending/reg_pending/placement candidates
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

  uploadPayment: (id, file) => UploadsAPI.uploadPayment(id, file),
  uploadPhoto:   (id, file) => UploadsAPI.uploadPhoto(id, file),
};

// placement.js uses localStorage for pipeline — we override to use API
// Intercept the PIPELINE population
window.__loadPipeline = async function() {
  const res = await CandidatesAPI.getAll();
  return res.candidates || [];
};

window.logoutUser = function() {
  AuthAPI.logout();
};

window.__fileUrl = (path) => UploadsAPI.fileUrl(path);

console.log('✅ Placement Adapter loaded for user:', Session.username);