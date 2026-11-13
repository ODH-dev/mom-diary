/**
 * 엄마의 일기장 — 서버 코드 (글 + 목소리)
 * 화면: https://odh-dev.github.io/mom-diary/  (엄마·동탁·동학 모두 같은 링크)
 * 각자 비밀번호를 넣으면 누구인지 알아봐요: 엄마는 쓰기, 아들은 읽기·반응·답장
 */

// ▼ 비밀번호와 열쇠는 코드에 적지 않고 "스크립트 속성"에 넣어 둬요 (코드가 공개 저장소에 있어서).
//   Apps Script 편집기 → 프로젝트 설정(⚙️) → 스크립트 속성
//   PINS    : {"비밀번호":"이름", ...} 형태의 JSON  (예: {"1234":"엄마","5678":"동탁"})
//   속성이 비어 있으면 아무도 들어오지 못해요 (열려 버리지 않게).
let secrets_ = null;
function secrets_get_() {
  if (secrets_) return secrets_;
  const p = PropertiesService.getScriptProperties();
  let pins = {};
  try { pins = JSON.parse(p.getProperty('PINS') || '{}') || {}; } catch (e) { pins = {}; }
  secrets_ = { pins: pins };
  return secrets_;
}
function whoOf_(pin) {
  const pins = secrets_get_().pins;
  const k = String(pin || '');
  return k && Object.prototype.hasOwnProperty.call(pins, k) ? String(pins[k]) : '';
}

// 일기가 저장될 구글 시트의 ID (시트 주소의 /d/ 와 /edit 사이)
const SHEET_ID = '18jWRnhaey0bWf3UxWTiMGQXIqi8zdfrRNghwNyD8XnA';
const SHEET_NAME = '일기';
const FOLDER_NAME = '엄마의 일기장 녹음';
const TZ = 'Asia/Seoul';
const HEADERS = ['id', '날짜', '날씨', '기분', '내용', '처음 쓴 시각', '고친 시각', '녹음 파일', '사진 파일'];
const MOM_RECENT = 14;              // 엄마 화면에 보여줄 최근 일기 수
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const SOCIAL_SHEET = '반응';
const SOCIAL_HEADERS = ['시각', '일기id', '누가', '종류', '내용'];
const SONS = ['동탁', '동학'];
const MOM = '엄마';
const REACTIONS = ['❤️', '😂', '👍', '🥲'];

function doGet(e) {
  return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width,initial-scale=1"><p style="font:18px sans-serif;padding:24px">엄마의 일기장 주소가 바뀌었어요. 새 링크로 열어 주세요.</p>').setTitle('엄마의 일기장');
}

/** 외부에 올린 화면(웹에서 바로 녹음)이 부르는 저장 창구 */
const API_FNS = { getRecent: getRecent, getAllForFamily: getAllForFamily, saveEntry: saveEntry, deleteEntry: deleteEntry,
                  getAudio: getAudio, getPhoto: getPhoto,
                  markRead: markRead, react: react, reply: reply,
                  ask: ask, getQuestions: getQuestions, dismissQuestion: dismissQuestion };
// 함수 안에서 비밀번호로 누구인지 직접 확인하는 것들
const FAMILY_FNS = ['getAllForFamily', 'markRead', 'react', 'reply', 'ask', 'getQuestions'];
function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const fn = API_FNS[req.fn];
    if (!fn) throw new Error('알 수 없는 요청');
    const isMom = whoOf_(req.key) === MOM;
    const args = req.args || [];
    if (FAMILY_FNS.indexOf(req.fn) >= 0) { /* 함수 안에서 가족 비밀번호로 확인 */ }
    else if (req.fn === 'getAudio' || req.fn === 'getPhoto') { if (!isMom && !whoOf_(args[1])) throw new Error('권한이 없어요'); }
    else if (!isMom) throw new Error('권한이 없어요');
    out = { ok: true, result: fn.apply(null, args) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('B:B').setNumberFormat('@');
    sh.setColumnWidth(5, 420);
  } else if (sh.getRange(1, HEADERS.length).getDisplayValue() !== HEADERS[HEADERS.length - 1]) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  // id·날짜·시각 칸은 글자 그대로 (시트가 날짜/숫자로 바꾸지 않게) — 한 번만
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FMT') !== '2') {
    ['A:A', 'B:B', 'F:G'].forEach(a => sh.getRange(a).setNumberFormat('@'));
    props.setProperty('FMT', '2');
  }
  return sh;
}

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {}
  }
  const f = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

