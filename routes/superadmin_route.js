// =====================================================
// THE GOJOBSYNC CRM — routes/superadmin.js
// Super Admin: Overview, Candidates, Revenue, Attendance
// Includes SSE (Server-Sent Events) for real-time push
// =====================================================

const router = require('express').Router();
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');

// ── AUTH GUARD: superadmin only ───────────────────────
function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const allowed = ['admin', 'itadmin', 'superadmin'];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Super Admin only' });
  }
  next();
}

router.use(requireAuth);
router.use(requireSuperAdmin);
// 🔴 ADD THIS — prevents 304 caching issues
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// ── SSE CLIENT REGISTRY ───────────────────────────────
// Tracks all connected SSE clients so we can broadcast
const sseClients = new Set();

function broadcastUpdate(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.res.write(payload); } catch (e) { sseClients.delete(client); }
  }
}

// Export broadcaster so other routes can trigger it
router.broadcastUpdate = broadcastUpdate;

// ── GET /api/superadmin/stream  (SSE) ─────────────────
// Client connects once; server pushes updates forever
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx: disable buffering
  res.flushHeaders();

  // Send initial heartbeat
  res.write('event: connected\ndata: {"status":"ok"}\n\n');

  const client = { res, id: Date.now() };
  sseClients.add(client);

  // Heartbeat every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (e) { clearInterval(heartbeat); }
  }, 15000);

  // Push a full snapshot immediately on connect
  _buildSnapshot().then(snap => {
    try { res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`); } catch (e) {}
  });

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
});

// ── GET /api/superadmin/overview ──────────────────────
router.get('/overview', async (req, res) => {
  try {
    const snap = await _buildSnapshot();
    res.json({ success: true, ...snap });
  } catch (err) {
    console.error('SA overview error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/superadmin/candidates ───────────────────
router.get('/candidates', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT c.*, u.name AS recruiter_name
       FROM candidates c
       LEFT JOIN users u ON u.id = c.recruiter_id
       ORDER BY c.id DESC`
    );
    const candidates = rows.map(_mapCandidate);
    res.json({ success: true, candidates });
  } catch (err) {
    console.error('SA candidates error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/superadmin/attendance ───────────────────
router.get('/attendance', async (req, res) => {
  try {
    const staff = await _buildAttendance();
    res.json({ success: true, staff });
  } catch (err) {
    console.error('SA attendance error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/superadmin/revenue ──────────────────────
router.get('/revenue', async (req, res) => {
  try {
    const period  = req.query.period || 'all';
    const FEE     = 5000;
    const now     = new Date();

    // Build date filter
    let dateFilter = '';
    const params = [];
    if (period === 'week') {
      const wa = new Date(now); wa.setDate(wa.getDate() - 7);
      dateFilter = 'AND (c.placed_date >= ? OR c.date >= ?)';
      params.push(wa.toISOString().split('T')[0], wa.toISOString().split('T')[0]);
    } else if (period === 'month') {
      dateFilter = 'AND MONTH(COALESCE(c.placed_date, c.date)) = ? AND YEAR(COALESCE(c.placed_date, c.date)) = ?';
      params.push(now.getMonth() + 1, now.getFullYear());
    } else if (period === 'year') {
      dateFilter = 'AND YEAR(COALESCE(c.placed_date, c.date)) = ?';
      params.push(now.getFullYear());
    }

    const [rows] = await db.execute(
      `SELECT c.id, c.name AS candidate_name, c.placed_date, c.date,
              c.job AS role_placed, c.payment_amount, c.payment_mode,
              u.name AS recruiter_name,
              cl.companyName AS client_name,
              WEEK(COALESCE(c.placed_date, c.date), 1) AS week_number,
              MONTH(COALESCE(c.placed_date, c.date)) AS month_number,
              YEAR(COALESCE(c.placed_date, c.date)) AS year_number
       FROM candidates c
       LEFT JOIN users u ON u.id = c.recruiter_id
       LEFT JOIN clients cl ON cl.id = c.client_id
       WHERE c.status = 'placed' ${dateFilter}
       ORDER BY COALESCE(c.placed_date, c.date) DESC`,
      params
    );

    const entries = rows.map(r => ({
      candidate_name: r.candidate_name || '',
      recruiter_name: r.recruiter_name || '—',
      role_placed:    r.role_placed    || '—',
      client_name:    r.client_name    || '—',
      placement_date: r.placed_date    || r.date || '',
      fee_amount:     r.payment_amount || FEE,
      week_number:    r.week_number,
      month_number:   r.month_number,
      year_number:    r.year_number,
    }));

    // Per-recruiter breakdown
    const recruiterMap = {};
    rows.forEach(r => {
      const key = r.recruiter_name || 'Unknown';
      if (!recruiterMap[key]) {
        recruiterMap[key] = {
          recruiter_name:    key,
          total_revenue:     0,
          revenue_this_week: 0,
          revenue_this_month:0,
          revenue_this_year: 0,
          placements:        0,
        };
      }
      const fee = parseFloat(r.payment_amount || FEE);
      const d   = new Date(r.placed_date || r.date);
      const wa  = new Date(now); wa.setDate(wa.getDate() - 7);
      recruiterMap[key].total_revenue += fee;
      recruiterMap[key].placements    += 1;
      if (d >= wa) recruiterMap[key].revenue_this_week += fee;
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear())
        recruiterMap[key].revenue_this_month += fee;
      if (d.getFullYear() === now.getFullYear())
        recruiterMap[key].revenue_this_year  += fee;
    });

    res.json({ success: true, entries, byRecruiter: Object.values(recruiterMap) });
  } catch (err) {
    console.error('SA revenue error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── HELPERS ───────────────────────────────────────────

async function _buildSnapshot() {
  const FEE = 5000;
  const now = new Date();
  const wa  = new Date(now); wa.setDate(wa.getDate() - 7);
  const waISO    = wa.toISOString().split('T')[0];

  try {
    const [[candStats]] = await db.execute(`
      SELECT
        COUNT(*)                                                      AS total_candidates,
        SUM(status = 'placed')                                        AS total_placed,
        SUM(status = 'scheduled')                                     AS total_scheduled,
        SUM(status = 'submitted')                                     AS total_submitted,
        SUM(status = 'placed' AND (placed_date >= ? OR date >= ?))    AS placed_this_week,
        SUM(status = 'placed' AND MONTH(COALESCE(placed_date,date))=MONTH(NOW()) AND YEAR(COALESCE(placed_date,date))=YEAR(NOW())) AS placed_this_month,
        SUM(status = 'placed' AND YEAR(COALESCE(placed_date,date))=YEAR(NOW()))  AS placed_this_year
      FROM candidates
    `, [waISO, waISO]);

    const [[{ total_clients }]] = await db.execute(
      `SELECT COUNT(*) AS total_clients FROM clients`
    );

    const pw  = (parseInt(candStats.placed_this_week)  || 0) * FEE;
    const pm  = (parseInt(candStats.placed_this_month) || 0) * FEE;
    const py  = (parseInt(candStats.placed_this_year)  || 0) * FEE;

    const [recRows] = await db.execute(`
      SELECT u.name AS recruiter_name,
        COUNT(*) AS placements,
        SUM(COALESCE(c.payment_amount, ?)) AS total_revenue,
        SUM(CASE WHEN (c.placed_date>=? OR c.date>=?) THEN COALESCE(c.payment_amount,?) ELSE 0 END) AS revenue_this_week,
        SUM(CASE WHEN MONTH(COALESCE(c.placed_date,c.date))=MONTH(NOW()) AND YEAR(COALESCE(c.placed_date,c.date))=YEAR(NOW()) THEN COALESCE(c.payment_amount,?) ELSE 0 END) AS revenue_this_month,
        SUM(CASE WHEN YEAR(COALESCE(c.placed_date,c.date))=YEAR(NOW()) THEN COALESCE(c.payment_amount,?) ELSE 0 END) AS revenue_this_year
      FROM candidates c
      LEFT JOIN users u ON u.id = c.recruiter_id
      WHERE c.status = 'placed'
      GROUP BY u.id, u.name
    `, [FEE, waISO, waISO, FEE, FEE, FEE]);

    const staff = await _buildAttendance();

    return {
      overview: {
        total_candidates:   parseInt(candStats.total_candidates)  || 0,
        total_placed:       parseInt(candStats.total_placed)      || 0,
        total_scheduled:    parseInt(candStats.total_scheduled)   || 0,
        total_submitted:    parseInt(candStats.total_submitted)   || 0,
        total_clients:      parseInt(total_clients)               || 0,
        revenue_this_week:  pw,
        revenue_this_month: pm,
        revenue_this_year:  py,
        placed_this_week:   parseInt(candStats.placed_this_week)  || 0,
        placed_this_month:  parseInt(candStats.placed_this_month) || 0,
        placed_this_year:   parseInt(candStats.placed_this_year)  || 0,
        last_updated:       new Date().toISOString(),
      },
      recruiterRevenue: recRows.map(r => ({
        recruiter_name:     r.recruiter_name     || '—',
        placements:         parseInt(r.placements) || 0,
        total_revenue:      parseFloat(r.total_revenue)      || 0,
        revenue_this_week:  parseFloat(r.revenue_this_week)  || 0,
        revenue_this_month: parseFloat(r.revenue_this_month) || 0,
        revenue_this_year:  parseFloat(r.revenue_this_year)  || 0,
      })),
      staff,
    };
  } catch(err) {
    console.error('_buildSnapshot error:', err.message);
    // Return empty snapshot instead of crashing
    return {
      overview: { total_candidates:0, total_placed:0, total_scheduled:0, total_submitted:0, total_clients:0, revenue_this_week:0, revenue_this_month:0, revenue_this_year:0, placed_this_week:0, placed_this_month:0, placed_this_year:0 },
      recruiterRevenue: [],
      staff: [],
    };
  }
}

async function _buildAttendance() {
  const _d = new Date(); const todayISO = new Date(_d.getTime() - _d.getTimezoneOffset() * 60000).toISOString().split('T')[0];

  const [users] = await db.execute(
    `SELECT id, username, name, role FROM users WHERE status = 'active' ORDER BY id`
  );

  // ✅ Your table uses 'work_date', 'login_time', 'logout_time'
  const [attRows] = await db.execute(
    `SELECT a.user_id,
            TIME_FORMAT(a.login_time,  '%h:%i %p') AS loginTime,
            TIME_FORMAT(a.logout_time, '%h:%i %p') AS logoutTime
     FROM attendance a
     WHERE a.work_date = ?`,
    [todayISO]
  );
  const attMap = {};
  attRows.forEach(r => { attMap[r.user_id] = r; });

  // ✅ breaks table uses 'date' column - keep as is
  let breakRows = [];
  try {
    [breakRows] = await db.execute(
      `SELECT b.user_id,
              COUNT(*) AS breakCount,
              COALESCE(SUM(b.duration_min), 0) AS totalBreakMins,
              MAX(b.break_type) AS breakType,
              MAX(CASE WHEN b.end_time IS NULL THEN 1 ELSE 0 END) AS onBreakNow
       FROM breaks b
       WHERE b.date = ?
       GROUP BY b.user_id`,
      [todayISO]
    );
  } catch(e) {
    breakRows = [];
  }
  const breakMap = {};
  breakRows.forEach(r => { breakMap[r.user_id] = r; });

  return users.map(u => {
    const att = attMap[u.id] || {};
    const brk = breakMap[u.id] || {};
    const onBreak  = parseInt(brk.onBreakNow) === 1;
    const loggedIn  = !!att.loginTime;
    const loggedOut = !!att.logoutTime;

    let liveStatus = 'not_logged_in';
    if (loggedIn && !loggedOut && onBreak) liveStatus = 'on_break';
    else if (loggedIn && loggedOut)        liveStatus = 'logged_out';
    else if (loggedIn)                     liveStatus = 'online';

    return {
      id:             u.id,
      username:       u.username,
      name:           u.name || u.username,
      role:           u.role,
      loginTime:      att.loginTime  || null,
      logoutTime:     att.logoutTime || null,
      breakCount:     parseInt(brk.breakCount)     || 0,
      totalBreakMins: parseInt(brk.totalBreakMins) || 0,
      breakType:      brk.breakType || null,
      liveStatus,
    };
  });
}

function _mapCandidate(r) {
  return {
    id:            r.id,
    date:          r.date ? new Date(r.date).toISOString().split("T")[0] : "",
    name:          r.name         || '',
    email:         r.email        || '',
    contact:       r.contact      || '',
    qual:          r.qual         || '',
    job:           r.job          || '',
    expType:       r.expType      || 'Fresher',
    expYears:      r.expYears     || '',
    expMonths:     r.expMonths    || '',
    salary:        r.salary       || '',
    status:        r.status       || 'fresh',
    notes:         r.notes        || '',
    followupDate:  r.followupDate || '',
    followupTime:  r.followupTime || '',
    resumePath:    r.resumePath   || '',
    resumeName:    r.resumeName   || '',
    registered:    !!r.registered,
    recruiter_name: r.recruiter_name || '',
    placed_date:   r.placed_date   || '',
    placed_company: r.placed_company || '',
    preferred_country: r.preferred_country || '',
    enrollment_no: r.enrollment_no || '',
    payment_amount: r.payment_amount || '',
    payment_status: r.payment_status || '',
  };
}

// ── POLL TRIGGER (called by other routes after mutations) ──
// Other route files can require this and call broadcastUpdate
// e.g., after a candidate is updated, attendance marked, etc.
async function triggerBroadcast(event = 'refresh') {
  if (sseClients.size === 0) return; // nobody watching
  try {
    const snap = await _buildSnapshot();
    broadcastUpdate(event, snap);
  } catch (e) {
    console.error('SSE broadcast error:', e.message);
  }
}

router.triggerBroadcast = triggerBroadcast;
router.sseClients       = sseClients;

module.exports = router;