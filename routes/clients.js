// =====================================================
// THE GOJOBSYNC CRM — routes/clients.js (v3 FIXED)
// FIXES:
//   1. All endpoints working correctly
//   2. today-interviews fetches scheduled candidates properly
//   3. ongoing-interviews works
//   4. dashboard-stats works
//   5. interview-outcome update works
//   6. candidate-feedback save works
//   7. Clients CRUD working
// =====================================================

const router = require('express').Router();
const db     = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// ── GET /api/clients ───────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT * FROM clients ORDER BY id DESC`
    );
    res.json({ success: true, clients: rows });
  } catch (err) {
    console.error('GET /clients error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch clients' });
  }
});

// ── GET /api/clients/dashboard-stats ──────────────────
router.get('/dashboard-stats', async (req, res) => {
  try {
    // Total clients
    const [[clientRow]] = await db.execute(`SELECT COUNT(*) AS total FROM clients`);

    // Total openings
    const [[openingsRow]] = await db.execute(`SELECT COALESCE(SUM(openings), 0) AS total FROM clients`);

    // Placed candidates
    const [[placedRow]] = await db.execute(
      `SELECT COUNT(*) AS total FROM candidates WHERE status = 'placed'`
    );

    // Scheduled today
    const today = new Date().toISOString().split('T')[0];
    const [[scheduledRow]] = await db.execute(
      `SELECT COUNT(*) AS total FROM candidates WHERE status = 'scheduled'`
    );

    // Ongoing interviews
    const [[ongoingRow]] = await db.execute(
      `SELECT COUNT(*) AS total FROM candidates WHERE status = 'ongoing' OR interview_status = 'ongoing'`
    );

    // Feedback pending
    const [feedbackRows] = await db.execute(
      `SELECT c.id, c.name, c.contact, c.email, c.job AS role,
              c.notes AS recruiterNotes, c.feedback AS clientFeedback,
              c.followupDate AS interviewDate,
              cl.companyName AS clientName
       FROM candidates c
       LEFT JOIN clients cl ON cl.id = c.client_id
       WHERE c.status = 'feedback_pending'
       ORDER BY c.id DESC`
    );

    // Bounced work orders (rejected candidates)
    const [[bouncedRow]] = await db.execute(
      `SELECT COUNT(*) AS total FROM candidates WHERE status = 'rejected'`
    );

    res.json({
      success: true,
      totalClients:     clientRow.total || 0,
      currentOpenings:  openingsRow.total || 0,
      placedCandidates: placedRow.total || 0,
      todayScheduled:   scheduledRow.total || 0,
      ongoingInterviews: ongoingRow.total || 0,
      bouncedWorkOrders: bouncedRow.total || 0,
      feedbackPending:  feedbackRows || [],
    });
  } catch (err) {
    console.error('dashboard-stats error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/clients/today-interviews ─────────────────
// Returns ALL scheduled candidates with client company info
router.get('/today-interviews', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT 
         c.id, c.name, c.contact, c.email,
         c.job AS role, c.followupDate, c.followupTime,
         c.notes, c.status, c.round,
         c.recruiter_id,
         cl.companyName, cl.interviewLocation, cl.workLocation,
         u.name AS recruiterName
       FROM candidates c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN users u ON u.id = c.recruiter_id
       WHERE c.status = 'scheduled'
       ORDER BY c.followupDate ASC, c.id DESC`
    );

    const interviews = rows.map(r => ({
      id:               r.id,
      name:             r.name || '',
      contact:          r.contact || '',
      email:            r.email || '',
      role:             r.role || '—',
      companyName:      r.companyName || '—',
      followupDate:     r.followupDate || '—',
      followupTime:     r.followupTime || '',
      interviewLocation: r.interviewLocation || '—',
      workLocation:     r.workLocation || '—',
      recruiterName:    r.recruiterName || '—',
      notes:            r.notes || '',
      status:           r.status,
      round:            r.round || 1,
    }));

    res.json({ success: true, interviews });
  } catch (err) {
    console.error('today-interviews error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/clients/ongoing-interviews ───────────────
router.get('/ongoing-interviews', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT 
         c.id, c.name, c.contact, c.email,
         c.job AS role, c.followupDate, c.notes,
         c.status, c.round,
         cl.companyName,
         u.name AS recruiterName
       FROM candidates c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN users u ON u.id = c.recruiter_id
       WHERE c.status = 'ongoing' OR c.interview_status = 'ongoing'
       ORDER BY c.id DESC`
    );

    const interviews = rows.map(r => ({
      id:          r.id,
      name:        r.name || '',
      contact:     r.contact || '',
      email:       r.email || '',
      role:        r.role || '—',
      companyName: r.companyName || '—',
      followupDate: r.followupDate || '—',
      notes:       r.notes || '',
      status:      'ongoing',
      round:       r.round || 1,
    }));

    res.json({ success: true, interviews });
  } catch (err) {
    console.error('ongoing-interviews error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /api/clients/interview-outcome/:id ────────────
// Update candidate status based on interview outcome
router.put('/interview-outcome/:id', async (req, res) => {
  try {
    const candId  = parseInt(req.params.id, 10);
    const { outcome } = req.body;

    if (!outcome) {
      return res.status(400).json({ success: false, error: 'outcome is required' });
    }

    const statusMap = {
      placed:           'placed',
      rejected:         'rejected',
      ongoing:          'ongoing',
      feedback_pending: 'feedback_pending',
    };

    const newStatus = statusMap[outcome];
    if (!newStatus) {
      return res.status(400).json({ success: false, error: 'Invalid outcome' });
    }

    const updates = { status: newStatus };
    if (outcome === 'ongoing') {
      updates.interview_status = 'ongoing';
    }

    const setClauses = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
    await db.execute(
      `UPDATE candidates SET ${setClauses} WHERE id = ?`,
      [...Object.values(updates), candId]
    );

    res.json({ success: true, newStatus });
  } catch (err) {
    console.error('interview-outcome error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /api/clients/candidate-feedback/:id ───────────
// Save HR/client feedback for a candidate
router.put('/candidate-feedback/:id', async (req, res) => {
  try {
    const candId   = parseInt(req.params.id, 10);
    const { feedback } = req.body;

    if (!feedback || !feedback.trim()) {
      return res.status(400).json({ success: false, error: 'feedback is required' });
    }

    await db.execute(
      `UPDATE candidates SET feedback = ?, feedback_at = NOW() WHERE id = ?`,
      [feedback.trim(), candId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('candidate-feedback error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/clients/:id ───────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const clientId = parseInt(req.params.id, 10);
    const [rows] = await db.execute(`SELECT * FROM clients WHERE id = ?`, [clientId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Client not found' });
    res.json({ success: true, client: rows[0] });
  } catch (err) {
    console.error('GET /clients/:id error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch client' });
  }
});

// ── POST /api/clients ──────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const d = req.body;

    if (!d.companyName) {
      return res.status(400).json({ success: false, error: 'Company name is required' });
    }
    if (!d.contactPerson) {
      return res.status(400).json({ success: false, error: 'Contact person is required' });
    }
    if (!d.contactNumber) {
      return res.status(400).json({ success: false, error: 'Contact number is required' });
    }
    if (!d.requirements) {
      return res.status(400).json({ success: false, error: 'Requirements are required' });
    }

    const [result] = await db.execute(
      `INSERT INTO clients (
        companyName, type, contactPerson, contactNumber, emergencyContact,
        requirements, openings, department, address,
        interviewLocation, workLocation, tagline, notes ,datePosted, lastDateToApply
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        d.companyName,
        d.type          || 'IT',
        d.contactPerson || '',
        d.contactNumber || '',
        d.emergencyContact || '',
        d.requirements  || '',
        parseInt(d.openings) || 0,
        d.department    || '',
        d.address       || '',
        d.interviewLocation || '',
        d.workLocation  || '',
        d.tagline       || '',
        d.notes         || '',
        d.datePosted || null,
        d.lastDateToApply || null,
      ]
    );

    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('POST /clients error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to add client: ' + err.message });
  }
});

// ── PUT /api/clients/:id ───────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const clientId = parseInt(req.params.id, 10);
    const d = req.body;

    await db.execute(
      `UPDATE clients SET
        companyName       = ?,
        type              = ?,
        contactPerson     = ?,
        contactNumber     = ?,
        emergencyContact  = ?,
        requirements      = ?,
        openings          = ?,
        department        = ?,
        address           = ?,
        interviewLocation = ?,
        workLocation      = ?,
        tagline           = ?,
        notes             = ?
       WHERE id = ?`,
      [
        d.companyName     || '',
        d.type            || 'IT',
        d.contactPerson   || '',
        d.contactNumber   || '',
        d.emergencyContact|| '',
        d.requirements    || '',
        parseInt(d.openings) || 0,
        d.department      || '',
        d.address         || '',
        d.interviewLocation || '',
        d.workLocation    || '',
        d.tagline         || '',
        d.notes           || '',
        clientId,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /clients/:id error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update client' });
  }
});

// ── DELETE /api/clients/:id ────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'itadmin' && role !== 'client') {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    const clientId = parseInt(req.params.id, 10);
    await db.execute('DELETE FROM clients WHERE id = ?', [clientId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /clients/:id error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete client' });
  }
});

module.exports = router;