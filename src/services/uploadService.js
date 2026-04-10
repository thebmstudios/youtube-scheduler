// src/services/uploadService.js
// ─────────────────────────────────────────────
// Handles YouTube video uploads via Data API v3
// ─────────────────────────────────────────────

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { getAuthenticatedClient } = require('./authService');
const db = require('./dbService');
const logger = require('../utils/logger');

// ── Upload a video to YouTube ─────────────────
async function uploadVideo(videoConfig) {
  const {
    filePath,
    title,
    description = '',
    tags = [],
    categoryId = '22', // People & Blogs
    privacyStatus = 'public',
    scheduledTime = null,
  } = videoConfig;

  if (!fs.existsSync(filePath)) {
    throw new Error(`Video file not found: ${filePath}`);
  }

  const auth = await getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const fileSize = fs.statSync(filePath).size;
  logger.info(`📤 Uploading: "${title}" (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

  const requestBody = {
    snippet: {
      title,
      description,
      tags,
      categoryId,
    },
    status: {
      privacyStatus: scheduledTime ? 'private' : privacyStatus,
      ...(scheduledTime && { publishAt: new Date(scheduledTime).toISOString() }),
      selfDeclaredMadeForKids: false,
    },
  };

  const media = {
    body: fs.createReadStream(filePath),
  };

  try {
    const response = await youtube.videos.insert(
      {
        part: ['snippet', 'status'],
        requestBody,
        media,
      },
      {
        // Track upload progress
        onUploadProgress: (evt) => {
          const progress = Math.round((evt.bytesRead / fileSize) * 100);
          if (progress % 10 === 0) {
            logger.info(`  Upload progress: ${progress}%`);
          }
        },
      }
    );

    const videoId = response.data.id;
    const videoUrl = `https://youtu.be/${videoId}`;

    logger.info(`✅ Upload complete! Video ID: ${videoId}`);
    logger.info(`   URL: ${videoUrl}`);

    // Save to DB
    db.saveUploadRecord({
      videoId,
      title,
      filePath,
      scheduledTime,
      privacyStatus: requestBody.status.privacyStatus,
      uploadedAt: new Date().toISOString(),
      status: 'uploaded',
    });

    return { videoId, videoUrl, response: response.data };
  } catch (err) {
    logger.error('Upload failed:', err.message);
    db.saveUploadRecord({
      videoId: null,
      title,
      filePath,
      scheduledTime,
      uploadedAt: new Date().toISOString(),
      status: 'failed',
      error: err.message,
    });
    throw err;
  }
}

// ── Schedule upload for a specific time ───────
async function scheduleUpload(videoConfig, targetDateTime) {
  logger.info(`📅 Scheduling upload for: ${new Date(targetDateTime).toLocaleString()}`);

  // Save pending schedule to DB
  const scheduleId = db.saveScheduledUpload({
    ...videoConfig,
    scheduledTime: targetDateTime,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });

  return { scheduleId, scheduledTime: targetDateTime };
}

// ── Execute pending scheduled uploads ─────────
async function executePendingUploads() {
  const pending = db.getPendingUploads();
  const now = Date.now();

  for (const upload of pending) {
    const schedTime = new Date(upload.scheduledTime).getTime();
    if (schedTime <= now) {
      logger.info(`⏰ Executing scheduled upload: ${upload.title}`);
      try {
        await uploadVideo(upload);
        db.updateUploadStatus(upload.id, 'completed');
      } catch (err) {
        logger.error(`Failed scheduled upload ${upload.id}:`, err.message);
        db.updateUploadStatus(upload.id, 'failed');
      }
    }
  }
}

// ── Get channel's upload quota status ─────────
async function checkQuotaStatus() {
  // YouTube API has 10,000 units/day quota
  // Upload costs ~1600 units
  const todayUploads = db.getTodayUploadCount();
  const estimatedUnitsUsed = todayUploads * 1600;
  return {
    uploadsToday: todayUploads,
    estimatedUnitsUsed,
    remainingEstimate: 10000 - estimatedUnitsUsed,
    safeToUpload: estimatedUnitsUsed < 8000,
  };
}

module.exports = { uploadVideo, scheduleUpload, executePendingUploads, checkQuotaStatus };
