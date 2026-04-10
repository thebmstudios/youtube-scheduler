const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/scheduler.db.json';
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const adapter = new FileSync(DB_PATH);
const db = low(adapter);

db.defaults({
  analysis_results: [],
  scheduled_uploads: [],
  upload_records: [],
  notifications: [],
  _nextId: { analysis: 1, scheduled: 1, records: 1, notifications: 1 },
}).write();

function nextId(table) {
  const id = db.get(`_nextId.${table}`).value();
  db.set(`_nextId.${table}`, id + 1).write();
  return id;
}

function saveAnalysisResults(results) {
  db.get('analysis_results').push({ id: nextId('analysis'), data: JSON.stringify(results), analyzed_at: results.analyzedAt, created_at: new Date().toISOString() }).write();
}
function getLatestAnalysis() {
  const rows = db.get('analysis_results').value();
  if (!rows.length) return null;
  const row = rows[rows.length - 1];
  return { ...JSON.parse(row.data), id: row.id, dbCreatedAt: row.created_at };
}
function getAnalysisHistory(limit = 10) {
  return db.get('analysis_results').value().slice(-limit).reverse().map(r => ({ id: r.id, analyzed_at: r.analyzed_at, created_at: r.created_at }));
}
function saveScheduledUpload(upload) {
  const id = nextId('scheduled');
  db.get('scheduled_uploads').push({ id, title: upload.title, file_path: upload.filePath, description: upload.description || '', tags: JSON.stringify(upload.tags || []), category_id: upload.categoryId || '22', privacy_status: upload.privacyStatus || 'public', scheduled_time: upload.scheduledTime, status: 'pending', video_id: null, error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).write();
  return id;
}
function getPendingUploads() {
  return db.get('scheduled_uploads').filter({ status: 'pending' }).value().map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
}
function getAllScheduledUploads() {
  return db.get('scheduled_uploads').value().sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time)).map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
}
function updateUploadStatus(id, status, videoId = null) {
  db.get('scheduled_uploads').find({ id }).assign({ status, video_id: videoId, updated_at: new Date().toISOString() }).write();
}
function deleteScheduledUpload(id) {
  db.get('scheduled_uploads').remove({ id }).write();
}
function saveUploadRecord(record) {
  db.get('upload_records').push({ id: nextId('records'), video_id: record.videoId, title: record.title, file_path: record.filePath, scheduled_time: record.scheduledTime, privacy_status: record.privacyStatus, uploaded_at: record.uploadedAt, status: record.status, error: record.error || null }).write();
}
function getTodayUploadCount() {
  const today = new Date().toISOString().split('T')[0];
  return db.get('upload_records').filter(r => r.status === 'uploaded' && r.uploaded_at && r.uploaded_at.startsWith(today)).value().length;
}
function getRecentUploads(limit = 20) {
  return db.get('upload_records').value().slice(-limit).reverse();
}
function addNotification(type, message) {
  db.get('notifications').push({ id: nextId('notifications'), type, message, read: 0, created_at: new Date().toISOString() }).write();
}
function getUnreadNotifications() {
  return db.get('notifications').filter({ read: 0 }).value().reverse();
}
function markNotificationsRead() {
  db.get('notifications').filter({ read: 0 }).each(n => { n.read = 1; }).write();
}

module.exports = {
  saveAnalysisResults, getLatestAnalysis, getAnalysisHistory,
  saveScheduledUpload, getPendingUploads, getAllScheduledUploads,
  updateUploadStatus, deleteScheduledUpload,
  saveUploadRecord, getTodayUploadCount, getRecentUploads,
  addNotification, getUnreadNotifications, markNotificationsRead,
};