/** 시트가 수식으로 읽지 않게 */
function plain_(t) { return /^[=+\-@]/.test(t) ? "'" + t : t; }

function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
}

function readAll_() {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getDisplayValues();
  const social = readSocial_();
  return rows
    .filter(r => r[0] && (r[4] || r[7] || r[8]))
    .map(r => ({ id: r[0], date: r[1], weather: r[2], mood: r[3], text: r[4],
                 createdAt: r[5], editedAt: r[6], hasAudio: !!r[7], hasPhoto: !!r[8] }))
    .map(e => Object.assign(e, social.byId[e.id] || { reads: {}, reacts: {}, replies: [] },
                            social.answerOf[e.id] ? { question: social.answerOf[e.id] } : {}))
    .sort((a, b) => a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : (a.date < b.date ? 1 : -1));
}

/** 엄마 화면: 최근 일기 */
function getRecent() {
  return readAll_().slice(0, MOM_RECENT);
}

/** 가족 화면: 비밀번호가 맞을 때만 전체 */
function getAllForFamily(pin) {
  const who = whoOf_(pin);
  if (!who) return { ok: false };
  return { ok: true, who: who, entries: readAll_() };
}

/** 재생용 녹음 불러오기. 가족은 비밀번호, 엄마 화면은 최근 일기만 */
function getAudio(entryId, pin) { return getFile_(entryId, pin, 8, '녹음'); }

/** 사진 불러오기 (녹음과 같은 규칙) */
function getPhoto(entryId, pin) { return getFile_(entryId, pin, 9, '사진'); }

function getFile_(entryId, pin, col, label) {
  if (!whoOf_(pin)) {
    const recent = getRecent().map(e => e.id);
    if (recent.indexOf(String(entryId)) < 0) throw new Error('볼 수 없는 ' + label + '이에요');
  }
  const sh = sheet_();
  const row = findRow_(sh, entryId);
  if (!row) throw new Error(label + '을 찾지 못했어요');
  const fileId = sh.getRange(row, col).getDisplayValue();
  if (!fileId) throw new Error(label + '이 없어요');
  const blob = DriveApp.getFileById(fileId).getBlob();
  return { mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function saveAudio_(audio, date, id) {
  const bytes = Utilities.base64Decode(String(audio.data));
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error('녹음이 너무 길어요');
  const mime = String(audio.mime || 'audio/mp4').slice(0, 60);
  const ext = (String(audio.name || '').match(/\.([a-z0-9]{2,5})$/i) || [, mime.indexOf('webm') >= 0 ? 'webm' : 'm4a'])[1];
  const name = date + '_' + id + '.' + ext;
  return folder_().createFile(Utilities.newBlob(bytes, mime, name)).getId();
}

function savePhoto_(photo, date, id) {
  const bytes = Utilities.base64Decode(String(photo.data));
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error('사진이 너무 커요');
  const mime = /^image\/(jpeg|png|webp)$/.test(String(photo.mime)) ? String(photo.mime) : 'image/jpeg';
  const name = date + '_' + id + '_사진.' + (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');
  return folder_().createFile(Utilities.newBlob(bytes, mime, name)).getId();
}

function trashFile_(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
}

/** 저장(새 일기) 또는 고치기(id가 있으면) */
function saveEntry(entry) {
  entry = entry || {};
  const text = String(entry.text || '').trim();
  if (text.length > 20000) throw new Error('일기가 너무 길어요');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date
    : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const weather = String(entry.weather || '').slice(0, 10);
  const mood = String(entry.mood || '').slice(0, 10);
  const hasNewAudio = !!(entry.audio && entry.audio.data);
  const hasNewPhoto = !!(entry.photo && entry.photo.data);
  const answer = /^q-[0-9a-f]{6,12}$/.test(String(entry.answer || '')) ? String(entry.answer) : '';

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    if (entry.id) {
      const row = findRow_(sh, entry.id);
      if (row) {
        let fileId = sh.getRange(row, 8).getDisplayValue();
        let photoId = sh.getRange(row, 9).getDisplayValue();
        if (!text && !(hasNewAudio || (fileId && !entry.removeAudio)) && !(hasNewPhoto || (photoId && !entry.removePhoto)))
          throw new Error('글·목소리·사진 중 하나는 있어야 해요');
        if (hasNewAudio || entry.removeAudio) { trashFile_(fileId); fileId = ''; }
        if (hasNewAudio) fileId = saveAudio_(entry.audio, date, entry.id);
        if (hasNewPhoto || entry.removePhoto) { trashFile_(photoId); photoId = ''; }
        if (hasNewPhoto) photoId = savePhoto_(entry.photo, date, entry.id);
        sh.getRange(row, 2, 1, 4).setValues([[date, weather, mood, plain_(text)]]);
        sh.getRange(row, 7, 1, 3).setValues([[now_(), fileId, photoId]]);
        if (answer) linkAnswer_(answer, entry.id);
        return { id: entry.id };
      }
    }
    if (!text && !hasNewAudio && !hasNewPhoto) throw new Error('글·목소리·사진 중 하나는 있어야 해요');
    const id = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    const fileId = hasNewAudio ? saveAudio_(entry.audio, date, id) : '';
    const photoId = hasNewPhoto ? savePhoto_(entry.photo, date, id) : '';
    sh.appendRow([id, date, weather, mood, plain_(text), now_(), '', fileId, photoId]);
    if (answer) linkAnswer_(answer, id);
    return { id };
  } finally {
    lock.releaseLock();
  }
}

function deleteEntry(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_();
    const row = findRow_(sh, id);
    if (row) {
      trashFile_(sh.getRange(row, 8).getDisplayValue());
      trashFile_(sh.getRange(row, 9).getDisplayValue());
      sh.deleteRow(row);
      removeSocial_(id);
    }
    return true;
  } finally {
    lock.releaseLock();
  }
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === String(id)) return i + 2;
  return 0;
}


