// src/services/authService.js
// ─────────────────────────────────────────────
// Google OAuth2 authentication & token management
// ─────────────────────────────────────────────

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const TOKEN_PATH = path.join(process.cwd(), 'data', 'tokens.json');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
];

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl() {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // force refresh token
  });
}

async function getTokenFromCode(code) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  saveTokens(tokens);
  oauth2Client.setCredentials(tokens);
  logger.info('✅ Auth tokens saved successfully');
  return oauth2Client;
}

function saveTokens(tokens) {
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
}

async function getAuthenticatedClient() {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error('No auth tokens found. Please authenticate first at /auth/login');
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(tokens);

  // Auto-refresh if expired
  oauth2Client.on('tokens', (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    saveTokens(merged);
    logger.info('🔄 Tokens auto-refreshed');
  });

  return oauth2Client;
}

function isAuthenticated() {
  return fs.existsSync(TOKEN_PATH);
}

module.exports = {
  createOAuth2Client,
  getAuthUrl,
  getTokenFromCode,
  getAuthenticatedClient,
  isAuthenticated,
};
