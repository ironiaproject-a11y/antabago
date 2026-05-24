const BUDDY_API_BASE = `${SUPABASE_URL}/functions/v1/buddy-api/buddy`;

function formatBuddyDuration(minutes) {
  if (minutes == null) return 'Ainda sem data definida';
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return `${d}d ${h}h ${m}m`;
}

function fromNowPt(ts) {
  if (!ts) return 'offline';
  const diff = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000));
  if (diff <= 1) return 'agora';
  if (diff < 60) return `ha ${diff} min`;
  const h = Math.floor(diff / 60);
  return `ha ${h}h`;
}

function buddyMilestoneToast(msg) {
  if (typeof showToast === 'function') showToast(`🎉 ${msg}`);
}

function buddyStatusBadge(isOnline, lastSeen) {
  if (isOnline) return '<span class="buddy-badge online">online agora</span>';
  return `<span class="buddy-badge offline">visto ${fromNowPt(lastSeen)}</span>`;
}

function buddyProgressCard(title, data, isMe) {
  const who = isMe ? 'me' : 'buddy';
  return `
    <div class="buddy-card ${who}">
      <div class="buddy-card-head">
        <h4>${title}</h4>
        ${!isMe ? buddyStatusBadge(!!data?.is_online, data?.last_seen_at) : ''}
      </div>
      <p class="buddy-time">${formatBuddyDuration(data?.minutes_since_quit ?? null)}</p>
      <p class="buddy-milestone">${data?.current_milestone_label || 'Comecando jornada'}</p>
      <div class="buddy-bar"><div class="buddy-bar-fill" style="width:${data?.next_milestone_progress || 0}%"></div></div>
      <p class="buddy-next">Proximo: ${data?.next_milestone_label || 'Marcos concluidos'} (${data?.next_milestone_progress || 0}%)</p>
    </div>
  `;
}

function getBuddyCache() {
  try { return JSON.parse(localStorage.getItem('respiraBuddyCache') || 'null'); } catch { return null; }
}

function setBuddyCache(payload) {
  localStorage.setItem('respiraBuddyCache', JSON.stringify({ ...payload, cachedAt: new Date().toISOString() }));
}

function useBuddyLive({ buddyId, onUpdate, onMilestone, onOnlineStatus }) {
  let liveChannel = null;
  let presenceChannel = null;
  let lastMilestone = null;

  const start = () => {
    if (!window.RespiraSupabase?.client || !buddyId) return;
    const sb = window.RespiraSupabase.client;

    liveChannel = sb.channel(`buddy-live-${buddyId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'buddy_live_state', filter: `user_id=eq.${buddyId}` }, payload => {
        const next = payload.new?.payload || null;
        if (next) {
          onUpdate?.(next);
          if (next.current_milestone_label && next.current_milestone_label !== lastMilestone) {
            if (lastMilestone) onMilestone?.(next.current_milestone_label);
            lastMilestone = next.current_milestone_label;
          }
        }
      })
      .subscribe();

    presenceChannel = sb.channel(`buddy-presence-${buddyId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_presence', filter: `user_id=eq.${buddyId}` }, payload => {
        onOnlineStatus?.({ is_online: payload.new?.is_online, last_seen_at: payload.new?.last_seen_at });
      })
      .subscribe();
  };

  const stop = () => {
    const sb = window.RespiraSupabase?.client;
    if (sb && liveChannel) sb.removeChannel(liveChannel);
    if (sb && presenceChannel) sb.removeChannel(presenceChannel);
  };

  return { start, stop };
}

