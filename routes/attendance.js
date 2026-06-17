// =====================================================
// THE GOJOBSYNC CRM — routes/attendance.js  v3
// FIXED: matches actual DB schema
//   attendance: user_id, user_name, role, work_date,
//               login_time(varchar), logout_time(varchar),
//               status, worked_mins
//   breaks: need to check — using work_date column
// =====================================================

const router = require('express').Router();
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');
const { triggerSARefresh } = require('../utils/sseBroadcast'); 
router.use(requireAuth);

const TARGET_HOURS = 9;

// ── HELPERS ───────────────────────────────────────────
function todayDate() {
  // Returns YYYY-MM-DD in LOCAL time (not UTC)
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function currentTimeStr() {
  // Returns "HH:MM:SS" in local time
  const now = new Date();
  return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
}

// Format "HH:MM:SS" or "HH:MM AM/PM" string → "HH:MM AM/PM"
function formatTimeStr(t) {
  if (!t) return null;
  const str = String(t).trim();

  // Already formatted like "09:30 AM"
  if (/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(str)) return str;

  // "HH:MM:SS" or "HH:MM"
  const parts = str.split(':').map(Number);
  let h = parts[0] || 0, m = parts[1] || 0;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ap}`;
}

// Parse "HH:MM AM/PM" or "HH:MM:SS" → minutes since midnight
function timeToMinutes(t) {
  if (!t) return 0;
  const str = String(t).trim();

  // "HH:MM AM/PM"
  const ampm = str.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]), m = parseInt(ampm[2]);
    const period = ampm[3].toUpperCase();
    if (period === 'AM' && h === 12) h = 0;
    if (period === 'PM' && h !== 12) h += 12;
    return h * 60 + m;
  }

  // "HH:MM:SS" or "HH:MM"
  const parts = str.split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

// Compute worked minutes = (end - start) - breaks
function calcWorkedMins(loginTime, logoutTime, totalBreakMins) {
  if (!loginTime) return 0;
  const startMins = timeToMinutes(loginTime);
  const endMins   = logoutTime ? timeToMinutes(logoutTime) : timeToMinutes(currentTimeStr());
  const diff = endMins - startMins;
  if (diff <= 0) return 0;
  return Math.max(0, diff - (totalBreakMins || 0));
}

function fmtMins(mins) {
  if (!mins || mins <= 0) return '0 hr 0 min';
  return `${Math.floor(mins / 60)} hr ${mins % 60} min`;
}

function targetProgress(workedMins) {
  return Math.min(100, Math.round((workedMins / (TARGET_HOURS * 60)) * 100));
}

// ── POST /api/attendance/login ────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { id: userId, name: userName, role } = req.user;
    const today   = todayDate();
    const nowTime = formatTimeStr(currentTimeStr());

    // Check if already logged in today
    const [existing] = await db.execute(
      `SELECT id, login_time FROM attendance WHERE user_id = ? AND work_date = ?`,
      [userId, today]
    );

    if (existing.length) {
      // If logged out, allow re-login by clearing logout time
      if (existing[0].logout_time) {
        await db.execute(
          `UPDATE attendance SET logout_time = NULL, status = 'present' WHERE user_id = ? AND work_date = ?`,
          [userId, today]
        );
        return res.json({ success: true, loginTime: existing[0].login_time, alreadyLoggedIn: false });
      }
      // Already logged in today — don't overwrite login time
      return res.json({ success: true, loginTime: existing[0].login_time, alreadyLoggedIn: true });
    }

    await db.execute(
      `INSERT INTO attendance (user_id, user_name, role, work_date, date, login_time, status)
       VALUES (?, ?, ?, ?, ?, ?, 'present')`,
      [userId, userName || '', role || '', today, today, nowTime]
    );

    res.json({ success: true, loginTime: nowTime });
  } catch (err) {
    console.error('attendance/login error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/attendance/logout ───────────────────────
router.post('/logout', async (req, res) => {
  try {
    const { id: userId } = req.user;
    const today   = todayDate();
    const nowTime = formatTimeStr(currentTimeStr());

    // Close any open breaks
    try {
      await db.execute(
        `UPDATE breaks
         SET end_time     = ?,
             duration_min = TIMESTAMPDIFF(MINUTE, start_time, ?)
         WHERE user_id = ? AND work_date = ? AND end_time IS NULL`,
        [nowTime, nowTime, userId, today]
      );
    } catch(e) { /* breaks table might not exist yet */ }

    // Get login time and break total for final calculation
    const [attRow] = await db.execute(
      `SELECT login_time FROM attendance WHERE user_id = ? AND work_date = ?`,
      [userId, today]
    );

    let totalBreakMins = 0;
    try {
      const [brkRow] = await db.execute(
        `SELECT COALESCE(SUM(duration_min), 0) AS total
         FROM breaks WHERE user_id = ? AND work_date = ?`,
        [userId, today]
      );
      totalBreakMins = brkRow[0]?.total || 0;
    } catch(e) {}

    const workedMins = attRow[0]
      ? calcWorkedMins(attRow[0].login_time, nowTime, totalBreakMins)
      : 0;

    await db.execute(
      `UPDATE attendance
       SET logout_time = ?, worked_mins = ?, status = 'present'
       WHERE user_id = ? AND work_date = ?`,
      [nowTime, workedMins, userId, today]
    );

    // Delete session
    const token = req.headers['x-session-token'];
    if (token) {
      await db.execute('DELETE FROM sessions WHERE token = ?', [token]);
    }

    res.json({ success: true, workedMins, workedFormatted: fmtMins(workedMins) });
  } catch (err) {
    console.error('attendance/logout error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// POST /api/attendance/idle
router.post('/idle', async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { idleMins } = req.body;
    await db.execute(`UPDATE attendance SET idle_mins = ? WHERE user_id = ? AND work_date = ?`, [idleMins||0, userId, todayDate()]);
    res.json({ success: true, idleMins });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// ── POST /api/attendance/break/start ──────────────────
// ── POST /api/attendance/break/start ──────────────────
router.post('/break/start', async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { breakType = 'short' } = req.body;
    const today   = todayDate();
    const nowTime = formatTimeStr(currentTimeStr());

    // Check no open break already
    const [open] = await db.execute(
      `SELECT id FROM breaks WHERE user_id = ? AND work_date = ? AND end_time IS NULL`,
      [userId, today]
    );
    if (open.length) {
      return res.status(400).json({ success: false, error: 'Break already in progress' });
    }

    await db.execute(
      `INSERT INTO breaks (user_id, work_date, break_type, start_time) VALUES (?, ?, ?, ?)`,
      [userId, today, breakType, nowTime]
    );

    res.json({ success: true, breakType, startTime: nowTime });
  } catch (err) {
    console.error('break/start error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/attendance/break/end ────────────────────
router.get("/break/active", async (req, res) => {
  try {
    const { id: userId } = req.user;
    const today = todayDate();
    const [rows] = await db.execute(`SELECT id, break_type, start_time FROM breaks WHERE user_id = ? AND work_date = ? AND end_time IS NULL`, [userId, today]);
    if (rows.length) {
      res.json({ success: true, onBreak: true, breakType: rows[0].break_type, startTime: rows[0].start_time });
    } else {
      res.json({ success: true, onBreak: false });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/break/end', async (req, res) => {
  try {
    const { id: userId } = req.user;
    const today   = todayDate();
    const nowTime = formatTimeStr(currentTimeStr());

    const [open] = await db.execute(
      `SELECT id, start_time FROM breaks 
       WHERE user_id = ? AND work_date = ? AND end_time IS NULL`,
      [userId, today]
    );

    if (!open.length) {
      return res.status(400).json({ success: false, error: 'No active break found' });
    }

    const startMins = timeToMinutes(open[0].start_time);
    const endMins   = timeToMinutes(nowTime);
    const dur       = Math.max(0, endMins - startMins);

    await db.execute(
      `UPDATE breaks SET end_time = ?, duration_min = ? WHERE id = ?`,
      [nowTime, dur, open[0].id]
    );

    res.json({ success: true, durationMins: dur });
  } catch (err) {
    console.error('break/end error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/attendance/break/end ────────────────────
router.get("/break/active", async (req, res) => {
  try {
    const { id: userId } = req.user;
    const today = todayDate();
    const [rows] = await db.execute(`SELECT id, break_type, start_time FROM breaks WHERE user_id = ? AND work_date = ? AND end_time IS NULL`, [userId, today]);
    if (rows.length) {
      res.json({ success: true, onBreak: true, breakType: rows[0].break_type, startTime: rows[0].start_time });
    } else {
      res.json({ success: true, onBreak: false });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/break/end', async (req, res) => {
  try {
    const { id: userId } = req.user;
    const today   = todayDate();
    const nowTime = formatTimeStr(currentTimeStr());

    // Try work_date column first, then date
    let updated = false;
    try {
      const [open] = await db.execute(
        `SELECT id, start_time FROM breaks WHERE user_id = ? AND work_date = ? AND end_time IS NULL`,
        [userId, today]
      );
      if (open.length) {
        const startMins = timeToMinutes(open[0].start_time);
        const endMins   = timeToMinutes(nowTime);
        const dur = Math.max(0, endMins - startMins);
        await db.execute(
          `UPDATE breaks SET end_time = ?, duration_min = ? WHERE id = ?`,
          [nowTime, dur, open[0].id]
        );
        updated = true;
      }
    } catch(e) {
      console.warn('break/end work_date:', e.message);
    }

    if (!updated) {
      return res.status(400).json({ success: false, error: 'No active break found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('break/end error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/attendance/status ────────────────────────
router.get('/status', async (req, res) => {
  try {
    const { id: userId } = req.user;
    const today = todayDate();

    const [attRows] = await db.execute(
      `SELECT login_time, logout_time, worked_mins
       FROM attendance WHERE user_id = ? AND work_date = ?`,
      [userId, today]
    );

    if (!attRows.length || !attRows[0].login_time) {
      return res.json({ success: true, status: 'not_logged_in' });
    }

    const att = attRows[0];

    // Break info
    let breakCount = 0, totalBreakMins = 0, activeBreak = null;
    try {
      const [brkSummary] = await db.execute(
        `SELECT COUNT(*) AS bc, COALESCE(SUM(duration_min),0) AS tbm,
                MAX(CASE WHEN end_time IS NULL THEN break_type END) AS abt,
                MAX(CASE WHEN end_time IS NULL THEN start_time END) AS abs
         FROM breaks WHERE user_id = ? AND work_date = ?`,
        [userId, today]
      );
      breakCount     = brkSummary[0].bc || 0;
      totalBreakMins = brkSummary[0].tbm || 0;
      if (brkSummary[0].abt) {
        activeBreak = { type: brkSummary[0].abt, startTime: brkSummary[0].abs };
      }
    } catch(e) {
      // breaks table might use different date column
      try {
        const [brkSummary] = await db.execute(
          `SELECT COUNT(*) AS bc, COALESCE(SUM(duration_min),0) AS tbm,
                  MAX(CASE WHEN end_time IS NULL THEN break_type END) AS abt
           FROM breaks WHERE user_id = ? AND date = ?`,
          [userId, today]
        );
        breakCount     = brkSummary[0].bc || 0;
        totalBreakMins = brkSummary[0].tbm || 0;
        if (brkSummary[0].abt) activeBreak = { type: brkSummary[0].abt };
      } catch(e2) {}
    }

    const workedMins   = calcWorkedMins(att.login_time, att.logout_time, totalBreakMins);
    const progress     = targetProgress(workedMins);

    if (att.logout_time) {
      return res.json({
        success: true, status: 'logged_out',
        loginTime:       formatTimeStr(att.login_time),
        logoutTime:      formatTimeStr(att.logout_time),
        workedMins, workedFormatted: fmtMins(workedMins), targetProgress: progress,
        breakCount, totalBreakMins
      });
    }

    if (activeBreak) {
      const breakElapsed = activeBreak.startTime
        ? Math.max(0, timeToMinutes(currentTimeStr()) - timeToMinutes(activeBreak.startTime))
        : 0;
      return res.json({
        success: true, status: 'on_break',
        breakType: activeBreak.type, breakMinsElapsed: breakElapsed,
        loginTime: formatTimeStr(att.login_time),
        workedMins, workedFormatted: fmtMins(workedMins), targetProgress: progress,
        breakCount, totalBreakMins
      });
    }

    res.json({
      success: true, status: 'online',
      loginTime:       formatTimeStr(att.login_time),
      workedMins, workedFormatted: fmtMins(workedMins), targetProgress: progress,
      breakCount, totalBreakMins
    });
  } catch (err) {
    console.error('attendance/status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/attendance/today ─────────────────────────
router.get('/today', async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'itadmin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const today = todayDate();

    // Get all active non-admin staff
    const [users] = await db.execute(
      `SELECT id, username, name, role FROM users
       WHERE role IN ('recruiter','interviewer','hr') AND status = 'active'
       ORDER BY role, name`
    );

    const result = [];

    for (const u of users) {
      // Attendance using work_date
      const [attRows] = await db.execute(
        `SELECT login_time, logout_time, worked_mins, status
         FROM attendance WHERE user_id = ? AND work_date = ?`,
        [u.id, today]
      );

      // Breaks summary
      let breakCount = 0, totalBreakMins = 0, activeBreakType = null, breakMinsElapsed = 0;
      try {
        const [brkRows] = await db.execute(
          `SELECT COUNT(*) AS bc,
                  COALESCE(SUM(duration_min), 0) AS tbm,
                  MAX(CASE WHEN end_time IS NULL THEN break_type END) AS abt,
                  MAX(CASE WHEN end_time IS NULL THEN start_time END) AS abs
           FROM breaks WHERE user_id = ? AND work_date = ?`,
          [u.id, today]
        );
        breakCount      = brkRows[0].bc  || 0;
        totalBreakMins  = brkRows[0].tbm || 0;
        activeBreakType = brkRows[0].abt || null;
        if (activeBreakType && brkRows[0].abs) {
          breakMinsElapsed = Math.max(0,
            timeToMinutes(currentTimeStr()) - timeToMinutes(brkRows[0].abs)
          );
        }
      } catch(e) {
        // try with date column
        try {
          const [brkRows] = await db.execute(
            `SELECT COUNT(*) AS bc,
                    COALESCE(SUM(duration_min), 0) AS tbm,
                    MAX(CASE WHEN end_time IS NULL THEN break_type END) AS abt
             FROM breaks WHERE user_id = ? AND date = ?`,
            [u.id, today]
          );
          breakCount     = brkRows[0].bc  || 0;
          totalBreakMins = brkRows[0].tbm || 0;
          activeBreakType = brkRows[0].abt || null;
        } catch(e2) {}
      }

      const att = attRows[0] || {};
      let liveStatus = 'not_logged_in';

      if (att.login_time) {
        if (att.logout_time)       liveStatus = 'logged_out';
        else if (activeBreakType)  liveStatus = 'on_break';
        else                       liveStatus = 'online';
      }

      // Real-time worked mins
      const workedMins = liveStatus === 'logged_out' && att.worked_mins > 0
        ? att.worked_mins
        : calcWorkedMins(att.login_time, att.logout_time, totalBreakMins);

      // Activity mins
      let meetingMins = 0, trainingMins = 0;
      try {
        const [actRows] = await db.execute(
          `SELECT activity_type, COALESCE(SUM(duration_mins), 0) AS total
           FROM activities WHERE user_id = ? AND work_date = ? GROUP BY activity_type`,
          [u.id, today]
        );
        for (const row of actRows) {
          if (row.activity_type === 'meeting') meetingMins = row.total || 0;
          if (row.activity_type === 'training') trainingMins = row.total || 0;
        }
      } catch(e) {}

      result.push({
        id:               u.id,
        username:         u.username,
        name:             u.name,
        role:             u.role,
        liveStatus,
        loginTime:        formatTimeStr(att.login_time),
        logoutTime:       formatTimeStr(att.logout_time),
        breakCount,
        totalBreakMins,
        breakType:        activeBreakType,
        breakMinsElapsed,
        workedMins,
        workedFormatted:  fmtMins(workedMins),
        targetProgress:   targetProgress(workedMins),
        targetHours:      TARGET_HOURS,
        meetingMins,
        trainingMins,

      });
    }

    res.json({ success: true, staff: result });
  } catch (err) {
    console.error('attendance/today error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/attendance/live-stats ────────────────────
router.get('/live-stats', async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'itadmin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const [recStats] = await db.execute(
      `SELECT u.name,
              COUNT(c.id)                              AS total,
              SUM(c.status = 'scheduled')              AS scheduled,
              SUM(c.status = 'interested')             AS interested,
              SUM(c.status = 'followups')              AS followups,
              SUM(c.status = 'rnr')                    AS rnr,
              SUM(c.status = 'notinterested')          AS not_interested,
              SUM(c.status = 'submitted')              AS submitted,
              SUM(c.registered = 1)                    AS converted,
              SUM(DATE(c.created_at) = CURDATE())      AS added_today
       FROM users u
       LEFT JOIN candidates c ON c.recruiter_id = u.id
       WHERE u.role = 'recruiter' AND u.status = 'active'
       GROUP BY u.id, u.name
       ORDER BY u.name`
    );

    const [[intStats]] = await db.execute(
      `SELECT SUM(status='scheduled') AS scheduled,
              SUM(status='submitted') AS submittedToHR
       FROM candidates`
    );

    const [[plStats]] = await db.execute(
      `SELECT
         SUM(stage='registered')         AS registered,
         SUM(stage='bgv')                AS bgv,
         SUM(stage='contract')           AS contract,
         SUM(stage='training')           AS training,
         SUM(stage='placement_followup') AS placement_followup,
         SUM(stage='placed')             AS placed
       FROM placement_pipeline`
    );

    const [[todaySched]] = await db.execute(
      `SELECT COUNT(*) AS cnt FROM candidates WHERE status = 'scheduled'`
    );

    res.json({
      success:        true,
      recruiters:     recStats,
      interviewer:    intStats || {},
      placement:      plStats  || {},
      todayScheduled: todaySched?.cnt || 0,
    });
  } catch (err) {
    console.error('live-stats error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/attendance/report ────────────────────────
router.get('/report', async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'itadmin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const period     = req.query.period || 'week';
    const weekOffset = parseInt(req.query.week_offset || '0');
    const year       = parseInt(req.query.year  || new Date().getFullYear());
    const month      = parseInt(req.query.month || (new Date().getMonth() + 1));

    let startDate, endDate;

    if (period === 'month') {
      startDate = `${year}-${String(month).padStart(2,'0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      endDate   = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    } else {
      const now = new Date();
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + mondayOffset + (weekOffset * 7));
      monday.setHours(0,0,0,0);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      startDate = monday.toISOString().split('T')[0];
      endDate   = sunday.toISOString().split('T')[0];
    }

    // Get staff
    const [users] = await db.execute(
      `SELECT id, name, role FROM users
       WHERE role IN ('recruiter','interviewer','hr') AND status = 'active'
       ORDER BY role, name`
    );

    // Get attendance rows — using work_date
    const userIds = users.map(u => u.id);
    if (!userIds.length) {
      return res.json({ success: true, period, startDate, endDate, targetHours: TARGET_HOURS, report: [] });
    }

    const placeholders = userIds.map(() => '?').join(',');
    const [attRows] = await db.execute(
      `SELECT a.user_id, a.work_date AS date, a.login_time, a.logout_time,
              COALESCE(a.worked_mins, 0) AS stored_worked_mins
       FROM attendance a
       WHERE a.user_id IN (${placeholders})
         AND a.work_date BETWEEN ? AND ?
       ORDER BY a.work_date`,
      [...userIds, startDate, endDate]
    );

    // Get break totals per user per day
    let breakMap = {}; // key: userId_date → { totalBreakMins, breakCount }
    try {
      const [brkRows] = await db.execute(
        `SELECT user_id,
                work_date AS bdate,
                COUNT(*) AS break_count,
                COALESCE(SUM(duration_min), 0) AS total_break_mins
         FROM breaks
         WHERE user_id IN (${placeholders})
           AND work_date BETWEEN ? AND ?
         GROUP BY user_id, work_date`,
        [...userIds, startDate, endDate]
      );
      brkRows.forEach(r => {
        const key = `${r.user_id}_${String(r.bdate).split('T')[0]}`;
        breakMap[key] = { totalBreakMins: r.total_break_mins || 0, breakCount: r.break_count || 0 };
      });
    } catch(e) {
      // Try with date column
      try {
        const [brkRows] = await db.execute(
          `SELECT user_id, date AS bdate,
                  COUNT(*) AS break_count,
                  COALESCE(SUM(duration_min),0) AS total_break_mins
           FROM breaks
           WHERE user_id IN (${placeholders})
             AND date BETWEEN ? AND ?
           GROUP BY user_id, date`,
          [...userIds, startDate, endDate]
        );
        brkRows.forEach(r => {
          const key = `${r.user_id}_${String(r.bdate).split('T')[0]}`;
          breakMap[key] = { totalBreakMins: r.total_break_mins || 0, breakCount: r.break_count || 0 };
        });
      } catch(e2) {}
    }

    // Build report per user
    const report = users.map(u => {
      const rows = attRows.filter(r => r.user_id === u.id);
      let totalWorkedMins = 0, presentDays = 0, absentDays = 0;
      let totalBreakMins = 0, totalBreakCount = 0;

      const days = [];
      const current = new Date(startDate + 'T00:00:00');
      const endD    = new Date(endDate   + 'T00:00:00');
      const nowD    = new Date();

      while (current <= endD) {
        const dateStr = current.toISOString().split('T')[0];
        const isFuture = current > nowD;

        const row = rows.find(r => {
          const d = typeof r.date === 'string'
            ? r.date.split('T')[0]
            : String(r.date).split('T')[0];
          return d === dateStr;
        });

        if (row && row.login_time) {
          const brk = breakMap[`${u.id}_${dateStr}`] || { totalBreakMins: 0, breakCount: 0 };
          const wm  = row.stored_worked_mins > 0
            ? row.stored_worked_mins
            : calcWorkedMins(row.login_time, row.logout_time, brk.totalBreakMins);

          totalWorkedMins += wm;
          totalBreakMins  += brk.totalBreakMins;
          totalBreakCount += brk.breakCount;
          presentDays++;

          days.push({
            date:            dateStr,
            status:          'present',
            loginTime:       formatTimeStr(row.login_time),
            logoutTime:      formatTimeStr(row.logout_time),
            workedMins:      wm,
            workedFormatted: fmtMins(wm),
            breakMins:       brk.totalBreakMins,
            breakCount:      brk.breakCount,
            targetMet:       wm >= TARGET_HOURS * 60,
            shortfallMins:   Math.max(0, TARGET_HOURS * 60 - wm),
          });
        } else if (!isFuture) {
          absentDays++;
          days.push({
            date: dateStr, status: 'absent',
            workedMins: 0, workedFormatted: '—', targetMet: false, shortfallMins: TARGET_HOURS * 60
          });
        }
        current.setDate(current.getDate() + 1);
      }

      const avgWorkedMins  = presentDays > 0 ? Math.round(totalWorkedMins / presentDays) : 0;
      const totalShortfall = Math.max(0, presentDays * TARGET_HOURS * 60 - totalWorkedMins);

      return {
        userId:               u.id,
        name:                 u.name,
        role:                 u.role,
        presentDays,
        absentDays,
        totalWorkedMins,
        totalWorkedFormatted: fmtMins(totalWorkedMins),
        avgWorkedMins,
        avgWorkedFormatted:   fmtMins(avgWorkedMins),
        totalBreakMins,
        totalBreakCount,
        totalShortfallMins:       totalShortfall,
        totalShortfallFormatted:  fmtMins(totalShortfall),
        days,
      };
    });

    res.json({ success: true, period, startDate, endDate, targetHours: TARGET_HOURS, report });
  } catch (err) {
    console.error('attendance/report error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/attendance/history ───────────────────────
router.get('/history', async (req, res) => {
  try {
    const { id: userId } = req.user;

    const [rows] = await db.execute(
      `SELECT a.work_date AS date, a.login_time, a.logout_time,
              COALESCE(a.worked_mins, 0) AS worked_mins
       FROM attendance a
       WHERE a.user_id = ?
       ORDER BY a.work_date DESC
       LIMIT 30`,
      [userId]
    );

    // Break totals per day
    let breakMap = {};
    try {
      const [brkRows] = await db.execute(
        `SELECT work_date AS bdate, COUNT(*) AS bc, COALESCE(SUM(duration_min),0) AS tbm
         FROM breaks WHERE user_id = ? GROUP BY work_date`,
        [userId]
      );
      brkRows.forEach(r => { breakMap[String(r.bdate).split('T')[0]] = { bc: r.bc, tbm: r.tbm }; });
    } catch(e) {}

    const history = rows.map(r => {
      const dateStr = typeof r.date === 'string' ? r.date.split('T')[0] : String(r.date).split('T')[0];
      const brk = breakMap[dateStr] || { bc: 0, tbm: 0 };
      const wm  = r.worked_mins > 0
        ? r.worked_mins
        : calcWorkedMins(r.login_time, r.logout_time, brk.tbm);
      return {
        date:            dateStr,
        loginTime:       formatTimeStr(r.login_time),
        logoutTime:      formatTimeStr(r.logout_time),
        workedMins:      wm,
        workedFormatted: fmtMins(wm),
        breakCount:      brk.bc,
        totalBreakMins:  brk.tbm,
        targetMet:       wm >= TARGET_HOURS * 60,
      };
    });

    res.json({ success: true, history });
  } catch (err) {
    console.error('attendance/history error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
router.post('/mark', async (req, res) => {
  try {
    const { id: userId, name: userName, role } = req.user;
    const today   = todayDate();
    const nowTime = formatTimeStr(currentTimeStr());
 
    // Check if already logged in today
    const [existing] = await db.execute(
      `SELECT id, login_time FROM attendance WHERE user_id = ? AND work_date = ?`,
      [userId, today]
    );
 
    if (existing.length) {
      // Already has a record today — don't overwrite
      return res.json({
        success: true,
        loginTime: existing[0].login_time,
        alreadyMarked: true
      });
    }
 
    // Create new attendance record
    await db.execute(
      `INSERT INTO attendance (user_id, user_name, role, work_date, date, login_time, status)
       VALUES (?, ?, ?, ?, ?, ?, 'present')`,
      [userId, userName || '', role || '', today, today, nowTime]
    );
 
    res.json({ success: true, loginTime: nowTime, alreadyMarked: false });
  } catch (err) {
    console.error('attendance/mark error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
// ── GET /api/attendance/break/status ─────────────────
// Called on page load to check if user has an active break
router.get('/break/status', async (req, res) => {
  try {
    const { id: userId } = req.user;
    const today = todayDate();
    const nowTime = currentTimeStr();

    const [open] = await db.execute(
      `SELECT id, break_type, start_time 
       FROM breaks 
       WHERE user_id = ? AND work_date = ? AND end_time IS NULL
       ORDER BY id DESC LIMIT 1`,
      [userId, today]
    );

    if (!open.length) {
      return res.json({ success: true, activeBreak: null });
    }

    const brk = open[0];
    const startMins   = timeToMinutes(brk.start_time);
    const currentMins = timeToMinutes(nowTime);
    const elapsedMins = Math.max(0, currentMins - startMins);
    const totalMins   = brk.break_type === 'lunch' ? 30 : 15;
    const remainingMins = Math.max(0, totalMins - elapsedMins);

    res.json({
      success:      true,
      activeBreak: {
        id:            brk.id,
        type:          brk.break_type,
        startTime:     brk.start_time,
        elapsedMins,
        remainingMins,
        remainingSecs: remainingMins * 60,
        totalMins
      }
    });
  } catch (err) {
    console.error('break/status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
// ── ACTIVITY START ────────────────────────────────────
router.post('/activity/start', async (req, res) => {
  try {
    const userId = req.user.id;
    const today  = todayDate();
    const { activityType, topic, withWhom, notes } = req.body;
    await db.execute(
      `INSERT INTO activities (user_id, work_date, activity_type, topic, with_whom, notes, start_time) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, today, activityType, topic||'', withWhom||'', notes||'', currentTimeStr()]
    );
    res.json({ success: true });
  } catch(err) {
    console.error('activity/start error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ACTIVITY STOP ─────────────────────────────────────
router.post('/activity/stop', async (req, res) => {
  try {
    const userId = req.user.id;
    const today  = todayDate();
    const { activityType, durationMins } = req.body;
    await db.execute(
      `UPDATE activities SET end_time = ?, duration_mins = ? WHERE user_id = ? AND work_date = ? AND activity_type = ? AND end_time IS NULL ORDER BY id DESC LIMIT 1`,
      [currentTimeStr(), durationMins||0, userId, today, activityType]
    );
    res.json({ success: true });
  } catch(err) {
    console.error('activity/stop error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ACTIVITY LOG (for admin) ──────────────────────────
router.get('/activity/log', async (req, res) => {
  try {
    const today = todayDate();
    const [rows] = await db.execute(
      `SELECT a.*, u.name, u.username 
       FROM activities a 
       JOIN users u ON a.user_id = u.id 
       WHERE a.work_date = ? 
       ORDER BY a.id DESC`,
      [today]
    );
    res.json({ success: true, activities: rows });
  } catch(err) {
    console.error('activity/log error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
