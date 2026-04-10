const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const { getAuthUrl, getTokenFromCode, isAuthenticated } = require('../services/authService');
const { runAnalysis } = require('../services/analyticsService');
const { uploadVideo, scheduleUpload, checkQuotaStatus } = require('../services/uploadService');
const { autoScheduleNextUpload } = require('../services/schedulerService');
const { downloadFromDrive, extractFileId } = require('../services/driveService');
const db = require('../services/dbService');
const logger = require('../utils/logger');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './data/videos';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 * 1024 } });

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

router.post('/api/analyze', async (req, res) => {
  try {
    const results = await runAnalysis();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/analysis/latest', (req, res) => {
  const analysis = db.getLatestAnalysis();
  if (!analysis) return res.status(404).json({ error: 'No analysis data yet.' });
  res.json(analysis);
});

router.get('/api/analysis/history', (req, res) => {
  res.json(db.getAnalysisHistory());
});

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

router.post('/api/uploads/schedule', upload.single('video'), async (req, res) => {
  try {
    const { title, description, tags, categoryId, privacyStatus, scheduledTime } = req.body;
    const filePath = req.file ? req.file.path : req.body.filePath;
    if (!filePath) return res.status(400).json({ error: 'No video file provided' });
    if (!scheduledTime) return res.status(400).json({ error: 'scheduledTime is required' });
    const result = await scheduleUpload({
      title: title || 'Untitled', filePath, description,
      tags: tags ? JSON.parse(tags) : [], categoryId, privacyStatus,
    }, scheduledTime);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/uploads/auto-schedule', upload.single('video'), async (req, res) => {
  try {
    const { title, description, tags, categoryId } = req.body;
    const filePath = req.file ? req.file.path : req.body.filePath;
    if (!filePath) return res.status(400).json({ error: 'No video file provided' });
    const result = await autoScheduleNextUpload({
      title: title || 'Untitled', filePath, description,
      tags: tags ? JSON.parse(tags) : [], categoryId,
    });
    if (!result) return res.status(400).json({ error: 'Run /api/analyze first.' });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/uploads/now', upload.single('video'), async (req, res) => {
  try {
    const { title, description, tags, categoryId, privacyStatus } = req.body;
    const filePath = req.file ? req.file.path : req.body.filePath;
    if (!filePath) return res.status(400).json({ error: 'No video file provided' });
    const result = await uploadVideo({
      title: title || 'Untitled', filePath, description,
      tags: tags ? JSON.parse(tags) : [], categoryId, privacyStatus,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Google Drive entegrasyonu ─────────────────
router.post('/api/uploads/drive-schedule', async (req, res) => {
  try {
    const { driveUrl, title, description, tags, scheduledTime } = req.body;
    if (!driveUrl) return res.status(400).json({ error: 'driveUrl required' });

    const fileId = extractFileId(driveUrl);
    const filePath = `./data/videos/${fileId}.mp4`;

    logger.info(`📥 Drive'dan indiriliyor: ${fileId}`);
    await downloadFromDrive(fileId, filePath);

    const videoConfig = {
      title: title || 'Untitled', filePath, description,
      tags: tags || [], privacyStatus: 'public',
    };

    let result;
    if (scheduledTime) {
      result = await scheduleUpload(videoConfig, scheduledTime);
    } else {
      result = await autoScheduleNextUpload(videoConfig);
    }

    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Drive schedule error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/notifications', (req, res) => {
  res.json(db.getUnreadNotifications());
});

router.post('/api/notifications/read', (req, res) => {
  db.markNotificationsRead();
  res.json({ success: true });
});

module.exports = router;