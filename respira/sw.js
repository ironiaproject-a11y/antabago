// sw.js  Respira Service Worker v3
// Cache-first com fallback para rede + notifica��es agendadas
// 

const CACHE_NAME = 'respira-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json'
];

//  Instala��o: pr�-cache dos assets core 
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()) // ativa imediatamente
  );
});

//  Ativa��o: apaga caches antigos 
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim()) // controla todas as abas
  );
});

//  Fetch: Cache-first, fallback para rede 
self.addEventListener('fetch', event => {
  // Ignora requisi��es n�o-GET e requests de APIs externas
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // deixa APIs passarem

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Armazena apenas respostas v�lidas
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => caches.match('./index.html')) // fallback offline
  );
});

//  Notifica��es: agendamento via postMessage 
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
  const target = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(),
    parseInt(hStr), parseInt(mStr), 0
  );

  // Se o hor�rio j� passou hoje, agenda para amanh�
  if (target <= now) target.setDate(target.getDate() + 1);

  const delay = target.getTime() - now.getTime();
  notifTimer = setTimeout(fireNotification, delay);
}

function fireNotification() {
  if (!notifConfig) return;

  const name = notifConfig.name || 'amigo';
  const days = notifConfig.days || 0;

  const messages = [
    `${name}, voc� est� indo muito bem! x ${days} dia${days !== 1 ? 's' : ''} sem fumar  continue firme!`,
    `Oi, ${name}! xR Cada hora sem cigarro � uma vit�ria. Respire fundo.`,
    `${name}, lembre do seu motivo. Voc� � mais forte que a vontade. x"`,
    `Bom dia, ${name}! , Mais um dia livre dos cigarros come�a agora.`,
    `${name}, seus pulm�es agradecem! x ${days} dia${days !== 1 ? 's' : ''} de progresso real.`
  ];

  const body = messages[Math.floor(Math.random() * messages.length)];

  self.registration.showNotification('Respira x"', {
    body,
    icon: 'https://cdn-icons-png.flaticon.com/512/3209/3209865.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/3209/3209865.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: 'respira-daily',
    renotify: true,
    actions: [
      { action: 'open',  title: 'x` Ver progresso' },
      { action: 'close', title: 'Dispensar'         }
    ]
  });

  // Atualiza dias e agenda o pr�ximo
  if (notifConfig) notifConfig.days = (notifConfig.days || 0) + 1;
  scheduleNextNotification();
}

//  Click nas a��es da notifica��o 
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
