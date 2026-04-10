// src/services/analyticsService.js
// ─────────────────────────────────────────────
// Fetches YouTube Analytics data & computes best posting times
// ─────────────────────────────────────────────

const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./authService');
const db = require('./dbService');
const logger = require('../utils/logger');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Scoring weights ──────────────────────────
const WEIGHTS = {
  views: 0.5,
  watchTime: 0.3,
  avgViewDuration: 0.2,
};

// ── Fetch raw analytics from YouTube API ─────
async function fetchAnalyticsData(channelId, daysBack = 90) {
  const auth = await getAuthenticatedClient();
  const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth });

  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  logger.info(`📊 Fetching analytics: ${startDate} → ${endDate}`);

  try {
    // Fetch hourly data grouped by day of week
    const response = await youtubeAnalytics.reports.query({
      ids: `channel==${channelId}`,
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration',
      dimensions: 'day',
      sort: 'day',
    });

    return response.data.rows || [];
  } catch (err) {
    logger.error('Analytics API error:', err.message);
    throw err;
  }
}

// ── Process raw rows into hour/day buckets ────
function processAnalyticsRows(rows) {
  // Structure: { dayOfWeek: { hour: { views, watchTime, avgDuration, count } } }
  const buckets = {};

  for (let d = 0; d < 7; d++) {
    buckets[d] = {};
    for (let h = 0; h < 24; h++) {
      buckets[d][h] = { views: 0, watchTime: 0, avgViewDuration: 0, count: 0 };
    }
  }

  rows.forEach(([dateStr, views, watchTime, avgDuration]) => {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const h = date.getHours();

    buckets[dayOfWeek][h].views += views || 0;
    buckets[dayOfWeek][h].watchTime += watchTime || 0;
    buckets[dayOfWeek][h].avgViewDuration += avgDuration || 0;
    buckets[dayOfWeek][h].count += 1;
  });

  // Average the duration
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const b = buckets[d][h];
      if (b.count > 0) b.avgViewDuration /= b.count;
    }
  }

  return buckets;
}

// ── Score each hour slot ──────────────────────
function scoreHour(bucket, maxViews, maxWatchTime, maxDuration) {
  const normViews = maxViews > 0 ? bucket.views / maxViews : 0;
  const normWatch = maxWatchTime > 0 ? bucket.watchTime / maxWatchTime : 0;
  const normDur = maxDuration > 0 ? bucket.avgViewDuration / maxDuration : 0;

  return (
    normViews * WEIGHTS.views +
    normWatch * WEIGHTS.watchTime +
    normDur * WEIGHTS.avgViewDuration
  );
}

// ── Full analysis: find best times ───────────
function analyzeOptimalTimes(buckets) {
  // Find global maxima for normalization
  let maxViews = 0, maxWatchTime = 0, maxDuration = 0;

  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const b = buckets[d][h];
      if (b.views > maxViews) maxViews = b.views;
      if (b.watchTime > maxWatchTime) maxWatchTime = b.watchTime;
      if (b.avgViewDuration > maxDuration) maxDuration = b.avgViewDuration;
    }
  }

  const weeklySchedule = {};
  const allSlots = [];

  for (let d = 0; d < 7; d++) {
    const hourScores = [];

    for (let h = 0; h < 24; h++) {
      const b = buckets[d][h];
      const score = scoreHour(b, maxViews, maxWatchTime, maxDuration);
      hourScores.push({ hour: h, score, ...b });
      allSlots.push({ day: d, dayName: DAYS[d], hour: h, score, ...b });
    }

    // Sort by score descending
    hourScores.sort((a, b) => b.score - a.score);

    weeklySchedule[DAYS[d]] = {
      top3Hours: hourScores.slice(0, 3).map((s) => ({
        hour: s.hour,
        label: formatHour(s.hour),
        score: Math.round(s.score * 100) / 100,
        views: Math.round(s.views),
        watchTimeMin: Math.round(s.watchTime),
      })),
      bestHour: hourScores[0],
    };
  }

  // Global top 5 slots
  allSlots.sort((a, b) => b.score - a.score);
  const top5Overall = allSlots.slice(0, 5).map((s) => ({
    day: s.dayName,
    hour: s.hour,
    label: `${s.dayName} at ${formatHour(s.hour)}`,
    score: Math.round(s.score * 100) / 100,
    views: Math.round(s.views),
  }));

  return { weeklySchedule, top5Overall, analyzedAt: new Date().toISOString() };
}

// ── Helper ────────────────────────────────────
function formatHour(h) {
  const period = h < 12 ? 'AM' : 'PM';
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:00 ${period}`;
}

// ── Main entry: run full analysis ─────────────
async function runAnalysis() {
  logger.info('🚀 Starting YouTube analytics analysis...');

  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  if (!channelId) throw new Error('YOUTUBE_CHANNEL_ID not set in .env');

  const rows = await fetchAnalyticsData(channelId);
  logger.info(`📦 Fetched ${rows.length} data rows`);

  const buckets = processAnalyticsRows(rows);
  const results = analyzeOptimalTimes(buckets);

  // Persist to DB
  db.saveAnalysisResults(results);
  logger.info('💾 Analysis saved to database');
  logger.info('🏆 Top 5 posting times:');
  results.top5Overall.forEach((s, i) => {
    logger.info(`  ${i + 1}. ${s.label} — score: ${s.score}`);
  });

  return results;
}

module.exports = { runAnalysis, fetchAnalyticsData, processAnalyticsRows, analyzeOptimalTimes };