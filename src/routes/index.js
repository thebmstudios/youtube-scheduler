// src/routes/index.js
// ─────────────────────────────────────────────
// All API routes
// ─────────────────────────────────────────────

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const { getAuthUrl, getTokenFromCode, isAuthenticated } = require('../services/authService');
const { runAnalysis } = require('../services/analyticsService');
const { uploadVideo, scheduleUpload, checkQuotaStatus } = require('../services/uploadService');
const { autoScheduleNextUpload } = require('../services/schedulerService');
const db = require('../services/dbService');
const logger = require('../utils/logger');

// ── File upload storage ───────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './data/videos';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 * 1024 } }); // 10GB

// ── Auth ──────────────────────────────────────
router.get('/auth/status', (req, res) => {
  res.json({ authenticated: isAuthenticated() });
});

router.get('/auth/login', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

router.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'No code provided' });
    await getTokenFromCode(code);
    res.redirect('/?auth=success');
  } catch (err) {
    logger.error('Auth callback error:', err.message);
    res.redirect('/?auth=error');
  }
});

// ── Analytics ─────────────────────────────────
router.post('/api/analyze', async (req, res) => {
  try {
    const results = await runAnalysis();
    res.json({ success: true, results });
  } catch (err) {
    logger.error('Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/analysis/latest', (req, res) => {
  const analysis = db.getLatestAnalysis();
  if (!analysis) return res.status(404).json({ error: 'No analysis data yet. Run /api/analyze first.' });
  res.json(analysis);
});

router.get('/api/analysis/history', (req, res) => {
  res.json(db.getAnalysisHistory());
});

// ── Uploads ───────────────────────────────────
router.get('/api/uploads/quota', async (req, res) => {
  try {
    const quota = await checkQuotaStatus();
    res.json(quota);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/uploads/scheduled', (req, res) => {
  res.json(db.getAllScheduledUploads());
});

router.get('/api/uploads/recent', (req, res) => {
  res.json(db.getRecentUploads());
});

router.delete('/api/uploads/scheduled/:id', (req, res) => {
  db.deleteScheduledUpload(parseInt(req.params.id, 10));
  res.json({ success: true });
});

// Schedule upload manually
router.post('/api/uploads/schedule', upload.single('video'), async (req, res) => {
  try {
    const { title, description, tags, categoryId, privacyStatus, scheduledTime } = req.body;
    const filePath = req.file ? req.file.path : req.body.filePath;

    if (!filePath) return res.status(400).json({ error: 'No video file provided' });
    if (!scheduledTime) return res.status(400).json({ error: 'scheduledTime is required' });

    const result = await scheduleUpload({
      title: title || 'Untitled',
      filePath,
      description,
      tags: tags ? JSON.parse(tags) : [],
      categoryId,
      privacyStatus,
    }, scheduledTime);

    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Schedule error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Auto-schedule using analytics data
router.post('/api/uploads/auto-schedule', upload.single('video'), async (req, res) => {
  try {
    const { title, description, tags, categoryId } = req.body;
    const filePath = req.file ? req.file.path : req.body.filePath;

    if (!filePath) return res.status(400).json({ error: 'No video file provided' });

    const result = await autoScheduleNextUpload({
      title: title || 'Untitled',
      filePath,
      description,
      tags: tags ? JSON.parse(tags) : [],
      categoryId,
    });

    if (!result) {
      return res.status(400).json({ error: 'Could not determine optimal slot. Run /api/analyze first.' });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Auto-schedule error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Upload immediately
router.post('/api/uploads/now', upload.single('video'), async (req, res) => {
  try {
    const { title, description, tags, categoryId, privacyStatus } = req.body;
    const filePath = req.file ? req.file.path : req.body.filePath;

    if (!filePath) return res.status(400).json({ error: 'No video file provided' });

    const result = await uploadVideo({
      title: title || 'Untitled',
      filePath, description,
      tags: tags ? JSON.parse(tags) : [],
      categoryId, privacyStatus,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Notifications ─────────────────────────────
router.get('/api/notifications', (req, res) => {
  res.json(db.getUnreadNotifications());
});

router.post('/api/notifications/read', (req, res) => {
  db.markNotificationsRead();
  res.json({ success: true });
});

module.exports = router;