/* ---------- 아들들의 읽음 · 반응 · 답장 · 질문 (+ 엄마의 답장) ---------- */
function socialSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(SOCIAL_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SOCIAL_SHEET);
    sh.appendRow(SOCIAL_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange('A:C').setNumberFormat('@');
    sh.setColumnWidth(5, 360);
  }
  return sh;
}

function socialRows_(sh) {
  const last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, SOCIAL_HEADERS.length).getDisplayValues();
}

function readSocial_() {
  const byId = {}, asks = {}, answerOf = {};
  const rows = socialRows_(socialSheet_());
  rows.forEach(r => { if (r[3] === 'ask') asks[r[1]] = { id: r[1], who: r[2], text: r[4], time: r[0] }; });
  rows.forEach(r => {
    const [time, id, who, kind, val] = r;
    if (!id) return;
    if (kind === 'ask' || kind === 'dismiss') return;
    if (kind === 'answer') { if (asks[id] && val) answerOf[val] = asks[id]; return; }
    const o = byId[id] || (byId[id] = { reads: {}, reacts: {}, replies: [] });
    if (kind === 'read') o.reads[who] = time;
    else if (kind === 'react') o.reacts[who] = { emoji: val, time: time };
    else if (kind === 'reply') o.replies.push({ who: who, text: val, time: time });
  });
  return { byId: byId, answerOf: answerOf };
}

function checkFamily_(pin, who) {
  if (!whoOf_(pin)) throw new Error('비밀번호가 맞지 않아요');
  if (whoOf_(pin) !== String(who) || SONS.indexOf(String(who)) < 0) throw new Error('누구인지 확인이 안 돼요');
}

/** 아들이 편지를 열면 읽음 표시 */
function markRead(pin, who, ids) {
  checkFamily_(pin, who);
  ids = (ids || []).map(String).slice(0, 500);
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = socialSheet_();
    const done = {};
    socialRows_(sh).forEach(r => { if (r[3] === 'read' && r[2] === who) done[r[1]] = true; });
    const t = now_();
    const add = ids.filter(id => !done[id]).map(id => [t, id, who, 'read', '']);
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, SOCIAL_HEADERS.length).setValues(add);
    return add.length;
  } finally { lock.releaseLock(); }
}

