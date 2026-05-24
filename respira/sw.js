const CACHE_NAME = 'respira-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './buddy.js',
  './supabase.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  const isAppAsset = url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.html');

  if (isAppAsset) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
      .catch(() => caches.match('./index.html'))
  );
});

let notifTimer = null;
let notifConfig = null;

self.addEventListener('message', event => {
  if (event.data?.type === 'SCHEDULE_NOTIF') {
    notifConfig = event.data;
    scheduleNextNotification();
  }
});

function scheduleNextNotification() {
  if (notifTimer) clearTimeout(notifTimer);
  if (!notifConfig) return;

  const [hStr, mStr] = (notifConfig.wakeTime || '07:00').split(':');
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(hStr), parseInt(mStr), 0);
  if (target <= now) target.setDate(target.getDate() + 1);

  const delay = target.getTime() - now.getTime();
  notifTimer = setTimeout(fireNotification, delay);
}

function fireNotification() {
  if (!notifConfig) return;

  const name = notifConfig.name || 'amigo';
  const days = notifConfig.days || 0;
  const messages = [
    `${name}, voce esta indo muito bem! ${days} dia${days !== 1 ? 's' : ''} sem fumar.`,
    `Oi, ${name}! Cada hora sem cigarro e uma vitoria.`,
    `${name}, lembre do seu motivo. Voce e mais forte que a vontade.`,
    `Bom dia, ${name}! Mais um dia livre dos cigarros comeca agora.`,
    `${name}, seus pulmoes agradecem! ${days} dia${days !== 1 ? 's' : ''} de progresso.`
  ];

  const body = messages[Math.floor(Math.random() * messages.length)];

  self.registration.showNotification('Respira', {
    body,
    icon: 'https://cdn-icons-png.flaticon.com/512/3209/3209865.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/3209/3209865.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: 'respira-daily',
    renotify: true,
    actions: [
      { action: 'open', title: 'Ver progresso' },
      { action: 'close', title: 'Dispensar' }
    ]
  });

  if (notifConfig) notifConfig.days = (notifConfig.days || 0) + 1;
  scheduleNextNotification();
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'close') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) {
        list[0].focus();
        return;
      }
      return clients.openWindow('./');
    })
  );
});

self.addEventListener('push', event => {
  let data = { title: 'Respira', body: 'Voce recebeu uma nova atualizacao.' };
  try { data = event.data?.json() || data; } catch {}
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: 'https://cdn-icons-png.flaticon.com/512/3209/3209865.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/3209/3209865.png',
    tag: 'respira-buddy-push'
  }));
});
