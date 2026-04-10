// src/index.js
// ─────────────────────────────────────────────
// YouTube Smart Scheduler — Main Entry Point
// ─────────────────────────────────────────────

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');
const { startScheduler } = require('./services/schedulerService');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve dashboard
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

// ── Routes ────────────────────────────────────
app.use('/', routes);

// Root → dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard', 'index.html'));
});

// ── Health check ──────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── 404 ───────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ─────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// ── Start ─────────────────────────────────────
app.listen(PORT, () => {
  logger.info('');
  logger.info('╔══════════════════════════════════════════╗');
  logger.info('║   YouTube Smart Scheduler  v1.0.0        ║');
  logger.info('╚══════════════════════════════════════════╝');
  logger.info(`🚀 Server running at http://localhost:${PORT}`);
  logger.info(`📊 Dashboard:         http://localhost:${PORT}/`);
  logger.info(`🔑 Authenticate:      http://localhost:${PORT}/auth/login`);
  logger.info('');

  startScheduler();
});

module.exports = app;
