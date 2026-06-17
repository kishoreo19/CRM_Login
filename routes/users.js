// =====================================================
// THE GOJOBSYNC CRM — routes/users.js
// User Management: Create / Read / Update / Delete / Reset Password
// Admin & itadmin only (except GET self)
// =====================================================

const router = require('express').Router();
const db     = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// ── GET /api/users ────────────────────────────────────
// Admin: all users | Others: only themselves
router.get('/', async (req, res) => {
  try {
    const { role, id } = req.user;

    let rows;
    if (role === 'admin' || role === 'itadmin') {
      [rows] = await db.execute(
        `SELECT id, username, role, name, empid, doj, img, status, created_at
         FROM users ORDER BY id ASC`
      );
    } else {
      [rows] = await db.execute(
        `SELECT id, username, role, name, empid, doj, img, status, created_at
         FROM users WHERE id = ?`,
        [id]
      );
    }

    res.json({ success: true, users: rows });
  } catch (err) {
    console.error('GET /users error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

// ── GET /api/users/:id ────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { role, id: selfId } = req.user;
    const targetId = parseInt(req.params.id, 10);

    if (role !== 'admin' && role !== 'itadmin' && selfId !== targetId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const [rows] = await db.execute(
      `SELECT id, username, role, name, empid, doj, img, status, created_at
       FROM users WHERE id = ?`,
      [targetId]
    );

    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
});

// ── POST /api/users ───────────────────────────────────
// Create new user — admin/itadmin only
router.post('/', requireRole('admin', 'itadmin'), async (req, res) => {
  try {
    const { username, password, role, name, empid, doj, img, status } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ success: false, error: 'username, password, and role are required' });
    }

    // Check username uniqueness
    const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existing.length) {
      return res.status(409).json({ success: false, error: 'Username already exists' });
    }

    const validRoles = ['recruiter', 'interviewer', 'hr', 'client', 'admin', 'itadmin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }

    const [result] = await db.execute(
      `INSERT INTO users (username, password, role, name, empid, doj, img, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username.trim(),
        password,           // In production: hash with bcrypt
        role,
        name    || '',
        empid   || '',
        doj     || '',
        img     || '',
        status  || 'active',
      ]
    );

    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('POST /users error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Username already exists' });
    }
    res.status(500).json({ success: false, error: 'Failed to create user' });
  }
});

// ── PUT /api/users/:id ────────────────────────────────
// Update user — admin/itadmin only (can update any), others can update self (limited fields)
router.put('/:id', async (req, res) => {
  try {
    const { role: callerRole, id: selfId } = req.user;
    const targetId = parseInt(req.params.id, 10);

    const isAdmin = callerRole === 'admin' || callerRole === 'itadmin';
    const isSelf  = selfId === targetId;

    if (!isAdmin && !isSelf) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const d = req.body;
    const updates = {};

    // Fields admin can change
    if (isAdmin) {
      if (d.username !== undefined) updates.username = d.username.trim();
      if (d.role     !== undefined) updates.role     = d.role;
      if (d.empid    !== undefined) updates.empid    = d.empid;
      if (d.doj      !== undefined) updates.doj      = d.doj;
      if (d.status   !== undefined) updates.status   = d.status;
    }

    // Fields anyone can change on self (or admin on any)
    if (isAdmin || isSelf) {
      if (d.name !== undefined) updates.name = d.name;
      if (d.img  !== undefined) updates.img  = d.img;
    }

    // Password update (only if provided)
    if (d.password && d.password.trim()) {
      updates.password = d.password;  // Hash in production
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    // Check username uniqueness if changing username
    if (updates.username) {
      const [dup] = await db.execute(
        'SELECT id FROM users WHERE username = ? AND id != ?',
        [updates.username, targetId]
      );
      if (dup.length) {
        return res.status(409).json({ success: false, error: 'Username already exists' });
      }
    }

    const setClauses = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
    await db.execute(
      `UPDATE users SET ${setClauses} WHERE id = ?`,
      [...Object.values(updates), targetId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /users/:id error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

// ── PUT /api/users/:id/password ───────────────────────
// Reset password — admin/itadmin only
router.put('/:id/password', requireRole('admin', 'itadmin'), async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const { password } = req.body;

    if (!password || password.trim().length < 4) {
      return res.status(400).json({ success: false, error: 'Password must be at least 4 characters' });
    }

    // Invalidate existing sessions for this user
    await db.execute('DELETE FROM sessions WHERE user_id = ?', [targetId]);

    await db.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [password, targetId]   // Hash in production
    );

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /users/:id/password error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update password' });
  }
});

// ── DELETE /api/users/:id ─────────────────────────────
// Admin/itadmin only — cannot delete self
router.delete('/:id', requireRole('admin', 'itadmin'), async (req, res) => {
  try {
    const { id: selfId } = req.user;
    const targetId = parseInt(req.params.id, 10);

    if (selfId === targetId) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    }

    // Check user exists
    const [rows] = await db.execute('SELECT id FROM users WHERE id = ?', [targetId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found' });

    // Delete sessions first
    await db.execute('DELETE FROM sessions WHERE user_id = ?', [targetId]);

    await db.execute('DELETE FROM users WHERE id = ?', [targetId]);

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /users/:id error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

module.exports = router;