function useBuddyConnection() {
  const state = {
    connection: null,
    buddy: null,
    isLoading: false,
    error: null,
    inviteCode: null,
    inviteExpiresAt: null
  };

  let live = null;

  const fetchWithTimeout = async (url, options = {}, timeoutMs = 8000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const authHeaders = async () => {
    const sb = window.RespiraSupabase?.client;
    if (!sb) throw new Error('Supabase nao inicializado');
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Sessao expirada. Entre novamente para usar Parceiro de Jornada.');
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  };

  const refreshMe = async () => {
    state.isLoading = true;
    try {
      const res = await fetchWithTimeout(`${BUDDY_API_BASE}/me`, { headers: await authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Falha ao carregar parceiro');
      state.connection = data.connection || null;
      state.buddy = data.buddy || null;
      state.error = null;
      setBuddyCache({ connection: state.connection, buddy: state.buddy });

      if (live) live.stop();
      if (state.buddy?.id) {
        live = useBuddyLive({
          buddyId: state.buddy.id,
          onUpdate: (payload) => { state.buddy = { ...state.buddy, ...payload }; renderBuddyDashboardScreen(state); },
          onMilestone: (label) => buddyMilestoneToast(`${state.buddy?.display_name || 'Seu parceiro'} acabou de atingir ${label}!`),
          onOnlineStatus: ({ is_online, last_seen_at }) => {
            const before = !!state.buddy?.is_online;
            state.buddy = { ...state.buddy, is_online, last_seen_at };
            renderBuddyDashboardScreen(state);
            if (!before && is_online) buddyMilestoneToast(`${state.buddy?.display_name || 'Seu parceiro'} entrou no app agora.`);
          }
        });
        live.start();
      }
    } catch (e) {
      state.error = e?.message || 'Sem internet. Exibindo ultimo estado salvo.';
      const cache = getBuddyCache();
      if (cache) {
        state.connection = cache.connection;
        state.buddy = cache.buddy;
      }
    } finally {
      state.isLoading = false;
    }
    return state;
  };

  const generateInvite = async () => {
    const res = await fetch(`${BUDDY_API_BASE}/invite`, { method: 'POST', headers: await authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao gerar convite');
    state.inviteCode = data.invite_code;
    state.inviteExpiresAt = data.expires_at;
    return data;
  };

  const acceptInvite = async (code) => {
    const res = await fetch(`${BUDDY_API_BASE}/accept`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ invite_code: code }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao aceitar convite');
    await refreshMe();
    buddyMilestoneToast(`${data.buddy?.display_name || 'Seu parceiro'} aceitou a conexao!`);
    return data;
  };

  const endConnection = async () => {
    if (!confirm('Deseja encerrar a conexao com seu parceiro?')) return;
    const res = await fetch(`${BUDDY_API_BASE}/me`, { method: 'DELETE', headers: await authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao encerrar');
    state.connection = null;
    state.buddy = null;
    renderBuddyInviteScreen(state);
  };

  return { state, refreshMe, generateInvite, acceptInvite, endConnection };
}


function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function registerBuddyPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const headers = await (async () => {
    const sb = window.RespiraSupabase?.client;
    const { data } = await sb.auth.getSession();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` };
  })();
  const keyRes = await fetch(`${BUDDY_API_BASE}/push/public-key`, { method: 'GET', headers });
  const meta = await keyRes.json();
  const vapidKey = meta?.vapid_public_key;
  if (!vapidKey) return;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
  }
  await fetch(`${BUDDY_API_BASE}/push/register`, { method: 'POST', headers, body: JSON.stringify({ subscription: sub.toJSON() }) });
}
const buddyConnection = useBuddyConnection();
let buddyHeartbeat = null;

async function buddyHeartbeatTick() {
  if (!window.RespiraSupabase?.client || !window.RespiraMilestones) return;
  const user = window.RespiraSupabase.getCurrentUser?.();
  if (!user) return;

  const sb = window.RespiraSupabase.client;
  const ms = window.RespiraMilestones.useMilestones(new Date(state.journeyStart || Date.now()));
  const achieved = ms.achieved?.[0]?.label || 'Comecando jornada';

  const profile = {
    user_id: user.id,
    display_name: state.user?.name || 'Amigo',
    quit_date: state.journeyStart ? new Date(state.journeyStart).toISOString() : null,
    cigarettes_per_day: state.user?.cigsPerDay || 10,
    is_online: true,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const snapshot = {
    user_id: user.id,
    payload: {
      minutes_since_quit: ms.minutesSinceQuit,
      current_milestone_label: achieved,
      next_milestone_label: ms.next?.label || null,
      next_milestone_progress: ms.nextProgress,
      cigarettes_not_smoked: Math.floor((ms.minutesSinceQuit / 1440) * (state.user?.cigsPerDay || 10))
    },
    updated_at: new Date().toISOString()
  };

  await sb.from('user_presence').upsert(profile, { onConflict: 'user_id' });
  await sb.from('buddy_live_state').upsert(snapshot, { onConflict: 'user_id' });
}

function renderBuddyInviteScreen(st) {
  const root = document.getElementById('buddy-root');
  if (!root) return;
  const expires = st.inviteExpiresAt ? new Date(st.inviteExpiresAt).toLocaleString('pt-BR') : '--';
  root.innerHTML = `
    <div class="buddy-invite-wrap">
      <h3>Parceiro de Jornada</h3>
      <p>Conecte-se com uma pessoa de confianca para caminharem juntos, sem competicao e com apoio real no dia a dia.</p>
      ${st.error ? `<p class="mini-label" style="color:#ff6b6b;margin:8px 0 14px">${st.error}</p>` : ''}
      <button class="btn-primary" onclick="buddyGenerateInvite()">Gerar codigo de convite</button>
      ${st.inviteCode ? `<div class="buddy-code-box"><strong>${st.inviteCode}</strong><p>Expira em: ${expires}</p><div class="buddy-code-actions"><button class="btn-outline" onclick="buddyCopyCode('${st.inviteCode}')">Copiar</button><button class="btn-outline" onclick="buddyShareCode('${st.inviteCode}')">Compartilhar</button></div></div>` : ''}
      <div class="input-group" style="margin-top:16px"><label>Recebi um codigo</label><input id="buddy-accept-code" type="text" maxlength="6" placeholder="A3K9PW" /></div>
      <button class="btn-primary" onclick="buddyAcceptInvite()">Aceitar convite</button>
    </div>
  `;
}

function renderBuddyDashboardScreen(st) {
  const root = document.getElementById('buddy-root');
  if (!root) return;
  const me = window.RespiraMilestones.useMilestones(new Date(state.journeyStart || Date.now()));
  const myData = {
    minutes_since_quit: me.minutesSinceQuit,
    current_milestone_label: me.achieved?.[0]?.label || 'Comecando jornada',
    next_milestone_label: me.next?.label || null,
    next_milestone_progress: me.nextProgress
  };

  const bothOnline = !!st.buddy?.is_online;
  root.innerHTML = `
    <div class="buddy-dash-wrap">
      ${bothOnline ? '<div class="buddy-team-online">Vocês dois estao aqui agora!</div>' : ''}
      ${buddyProgressCard('Eu', myData, true)}
      <div class="buddy-divider">🤝</div>
      ${buddyProgressCard(st.buddy?.display_name || 'Parceiro', st.buddy || {}, false)}
      <div class="buddy-actions"><button class="btn-ghost" onclick="buddyEndConnection()">Encerrar conexao</button></div>
    </div>
  `;
}

async function renderBuddyScreen() {
  const root = document.getElementById('buddy-root');
  if (root) root.innerHTML = '<div class="buddy-invite-wrap"><p>Carregando Parceiro de Jornada...</p></div>';
  const { state: st, refreshMe } = buddyConnection;
  await refreshMe();
  if (!st.connection) renderBuddyInviteScreen(st);
  else renderBuddyDashboardScreen(st);
}

async function buddyGenerateInvite() {
  try { await buddyConnection.generateInvite(); renderBuddyInviteScreen(buddyConnection.state); }
  catch (e) { showToast(e.message || 'Falha ao gerar convite'); }
}

async function buddyAcceptInvite() {
  const code = (document.getElementById('buddy-accept-code')?.value || '').trim().toUpperCase();
  if (!code) return showToast('Digite o codigo de convite');
  try { await buddyConnection.acceptInvite(code); renderBuddyScreen(); }
  catch (e) { showToast(e.message || 'Nao foi possivel aceitar'); }
}

async function buddyEndConnection() {
  try { await buddyConnection.endConnection(); showToast('Conexao encerrada com carinho.'); }
  catch (e) { showToast(e.message || 'Falha ao encerrar'); }
}

function buddyCopyCode(code) {
  navigator.clipboard?.writeText(code);
  showToast('Codigo copiado');
}

async function buddyShareCode(code) {
  const msg = `Vamos ser parceiros de jornada no Respira? Use este codigo: ${code}`;
  if (navigator.share) {
    await navigator.share({ title: 'Convite Respira', text: msg });
  } else {
    buddyCopyCode(code);
  }
}

function initBuddyFeature() {
  registerBuddyPush().catch(() => {});
  if (buddyHeartbeat) clearInterval(buddyHeartbeat);
  buddyHeartbeatTick();
  buddyHeartbeat = setInterval(buddyHeartbeatTick, 60000);
  window.addEventListener('beforeunload', async () => {
    const sb = window.RespiraSupabase?.client;
    const user = window.RespiraSupabase?.getCurrentUser?.();
    if (!sb || !user) return;
    await sb.from('user_presence').upsert({ user_id: user.id, is_online: false, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  });
}

window.renderBuddyScreen = renderBuddyScreen;
window.buddyGenerateInvite = buddyGenerateInvite;
window.buddyAcceptInvite = buddyAcceptInvite;
window.buddyEndConnection = buddyEndConnection;
window.buddyCopyCode = buddyCopyCode;
window.buddyShareCode = buddyShareCode;
window.initBuddyFeature = initBuddyFeature;