/** 한 번 누르는 반응 (같은 걸 다시 누르면 취소) */
function react(pin, who, id, emoji) {
  checkFamily_(pin, who);
  if (REACTIONS.indexOf(emoji) < 0) throw new Error('알 수 없는 반응');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = socialSheet_();
    const rows = socialRows_(sh);
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][1] === String(id) && rows[i][2] === who && rows[i][3] === 'react') {
        if (rows[i][4] === emoji) { sh.deleteRow(i + 2); return { emoji: '' }; }
        sh.getRange(i + 2, 1, 1, SOCIAL_HEADERS.length).setValues([[now_(), String(id), who, 'react', emoji]]);
        return { emoji: emoji };
      }
    }
    sh.appendRow([now_(), String(id), who, 'react', emoji]);
    return { emoji: emoji };
  } finally { lock.releaseLock(); }
}

/** 짧은 답장 (아들들, 그리고 엄마가 거기에 다시 답할 때) */
function reply(pin, who, id, text) {
  if (!whoOf_(pin)) throw new Error('비밀번호가 맞지 않아요');
  if (whoOf_(pin) !== String(who) || (SONS.indexOf(String(who)) < 0 && who !== MOM)) throw new Error('누구인지 확인이 안 돼요');
  text = String(text || '').trim();
  if (!text) throw new Error('답장이 비어 있어요');
  if (text.length > 300) text = text.slice(0, 300);
  const t = now_();
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { socialSheet_().appendRow([t, String(id), who, 'reply', plain_(text)]); } finally { lock.releaseLock(); }
  return { who: who, text: text, time: t };
}

function removeSocial_(id) {
  const sh = socialSheet_();
  const rows = socialRows_(sh);
  // 일기에 달린 것 + 이 일기로 답했던 표시(질문은 다시 '안 답함'으로 돌아감)
  for (let i = rows.length - 1; i >= 0; i--)
    if (rows[i][1] === String(id) || (rows[i][3] === 'answer' && rows[i][4] === String(id))) sh.deleteRow(i + 2);
}

/** 아들이 엄마한테 질문 남기기 */
function ask(pin, who, text) {
  checkFamily_(pin, who);
  text = String(text || '').trim();
  if (!text) throw new Error('질문이 비어 있어요');
  if (text.length > 120) text = text.slice(0, 120);
  const q = { id: 'q-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8), who: who, text: text, time: now_() };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { socialSheet_().appendRow([q.time, q.id, who, 'ask', plain_(text)]); } finally { lock.releaseLock(); }
  return q;
}

/** 질문 목록 (가족 모두). 답한 일기 id, 넘긴 여부 포함. 최신순 */
function getQuestions(pin) {
  if (!whoOf_(pin)) throw new Error('비밀번호가 맞지 않아요');
  const rows = socialRows_(socialSheet_());
  const map = {}, list = [];
  rows.forEach(r => {
    if (r[3] === 'ask') { const q = { id: r[1], who: r[2], text: r[4], time: r[0], answer: '', answeredAt: '', dismissed: false }; map[r[1]] = q; list.push(q); }
  });
  rows.forEach(r => {
    const q = map[r[1]]; if (!q) return;
    if (r[3] === 'answer') { q.answer = r[4]; q.answeredAt = r[0]; }
    else if (r[3] === 'dismiss') q.dismissed = true;
  });
  return list.reverse().slice(0, 60);
}

/** 엄마: 질문을 '다음에'로 넘기기 */
function dismissQuestion(qid) {
  qid = String(qid || '');
  if (!/^q-/.test(qid)) throw new Error('알 수 없는 질문');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { socialSheet_().appendRow([now_(), qid, MOM, 'dismiss', '']); } finally { lock.releaseLock(); }
  return true;
}

/** 엄마가 일기로 질문에 답하면 연결 (같은 질문은 마지막 답만) */
function linkAnswer_(qid, entryId) {
  const sh = socialSheet_();
  const rows = socialRows_(sh);
  let asked = false;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][1] === qid && rows[i][3] === 'ask') asked = true;
    if (rows[i][1] === qid && rows[i][3] === 'answer') sh.deleteRow(i + 2);
  }
  if (asked) sh.appendRow([now_(), qid, MOM, 'answer', String(entryId)]);
}
