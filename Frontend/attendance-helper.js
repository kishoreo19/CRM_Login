// =====================================================
// THE GOJOBSYNC — attendance-helper.js
// Add this script to crm.html, interview.html, placement.html
// It auto-marks attendance on login and handles break API calls
// Usage: <script src="attendance-helper.js"></script>
// =====================================================

(function() {
  'use strict';

  const TOKEN = () => sessionStorage.getItem('crm_token') || '';

  // ── AUTO-MARK ATTENDANCE ON PAGE LOAD ───────────────
  async function markAttendance() {
    if (!TOKEN()) return;
    try {
      await fetch('/api/attendance/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': TOKEN() }
      });
    } catch(e) {
      console.warn('[Attendance] Mark failed (non-fatal):', e.message);
    }
  }

  // ── CHECK FOR ACTIVE BREAK (resume timer on page refresh) ──
  async function checkActiveBreak() {
    if (!TOKEN()) return null;
    try {
      const res  = await fetch('/api/attendance/break/active', {
        headers: { 'x-session-token': TOKEN() }
      });
      const data = await res.json();
      return data.onBreak ? data : null;
    } catch(e) {
      return null;
    }
  }

  // ── START BREAK ──────────────────────────────────────
  // Replaces the localStorage-only break system
  // Returns { breakId, breakType, startTime }
  window.startBreakAPI = async function(breakType) {
    try {
      const res  = await fetch('/api/attendance/break/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': TOKEN() },
        body: JSON.stringify({ breakType })
      });
      const data = await res.json();
      if (data.success) {
        // Store breakId in sessionStorage for end-break call
        sessionStorage.setItem('current_break_id', data.breakId);
        sessionStorage.setItem('current_break_type', data.breakType);
        // ALSO write to localStorage for Admin dashboard backward compat
        localStorage.setItem('ramya_break_status', JSON.stringify({
          status: breakType === 'lunch' ? '🍽 Lunch Break' : '☕ Short Break',
          since: data.startTime,
          breakId: data.breakId
        }));
      }
      return data;
    } catch(e) {
      console.error('[Attendance] Break start failed:', e.message);
      return { success: false };
    }
  };

  // ── END BREAK ─────────────────────────────────────────
  window.endBreakAPI = async function() {
    const breakId = sessionStorage.getItem('current_break_id');
    try {
      const res  = await fetch('/api/attendance/break/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': TOKEN() },
        body: JSON.stringify({ breakId: breakId ? parseInt(breakId) : null })
      });
      const data = await res.json();
      if (data.success) {
        sessionStorage.removeItem('current_break_id');
        sessionStorage.removeItem('current_break_type');
        // Clear localStorage break status
        localStorage.removeItem('ramya_break_status');
      }
      return data;
    } catch(e) {
      console.error('[Attendance] Break end failed:', e.message);
      return { success: false };
    }
  };

  // ── RECORD LOGOUT (called before page unload) ─────────
  window.recordLogoutAPI = async function() {
    if (!TOKEN()) return;
    // End any open break first
    const breakId = sessionStorage.getItem('current_break_id');
    if (breakId) { await window.endBreakAPI(); }
    try {
      await fetch('/api/attendance/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': TOKEN() }
      });
    } catch(e) {}
  };

  // ── PATCH: Interview/Placement break buttons ──────────
  // Call this after your page loads to wire up break buttons to the API
  // Works with the existing startTopbarBreak() function in interview.html + placement.html
  window.patchBreakButtons = function() {
    // Override the existing startTopbarBreak global function
    const origFn = window.startTopbarBreak;
    window.startTopbarBreak = async function(type) {
      // Call API first
      const result = await window.startBreakAPI(type);
      if (result.success && origFn) {
        // Run the original timer UI code
        origFn.call(this, type);
      } else if (!origFn) {
        console.warn('startTopbarBreak original not found');
      }
    };

    // Patch break timer end — find the clearInterval call
    // The original code auto-clears after timer ends; we hook into that
    const origSetInterval = window.setInterval;
    // Simpler approach: watch for break display hiding
    const display = document.getElementById('topbar-break-display');
    if (display) {
      const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
          if (m.type === 'attributes' && m.attributeName === 'style') {
            if (display.style.display === 'none' && sessionStorage.getItem('current_break_id')) {
              window.endBreakAPI();
            }
          }
        });
      });
      observer.observe(display, { attributes: true });
    }
  };

  // ── INIT: Run on DOM ready ────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    // Mark attendance
    await markAttendance();

    // Check if there's an active break from previous session
    const activeBreak = await checkActiveBreak();
    if (activeBreak) {
      // Store the break ID so endBreakAPI works correctly
      sessionStorage.setItem('current_break_id', activeBreak.breakId);
      sessionStorage.setItem('current_break_type', activeBreak.breakType);
    }

    // Patch break buttons if they exist on this page
    if (document.getElementById('topbar-break-short')) {
      window.patchBreakButtons();
    }
  });

  // ── Record logout on tab/window close ────────────────
  window.addEventListener('beforeunload', () => {
    // Use sendBeacon for reliable delivery on page close
    const token = TOKEN();
    if (!token) return;
    // End break if active
    const breakId = sessionStorage.getItem('current_break_id');
    if (breakId) {
      navigator.sendBeacon('/api/attendance/break/end',
        new Blob([JSON.stringify({ breakId: parseInt(breakId) })],
        { type: 'application/json' })
      );
    }
  });

})();
