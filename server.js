// =====================================================
// THE GOJOBSYNC CRM — server.js
// Main Express server
// =====================================================
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express(); // ← app must be created FIRST

// ── MIDDLEWARE ────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── STATIC FILES ──────────────────────────────────────
app.use(express.static(path.join(__dirname, 'Frontend')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.use("/api", require("./routes/frontend_auth"));
// ── API ROUTES ────────────────────────────────────────
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/register', require('./routes/register'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/candidates', require('./routes/candidates'));
app.use('/api/clients',    require('./routes/clients'));
app.use('/api/uploads',    require('./routes/uploads'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/users',      require('./routes/users'));

// ── SUPERADMIN + SSE (must come AFTER app is created) ──
const saRouter = require('./routes/superadmin_route');
app.use('/api/superadmin', saRouter);
require('./utils/sseBroadcast').register(saRouter); // 🔴 registers SSE broadcaster

// ── HEALTH CHECK ──────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date() }));


// ── ADMIN PANEL ──────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'testing/Frontend/pages/_gjs_panel.html'));
});

// ── SPA FALLBACK ──────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'Frontend', 'login.html'));
});

// ── ERROR HANDLER ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── START ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 JobSync CRM running on http://localhost:${PORT}`);
  console.log(`   Login: http://localhost:${PORT}/login.html\n`);
});

