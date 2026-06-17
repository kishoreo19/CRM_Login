// middleware/auth.js
const db = require('../db');

async function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) {
    return res.status(401).json({ success: false, error: 'No session token provided' });
  }

  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.username, u.role, u.name, u.empid, u.doj
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > NOW()`,
      [token]
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, error: 'Session expired or invalid' });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    res.status(500).json({ success: false, error: 'Auth check failed' });
  }
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    next();
  };
}
module.exports = { requireAuth, requireRole };
