/* 엄마의 일기장 — 서비스 워커
 * - 화면 파일(index.html, 아이콘 등)만 저장해 둠. 일기·사진·녹음(구글 서버)은 절대 저장하지 않음.
 * - 화면은 "인터넷 먼저": 인터넷이 되면 항상 최신 화면, 끊겼을 때만 저장해 둔 화면.
 * - 같은 주소(odh-dev.github.io)의 다른 프로젝트 저장분은 건드리지 않도록 이름 앞에 mom-diary- 를 붙임.
 */
const PREFIX = 'mom-diary-';
const CACHE = PREFIX + 'v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

const OFFLINE_HTML = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>엄마의 일기장</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#FBF3E6;color:#5B4534;font:18px/1.6 system-ui,sans-serif;text-align:center;padding:24px">' +
  '<div><div style="font-size:48px">💌</div><p style="font-size:22px;font-weight:700;margin:8px 0">인터넷 연결이 끊겼어요</p>' +
  '<p style="margin:0 0 20px">와이파이나 데이터를 켠 다음 다시 열어 주세요.</p>' +
  '<button onclick="location.reload()" style="font:inherit;font-weight:700;padding:12px 28px;border:0;border-radius:14px;background:#5B4534;color:#FFFDF8">다시 열기</button></div></body></html>';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // 저장·답장 같은 보내기 요청은 그대로
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;              // 구글 서버(일기 데이터), 글꼴 등은 그대로
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  if (req.mode === 'navigate') {
    // 화면: 인터넷 먼저 → 실패하면 저장해 둔 화면 → 그것도 없으면 안내 화면
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); }
        return res;
      }).catch(() => caches.match('index.html').then(r => r || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })))
    );
    return;
  }
  // 아이콘·앱 정보: 저장해 둔 것 먼저, 없으면 인터넷
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
