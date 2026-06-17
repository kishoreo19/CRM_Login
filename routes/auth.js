// =====================================================
// THE GOJOBSYNC CRM — routes/auth.js
// POST /api/auth/login
// POST /api/auth/logout
// GET  /api/auth/me
// =====================================================

const router  = require('express').Router();
const db      = require('../db');
const crypto  = require('crypto');
const { requireAuth } = require('../middleware/auth');

// ── POST /api/auth/login ───────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }

  try {
    // Fetch user (password stored as plain text per original app — upgrade to bcrypt recommended)
    const [rows] = await db.execute(
      'SELECT id, username, password, role, name, empid, doj, img FROM users WHERE username = ?',
      [username.trim().toLowerCase()]
    );

    if (!rows.length || rows[0].password !== password) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    const user = rows[0];

    // Generate session token
    const token = crypto.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours

    // Store session in DB
    await db.execute(
      'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
      [token, user.id, expiresAt]
    );

    // Determine redirect based on role
    const roleRedirects = {
      recruiter:   'crm.html',
      interviewer: 'interview.html',
      hr:          'placement.html',
    };

    res.json({
      success:    true,
      token,
      role:       user.role,
      id:         user.id,
      username:   user.username,
      name:       user.name,
      empid:      user.empid,
      doj:        user.doj,
      img:        user.img,
      redirect:   roleRedirects[user.role] || 'crm.html',
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
});

// ── POST /api/auth/logout ──────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  const token = req.headers['x-session-token'];
  try {
    await db.execute('DELETE FROM sessions WHERE token = ?', [token]);
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err.message);
    res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

// ── GET /api/auth/me ───────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;