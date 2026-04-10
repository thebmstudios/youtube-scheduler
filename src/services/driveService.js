const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./authService');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

async function downloadFromDrive(fileId, destPath) {
  const auth = await getAuthenticatedClient();
  const drive = google.drive({ version: 'v3', auth });

  logger.info(`📥 Downloading from Drive: ${fileId}`);

  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const dest = fs.createWriteStream(destPath);

  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    response.data
      .on('end', () => { logger.info('✅ Download complete'); resolve(destPath); })
      .on('error', reject)
      .pipe(dest);
  });
}

function extractFileId(driveUrl) {
  const match = driveUrl.match(/[-\w]{25,}/);
  return match ? match[0] : driveUrl;
}

module.exports = { downloadFromDrive, extractFileId };