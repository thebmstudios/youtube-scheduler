// src/services/schedulerService.js
// ─────────────────────────────────────────────
// Cron-based scheduler for analysis & uploads
// ─────────────────────────────────────────────

const cron = require('node-cron');
const { runAnalysis } = require('./analyticsService');
const { executePendingUploads } = require('./uploadService');
const db = require('./dbService');
const logger = require('../utils/logger');

let analysisJob = null;
let uploadCheckJob = null;

// ── Start all scheduled jobs ──────────────────
function startScheduler() {
  logger.info('⏱️  Starting scheduler...');

  // Re-analyze every 24 hours at midnight
  const intervalHours = parseInt(process.env.REANALYZE_INTERVAL_HOURS || '24', 10);
  const analysisCron = intervalHours === 24 ? '0 0 * * *' : `0 */${intervalHours} * * *`;

  analysisJob = cron.schedule(analysisCron, async () => {
    logger.info('🔄 Scheduled re-analysis starting...');
    try {
      await runAnalysis();
      db.addNotification('info', 'Analytics re-analysis completed successfully');
    } catch (err) {
      logger.error('Scheduled analysis failed:', err.message);
      db.addNotification('error', `Analytics analysis failed: ${err.message}`);
    }
  });

  // Check for pending uploads every minute
  uploadCheckJob = cron.schedule('* * * * *', async () => {
    try {
      await executePendingUploads();
    } catch (err) {
      logger.error('Upload check failed:', err.message);
    }
  });

  logger.info(`  ✅ Analysis job: every ${intervalHours} hours`);
  logger.info('  ✅ Upload check job: every minute');
}

// ── Stop all jobs ─────────────────────────────
function stopScheduler() {
  if (analysisJob) analysisJob.stop();
  if (uploadCheckJob) uploadCheckJob.stop();
  logger.info('⏹️  Scheduler stopped');
}

// ── Auto-schedule next upload based on analytics
async function autoScheduleNextUpload(videoConfig) {
  const analysis = db.getLatestAnalysis();
  if (!analysis) {
    logger.warn('No analysis data available. Run analysis first.');
    db.addNotification('warning', 'Auto-schedule failed: no analysis data. Run /api/analyze first.');
    return null;
  }

  // Find next best slot from now
  const now = new Date();
  const candidates = [];

  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + daysAhead);
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][targetDate.getDay()];
    const daySchedule = analysis.weeklySchedule[dayName];

    if (!daySchedule) continue;

    for (const slot of daySchedule.top3Hours) {
      const slotTime = new Date(targetDate);
      slotTime.setHours(slot.hour, 0, 0, 0);

      // Must be at least 30 minutes in the future
      if (slotTime.getTime() > now.getTime() + 30 * 60 * 1000) {
        candidates.push({
          time: slotTime,
          score: slot.score,
          label: `${dayName} at ${slot.label}`,
        });
      }
    }
  }

  if (candidates.length === 0) {
    logger.warn('No valid future slots found');
    return null;
  }

  // Pick highest scoring future slot
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  logger.info(`🎯 Auto-scheduled for: ${best.label} (score: ${best.score})`);

  const { scheduleUpload } = require('./uploadService');
  const result = await scheduleUpload(videoConfig, best.time.toISOString());

  db.addNotification(
    'success',
    `Video "${videoConfig.title}" auto-scheduled for ${best.label}`
  );

  return { ...result, slotLabel: best.label, score: best.score };
}

module.exports = { startScheduler, stopScheduler, autoScheduleNextUpload };
