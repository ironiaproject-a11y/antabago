// app.js  Respira v3 (com IA)
// 
// ESTADO GLOBAL
// 
let state = {
  isFirstTime: true,
  user: {
    name: '',
    motivation: '',
    cigsPerDay: 10,
    packPrice: 12,
    supportName: '',
    supportPhone: ''
  },
  journeyStart: null,
  crisesWon: 0,
  history: [],
  aiProvider: 'groq',   // 'groq' ou 'gemini'
  notifications: false, // true quando permiss�o concedida
  wakeTime: '07:00',    // horario do lembrete diario
  milestoneNotifiedIds: [],
  milestoneLastCelebratedId: null,
  attemptsHistory: [],
  milestoneCategoryFilter: 'all',
  milestoneIntroSeen: false,
  lastRelapseDays: 0,
  orbCalmScore: 0.3
};

// 
// ESTADO DA IA
// 
let aiConversation = []; // hist�rico da sess�o de crise
let aiTyping = false;
let milestoneMinuteTimer = null;
let milestoneTimeouts = [];
let heroOrbEngine = null;

//  Proxy URL  Edge Function do Supabase 
// A chave da IA fica NO SERVIDOR (vari�vel de ambiente do Supabase).
// Os usuarios nunca veem a chave. Altere a URL abaixo ap�s criar a fun��o.
const AI_PROXY_URL = `${SUPABASE_URL}/functions/v1/quick-responder`;

function hasAI() {
  return true; // IA sempre dispon�vel via proxy
}

// 
// INICIALIZA!�O
// 
document.addEventListener('DOMContentLoaded', () => {
  showScreen('loading');
  initHeroOrb();

  initFirebase(async (user) => {
    if (!user) {
      showScreen('login');
      return;
    }

    // Carrega dados locais imediatamente (r�pido)
    loadData();

    // Carrega dados da nuvem e mescla (pode demorar um pouco)
    const cloudData = await loadFromCloud();
    if (cloudData) {
      state = {
        ...state,
        ...cloudData,
        user: { ...state.user, ...(cloudData.user || {}) }
      };
      saveData(); // sincroniza de volta no localStorage
    }

    // Inicializa o app
    if (state.isFirstTime) {
      showScreen('splash');
      setTimeout(() => showScreen('onboarding'), 2500);
    } else {
      navigate('home');
      startTimers();
      checkMilestoneRealtime();
      // Listener em tempo real para outros dispositivos
      subscribeToRealtime(remoteData => {
        state = { ...state, ...remoteData, user: { ...state.user, ...(remoteData.user || {}) } };
        saveData();
        if (document.getElementById('screen-home').classList.contains('active')) updateDashboard();
      });
    }

    // Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(() => {
          if (state.notifications && Notification?.permission === 'granted') scheduleNotifications();
        }).catch(() => {});
    }

    if (typeof initBuddyFeature === 'function') initBuddyFeature();

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeEditModal();
    });
  });
});

// 
// NAVEGA!�O
// 
function showScreen(id) {
  const prev = document.querySelector('.screen.active:not(.exiting)');
  const el = document.getElementById(`screen-${id}`);
  if (!el || el === prev) return;

  if (prev) {
    prev.classList.add('exiting');
    setTimeout(() => prev.classList.remove('active', 'exiting'), 420);
  }
  el.classList.add('active');
}

/** Atualiza o item ativo na barra de navega��o inferior */
function updateNavActive(target) {
  // Deactivate all nav items across all screens
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));

  // Activate all nav items that navigate to `target`
  document.querySelectorAll('.nav-item').forEach(btn => {
    const onclick = btn.getAttribute('onclick') || '';
    if (onclick.includes(`'${target}'`) || onclick.includes(`"${target}"`)) {
      btn.classList.add('active');
    }
  });
}

function navigate(target) {
  if (target !== 'crisis') stopBreathingTone();
  showScreen(target);
  updateNavActive(target);

  // Scroll to top of new screen
  const screen = document.getElementById(`screen-${target}`);
  if (screen) {
    const wrap = screen.querySelector('.screen-wrap, .home-wrap');
    if (wrap) wrap.scrollTop = 0;
  }

  if (target === 'home')     { updateDashboard(); animateHomeEntrance(); }
  if (target === 'progress') renderProgress();
  if (target === 'triggers') renderTriggers();
  if (target === 'history')  renderHistory();
  if (target === 'profile')  renderProfile();
  if (target === 'crisis')   initCrisis();
  if (target === 'milestones') renderMilestonesScreen();
  if (target === 'buddy' && typeof renderBuddyScreen === 'function') renderBuddyScreen();
  if (target === 'coach')    {
    const chat = document.getElementById('coach-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
    setTimeout(() => document.getElementById('coach-user-input')?.focus(), 100);
  }
}

/** Anima��o premium de entrada para a Home */
function animateHomeEntrance() {
  const elements = [
    '.time-free-card', 
    '.setup-ai-banner', 
    '.btn-crisis', 
    '.metric-card', 
    '.quick-actions button',
    '.insight-card'
  ];
  
  let delay = 0;
  elements.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      setTimeout(() => {
        el.style.transition = 'all 0.8s cubic-bezier(0.23, 1, 0.32, 1)';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, delay);
      delay += 80;
    });
  });
}

function initHeroOrb() {
  const orb = document.getElementById('hero-orb');
  const phaseLabel = document.getElementById('hero-orb-phase');
  if (!orb || !phaseLabel || heroOrbEngine) return;

  const phases = {
    idle: { id: 'idle', label: 'respire', duration: 2800 },
    inhale: { id: 'inhale', label: 'segure e inspire', duration: 4200 },
    hold: { id: 'hold', label: 'mantenha', duration: 1700 },
    exhale: { id: 'exhale', label: 'solte devagar', duration: 4600 },
    recover: { id: 'recover', label: 'retome o ritmo', duration: 1800 }
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const persistedCalm = clamp(Number(state.orbCalmScore || 0.3), 0, 1);
  const engine = {
    phase: phases.idle,
    phaseStart: performance.now(),
    press: 0,
    breath: 0.48,
    chaos: clamp(0.74 - persistedCalm * 0.44, 0.14, 0.84),
    progress: clamp(0.14 + persistedCalm * 0.72, 0.08, 0.96),
    calm: persistedCalm,
    cycleQuality: 0,
    cycleCount: 0,
    pointerId: null,
    pointerDownAt: 0,
    angle: 0,
    prevAngle: 0,
    orbitInfluence: 0,
    orbitValue: 0,
    hintTimeout: null,
    lastPersistAt: 0
  };
  heroOrbEngine = engine;

  const setPhase = phase => {
    engine.phase = phase;
    engine.phaseStart = performance.now();
    orb.dataset.phase = phase.id;
    phaseLabel.textContent = phase.label;
  };

  const nudgeCalm = amount => {
    engine.calm = clamp(engine.calm + amount, 0, 1);
    engine.progress = clamp(engine.progress + amount * 0.72, 0.1, 1);
    engine.chaos = clamp(engine.chaos - amount * 0.8, 0.08, 0.84);
  };

  const phasePulse = pattern => {
    if (navigator.vibrate) navigator.vibrate(pattern);
  };

  const persistCalm = () => {
    const now = Date.now();
    if (now - engine.lastPersistAt < 5000) return;
    engine.lastPersistAt = now;
    state.orbCalmScore = clamp((state.orbCalmScore || 0.3) * 0.55 + engine.calm * 0.45, 0, 1);
    saveData();
  };

  const updatePointerInfluence = evt => {
    const rect = orb.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = evt.clientX - cx;
    const dy = evt.clientY - cy;
    const angle = Math.atan2(dy, dx);
    const da = Math.atan2(Math.sin(angle - engine.prevAngle), Math.cos(angle - engine.prevAngle));
    engine.prevAngle = angle;
    engine.angle += da;
    const orbitStrength = clamp(Math.abs(da) * 7.5, 0, 1);
    engine.orbitInfluence = clamp(engine.orbitInfluence * 0.86 + orbitStrength * 0.14, 0, 1);
    engine.orbitValue = clamp(engine.orbitValue * 0.88 + (da * 0.5), -1, 1);
  };

  const enterRecover = () => {
    setPhase(phases.recover);
    phasePulse([8, 55, 6]);
    if (engine.hintTimeout) clearTimeout(engine.hintTimeout);
    engine.hintTimeout = setTimeout(() => setPhase(phases.idle), phases.recover.duration);
  };

  const finishCycle = () => {
    engine.cycleCount += 1;
    const quality = clamp(engine.cycleQuality, 0, 1);
    if (quality >= 0.62) {
      nudgeCalm(0.048 + quality * 0.024);
      phaseLabel.textContent = 'controle recuperado';
      phasePulse([10, 45, 10, 45, 14]);
    } else {
      nudgeCalm(-0.012);
      phaseLabel.textContent = 'recomece com suavidade';
      phasePulse([8, 60, 8]);
    }
    engine.cycleQuality = 0;
    if (engine.hintTimeout) clearTimeout(engine.hintTimeout);
    engine.hintTimeout = setTimeout(() => setPhase(phases.idle), 1200);
    persistCalm();
  };

  const releasePointer = () => {
    orb.classList.remove('is-pressed');
    orb.classList.remove('is-guiding');
    engine.press = 0;
    engine.pointerId = null;
    engine.orbitInfluence *= 0.8;

    if (engine.phase.id === 'inhale' || engine.phase.id === 'hold') {
      enterRecover();
    } else if (engine.phase.id === 'exhale') {
      finishCycle();
    }
  };

  orb.addEventListener('pointerdown', evt => {
    orb.setPointerCapture?.(evt.pointerId);
    orb.classList.add('is-pressed');
    orb.classList.add('is-guiding');
    engine.press = 1;
    engine.pointerId = evt.pointerId;
    engine.pointerDownAt = performance.now();
    engine.prevAngle = Math.atan2(evt.clientY - (orb.getBoundingClientRect().top + orb.getBoundingClientRect().height / 2), evt.clientX - (orb.getBoundingClientRect().left + orb.getBoundingClientRect().width / 2));
    engine.cycleQuality = clamp(engine.cycleQuality + 0.12, 0, 1);
    setPhase(phases.inhale);
    phasePulse(8);
  });

  orb.addEventListener('pointermove', evt => {
    if (engine.pointerId !== evt.pointerId || !engine.press) return;
    updatePointerInfluence(evt);
    if (Math.abs(engine.orbitValue) < 0.16) engine.cycleQuality = clamp(engine.cycleQuality - 0.003, 0, 1);
    else engine.cycleQuality = clamp(engine.cycleQuality + 0.004, 0, 1);
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(evt => orb.addEventListener(evt, releasePointer));

  setPhase(phases.idle);

  const tick = now => {
    const elapsed = now - engine.phaseStart;
    const t = clamp(elapsed / engine.phase.duration, 0, 1);

    if (engine.phase.id === 'idle') {
      engine.breath = 0.44 + Math.sin(now * 0.00105) * 0.08;
      if (!engine.press && elapsed > engine.phase.duration) setPhase(phases.idle);
    } else if (engine.phase.id === 'inhale') {
      engine.breath = 0.38 + t * 0.62;
      engine.cycleQuality = clamp(engine.cycleQuality + (engine.press ? 0.0028 : -0.006), 0, 1);
      if (!engine.press) enterRecover();
      else if (t >= 1) {
        setPhase(phases.hold);
        phasePulse([5, 34, 5]);
      }
    } else if (engine.phase.id === 'hold') {
      engine.breath = 1;
      engine.cycleQuality = clamp(engine.cycleQuality + (engine.press ? 0.0017 : -0.01), 0, 1);
      if (!engine.press) enterRecover();
      else if (t >= 1) {
        setPhase(phases.exhale);
        phasePulse([4, 30, 4, 40, 8]);
      }
    } else if (engine.phase.id === 'exhale') {
      engine.breath = 1 - t * 0.84;
      engine.cycleQuality = clamp(engine.cycleQuality + (!engine.press ? 0.0035 : -0.005), 0, 1);
      if (engine.press) {
        phaseLabel.textContent = 'solte com leveza';
      }
      if (t >= 1) {
        finishCycle();
      }
    } else if (engine.phase.id === 'recover') {
      engine.breath = 0.46 + Math.sin(now * 0.0014) * 0.05;
      engine.cycleQuality = clamp(engine.cycleQuality - 0.006, 0, 1);
      if (t >= 1) setPhase(phases.idle);
    }

    engine.orbitInfluence = clamp(engine.orbitInfluence * 0.94, 0, 1);
    engine.orbitValue = clamp(engine.orbitValue * 0.92, -1, 1);
    engine.progress = clamp(engine.progress + (engine.phase.id === 'idle' ? 0.00008 : 0.0003), 0.08, 1);
    engine.calm = clamp(engine.calm + (engine.phase.id === 'idle' ? 0.00003 : 0.00016), 0, 1);
    engine.chaos = clamp(0.78 - engine.calm * 0.56 - engine.progress * 0.18 - engine.orbitInfluence * 0.22, 0.08, 0.86);

    const luma = clamp(0.66 + engine.progress * 0.28 + engine.calm * 0.22, 0.6, 1);
    orb.style.setProperty('--orb-breath', engine.breath.toFixed(4));
    orb.style.setProperty('--orb-chaos', engine.chaos.toFixed(4));
    orb.style.setProperty('--orb-progress', engine.progress.toFixed(4));
    orb.style.setProperty('--orb-luma', luma.toFixed(4));
    orb.style.setProperty('--orb-press', engine.press.toFixed(4));
    orb.style.setProperty('--orb-orbit', engine.orbitValue.toFixed(4));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// 
// ONBOARDING
// 
let currentObStep = 0;

function obNext() {
  document.getElementById(`ob-${currentObStep}`).classList.remove('active');
  document.getElementById(`dot-${currentObStep}`).classList.remove('active');
  currentObStep = Math.min(currentObStep + 1, 3);
  document.getElementById(`ob-${currentObStep}`).classList.add('active');
  document.getElementById(`dot-${currentObStep}`).classList.add('active');
  vibrate([30]);
}

function selectTag(btn) {
  const group = btn.getAttribute('data-group');
  if (group) {
    document.querySelectorAll(`.tag[data-group="${group}"]`).forEach(t => t.classList.remove('selected'));
    btn.classList.add('selected');
  } else {
    btn.classList.toggle('selected');
  }
}

function finishOnboarding() {
  const name       = document.getElementById('user-name').value.trim() || 'Amigo';
  const cigs       = parseInt(document.getElementById('cigs-per-day').value) || 10;
  const price      = parseFloat(document.getElementById('pack-price').value) || 12;
  const motivation = document.getElementById('motivation').value.trim();

  state.user = { ...state.user, name, cigsPerDay: cigs, packPrice: price, motivation };
  state.isFirstTime = false;
  state.journeyStart = Date.now();
  state.unlockedBadges = [];
  saveData();
  vibrate([100, 50, 200]);
  showToast('Bem-vindo à sua nova vida!');
  navigate('home');
  startTimers();
  if (state.notifications && Notification?.permission === 'granted') scheduleMilestoneNotifications(new Date(state.journeyStart));
  burstConfetti();
  setTimeout(checkBadges, 500);
}

// 
// TIMER (atualiza a cada segundo)
// 
let timerInterval = null;

function startTimers() {
  if (timerInterval) clearInterval(timerInterval);
  if (milestoneMinuteTimer) clearInterval(milestoneMinuteTimer);
  updateTimeDisplay();
  timerInterval = setInterval(updateTimeDisplay, 1000);
  milestoneMinuteTimer = setInterval(() => {
    checkMilestoneRealtime();
    if (document.getElementById('screen-milestones')?.classList.contains('active')) renderMilestonesScreen();
  }, 60000);
}

function updateTimeDisplay() {
  if (!state.journeyStart) return;
  const diff = Date.now() - state.journeyStart;
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);
  const secs  = Math.floor((diff % 60000) / 1000);

  const el = document.getElementById('time-display');
  if (el) el.textContent = `${days}d ${hours}h ${mins}m ${secs}s`;

  const maxDays = 21;
  const pct = Math.min((days / maxDays) * 100, 100);
  const fill = document.getElementById('tfc-fill');
  if (fill) fill.style.width = `${pct}%`;

  const sub = document.getElementById('tfc-sub');
  if (sub) sub.textContent = days === 0 ? 'As primeiras 24h são cruciais.' : `Incrível! ${days} dia${days>1?'s':''} de vitória.`;
}

// 
// DASHBOARD
// 
function updateDashboard() {
  const hour = new Date().getHours();
  let greeting = 'Bom dia,';
  if (hour >= 12 && hour < 18) greeting = 'Boa tarde,';
  else if (hour >= 18) greeting = 'Boa noite,';

  setEl('greeting', greeting);
  setEl('user-name-display', state.user.name || 'Amigo');

  const av = document.querySelector('.avatar-circle');
  if (av) av.textContent = (state.user.name || 'A').charAt(0).toUpperCase();

  setEl('crises-won', state.crisesWon);

  const days = state.journeyStart ? (Date.now() - state.journeyStart) / 86400000 : 0;

  if (state.journeyStart) {
    const saved = (days * state.user.cigsPerDay / 20) * state.user.packPrice;
    setEl('money-saved', `R$ ${saved.toFixed(0)}`);
    const cigsNotSmoked = Math.round(days * state.user.cigsPerDay);
    setEl('cigs-saved', cigsNotSmoked);
  }

  // Top trigger do hist�rico real
  const trigCount = {};
  state.history.forEach(h => {
    if (h.trigger) trigCount[h.trigger] = (trigCount[h.trigger] || 0) + 1;
  });
  const topTrig = Object.keys(trigCount).sort((a,b) => trigCount[b] - trigCount[a])[0] || null;
  setEl('top-trigger', topTrig || '');

  // Hora de risco real (hora com mais registros)
  const hourCount = {};
  state.history.forEach(h => {
    const hr = new Date(h.timestamp).getHours();
    hourCount[hr] = (hourCount[hr] || 0) + 1;
  });
  const topHour = Object.keys(hourCount).sort((a,b) => hourCount[b] - hourCount[a])[0];
  setEl('risk-time', topHour !== undefined ? `${topHour}h` : '');

  // Insight personalizado
  const insights = buildPersonalizedInsights(topTrig, topHour !== undefined ? parseInt(topHour) : null, Math.floor(days));
  const idx = Math.floor(Date.now() / 3600000) % insights.length;
  setEl('insight-msg', insights[idx]);

  // Banner de Setup de IA
  const aiBanner = document.getElementById('setup-ai-banner');
  if (aiBanner) {
    aiBanner.style.display = hasAI() ? 'none' : 'flex';
  }
}

/** Gera insights personalizados com base nos dados reais do usuário */
function buildPersonalizedInsights(topTrig, riskHour, days) {
  const name = state.user.name || 'você';
  const hour = new Date().getHours();
  const insights = [
    'A vontade de fumar dura em média 3 a 5 minutos. Você é mais forte do que ela.',
    'Beber água gelada ajuda a reduzir a vontade de fumar em até 30%.',
    'Cada cigarro não fumado poupa cerca de 11 minutos de vida.',
    'Após 20 minutos sem fumar, sua pressão arterial já começa a normalizar.',
    'Andar por 5 minutos reduz significativamente a intensidade do craving.'
  ];

  // Insights baseados em tempo de jornada
  if (days >= 1)  insights.push(`Incrível! Já são ${days} dia${days>1?'s':''} de jornada, ${name}! Continue assim.`);
  if (days >= 7)  insights.push(`Uma semana sem fumar! Seus pulmões já estão se limpando, ${name}. Não pare agora.`);
  if (days >= 30) insights.push(`Um mês livre, ${name}! Sua energia e fôlego melhoraram visivelmente. Você é uma inspiração.`);

  // Insights baseados em dados reais
  if (topTrig) insights.push(`Seu maior gatilho é "${topTrig}". Identifique o padrão e substitua por uma alternativa saudável.`);
  if (riskHour !== null) insights.push(`Você tem mais fissuras às ${riskHour}h. Planeje uma atividade para esse horário.`);
  if (state.crisesWon > 0) insights.push(`Você já venceu ${state.crisesWon} crise${state.crisesWon>1?'s':''}! Cada vitória fortalece sua força de vontade.`);

  // Insights contextuais por horario
  if (hour >= 6 && hour < 10)  insights.push('Bom dia! Comece com um copo d\'água e 3 respirações profundas. Reduz o craving matinal.');
  if (hour >= 12 && hour < 15) insights.push('A hora do almoço pode ativar gatilhos. Troque o cigarro por uma caminhada de 5 minutos.');
  if (hour >= 18 && hour < 22) insights.push('Fim do dia é crítico. Use o Modo Crise se sentir vontade. Você não precisa ceder.');

  return insights;
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// 
// MODO CRISE - Respiração 4-4-4-4 box breathing
// 
let breatheInterval = null;
let breathePhase = 0; // 0=inhale,1=hold,2=exhale,3=hold
let breatheCount = 0;
const PHASES = [
  { label: 'Inspire...', dur: 4000 },
  { label: 'Segure',     dur: 4000 },
  { label: 'Expire...',  dur: 4000 },
  { label: 'Espere',     dur: 4000 }
];

const crisisMessages = [
  'Eu sei que está difícil agora. Isso vai passar.',
  'Concentre-se só na respiração. Inspire pelo nariz, expire pela boca.',
  'Você já chegou até aqui. Não jogue isso fora.',
  'A vontade dura apenas alguns minutos. Você é mais forte do que ela.',
  'Estou aqui com você. Vamos aguentar firme juntos.'
];

function initCrisis() {
  // Reset conversacao de IA
  aiConversation = [];
  window._crisisIntensity = null;

  // Reset UI
  const step1 = document.getElementById('crisis-step-1');
  const footer = document.getElementById('crisis-footer');
  const aiBar = document.getElementById('ai-input-bar');
  if (step1) step1.style.display = 'flex';
  if (footer) footer.style.display = 'none';
  if (aiBar) aiBar.style.display = 'none';
  document.querySelectorAll('.int-btn').forEach(b => { b.style.opacity = '1'; b.classList.remove('selected'); });

  const chat = document.getElementById('crisis-chat');
  if (chat) chat.innerHTML = `
    <div class="chat-bubble ai"><p>Ei, estou aqui. Você fez a coisa certa vindo aqui. Vamos atravessar isso juntos.</p></div>
    <div class="chat-bubble ai"><p>De <strong>0 a 10</strong>, quão forte está a vontade agora?</p></div>
    <div class="crisis-options" id="crisis-step-1">
      <div class="intensity-row">
        ${[1,2,3,4,5,6,7,8,9,10].map(n => `<button class="int-btn" onclick="selectIntensity(this,${n})">${n}</button>`).join('')}
      </div>
    </div>`;

  initCrisisCanvas();
  startBreatheAnimation();
}

/** Anima��o suave de particulas para o fundo da crise */
function initCrisisCanvas() {
  const canvas = document.getElementById('crisis-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, particles = [];

  const resize = () => {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  };
  window.addEventListener('resize', resize);
  resize();

  class Particle {
    constructor() {
      this.reset();
    }
    reset() {
      this.x = Math.random() * w;
      this.y = Math.random() * h;
      this.size = Math.random() * 2 + 1;
      this.speedY = Math.random() * 0.5 + 0.1;
      this.alpha = Math.random() * 0.5 + 0.1;
    }
    update() {
      this.y -= this.speedY;
      if (this.y < -10) this.reset();
    }
    draw() {
      ctx.fillStyle = `rgba(139, 92, 246, ${this.alpha})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for(let i=0; i<50; i++) particles.push(new Particle());

  function animate() {
    if (!document.getElementById('screen-crisis').classList.contains('active')) return;
    ctx.clearRect(0, 0, w, h);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(animate);
  }
  animate();
}

function startBreatheAnimation() {
  if (breatheInterval) clearInterval(breatheInterval);
  breathePhase = 0;
  breatheCount = 0;
  initAudioEngine();
  applyBreathePhase();
  breatheInterval = setInterval(() => {
    breathePhase = (breathePhase + 1) % 4;
    breatheCount++;
    applyBreathePhase();
  }, 4000);
}

function applyBreathePhase() {
  const circle = document.getElementById('breathe-circle');
  const label  = document.getElementById('breathe-label');
  if (!circle || !label) return;

  circle.classList.remove('inhale', 'hold', 'exhale');
  label.textContent = PHASES[breathePhase].label;

  if (breathePhase === 0) circle.classList.add('inhale');
  else if (breathePhase === 2) circle.classList.add('exhale');
  else circle.classList.add('hold');

  playBreathingTone(breathePhase);
}

function selectIntensity(btn, val) {
  window._crisisIntensity = val; // salva para o system prompt
  document.querySelectorAll('.int-btn').forEach(b => b.style.opacity = '0.4');
  btn.style.opacity = '1';

  setTimeout(async () => {
    const step1 = document.getElementById('crisis-step-1');
    if (step1) step1.style.display = 'none';

    const footer = document.getElementById('crisis-footer');
    if (footer) footer.style.display = 'block';

    const aiBar = document.getElementById('ai-input-bar');

    if (hasAI()) {
      // Resposta via IA
      appendChatBubble('user', `Intensidade: ${val}/10`);
      aiConversation.push({ role: 'user', content: `Estou com fissura de intensidade ${val}/10 agora.` });
      showTypingIndicator();
      aiTyping = true;
      try {
        const reply = await fetchAIResponse(aiConversation, val);
        aiConversation.push({ role: 'assistant', content: reply });
        removeTypingIndicator();
        appendChatBubble('ai', reply);
      } catch(e) {
        removeTypingIndicator();
        appendChatBubble('ai', val >= 8
          ? 'Intensidade alta! Foque: nomeie 5 coisas que você vê ao redor. Isso ancora sua mente.'
          : crisisMessages[Math.floor(Math.random() * crisisMessages.length)]);
      } finally { aiTyping = false; }
      if (aiBar) aiBar.style.display = 'flex'; // mostra chat input
    } else {
      // Fallback local
      const chat = document.getElementById('crisis-chat');
      if (chat) {
        chat.innerHTML += `<div class="chat-bubble user"><p>Intensidade: ${val}/10</p></div>`;
        const msg = val >= 8
          ? 'Intensidade alta! Vamos usar a tecnica 5-4-3-2-1: nomeie 5 coisas que voce ve, 4 que sente, 3 que ouve. Isso ancora sua mente.'
          : crisisMessages[Math.floor(Math.random() * crisisMessages.length)];
        chat.innerHTML += `<div class="chat-bubble ai"><p>${msg}</p></div>`;
        chat.scrollTop = chat.scrollHeight;
      }
    }
  }, 500);
}

function crisisWon() {
  state.crisesWon++;
  state.history.push({ type: 'win', timestamp: Date.now(), note: 'Venceu uma crise via Modo Crise' });
  saveData();
  checkBadges();
  if (breatheInterval) clearInterval(breatheInterval);
  stopBreathingTone();
  vibrate([200, 100, 200, 100, 400]);
  showToast('Parabéns! Você venceu mais uma.');
  navigate('home');
  burstConfetti();
}

// 
// REGISTRAR CIGARRO
// 
let smokedInRegister = false;

function updateIntensityDisplay(val) {
  setEl('reg-intensity-val', `${val} / 10`);
}

function setSmoked(val) {
  smokedInRegister = val;
  document.getElementById('yn-yes').classList.toggle('selected', val);
  document.getElementById('yn-no').classList.toggle('selected', !val);
}

function saveRegister() {
  const intensity = document.getElementById('reg-intensity').value;
  const locTag  = document.querySelector('.tag[data-group="location"].selected');
  const trigTag = document.querySelector('.tag[data-group="trigger"].selected');
  const note    = document.getElementById('reg-note').value;

  // BUG FIX: valida��o correta usa smokedInRegister (booleano expl�cito)
  // e verifica se algum bot�o sim/nao foi escolhido
  const selectedYN = document.querySelector('.yn-btn.selected');

  if (!locTag || !trigTag || !selectedYN) {
    showToast('Preencha local, gatilho e se fumou antes de salvar.');
    return;
  }

  const entry = {
    type: smokedInRegister ? 'relapse' : 'win',
    timestamp: Date.now(),
    intensity: parseInt(intensity),
    location: locTag.innerText,
    trigger: trigTag.innerText,
    note
  };

  state.history.push(entry);

  if (smokedInRegister) {
    handleRelapseReset();
    navigate('relapse');
  } else {
    state.crisesWon++;
    saveData();
    checkBadges();
    vibrate([100, 50, 100]);
    showToast('Mais uma vitória registrada!');
    navigate('home');
    burstConfetti();
  }

  // limpar form
  document.getElementById('reg-note').value = '';
  document.getElementById('reg-intensity').value = 5;
  updateIntensityDisplay(5);
  document.querySelectorAll('.tag[data-group]').forEach(t => t.classList.remove('selected'));
  document.querySelectorAll('.yn-btn').forEach(b => b.classList.remove('selected'));
  smokedInRegister = false;
}

function saveRelapse() {
  // Salva o gatilho selecionado na tela de recaida
  const trigTag = document.querySelector('#screen-relapse .tag.selected');
  if (trigTag && state.history.length > 0) {
    const lastEntry = state.history[state.history.length - 1];
    if (lastEntry.type === 'relapse') {
      lastEntry.relapseTrigger = trigTag.innerText;
      saveData();
    }
  }
  // Limpa selecao
  document.querySelectorAll('#screen-relapse .tag').forEach(t => t.classList.remove('selected'));
  showToast('Registro salvo. Recomeçando do zero.');
  navigate('home');
}

// 
// PROGRESSO
// 
function renderProgress() {
  if (!state.journeyStart) return;
  checkBadges();
  renderBadges();
  renderEvolutionChart();
  const diff = Date.now() - state.journeyStart;
  const days = Math.floor(diff / 86400000);

  setEl('p-days', days);
  setEl('p-crises', state.crisesWon);

  const saved = (days * state.user.cigsPerDay / 20) * state.user.packPrice;
  setEl('p-money', `R$${saved.toFixed(0)}`);

  // Anel do pulm�o (90 dias = 100%)
  const lungPct = Math.min(Math.floor((days / 90) * 100), 100);
  setEl('lung-pct', `${lungPct}%`);
  const ring = document.getElementById('progress-ring');
  if (ring) setTimeout(() => { ring.style.strokeDashoffset = 553 - (lungPct / 100) * 553; }, 100);

  // Marcos
  const mList = document.getElementById('milestone-list');
  if (mList) {
    const milestones = [
      { d: 0.014, icon: '❤️', title: '20 minutos',       desc: 'Pressao e pulso normalizam' },
      { d: 0.33,  icon: '🫁', title: '8 horas',         desc: 'Oxigenio no sangue normaliza' },
      { d: 1,     icon: '✅', title: '1 dia livre',      desc: 'Monoxido de carbono cai ao normal' },
      { d: 2,     icon: '👃', title: '2 dias livres',    desc: 'Olfato e paladar melhoram' },
      { d: 3,     icon: '🌬️', title: '3 dias livres',    desc: 'Nicotina eliminada do organismo' },
      { d: 7,     icon: '🌿', title: '1 semana',         desc: 'Pulmoes comecam a se limpar' },
      { d: 14,    icon: '💪', title: '2 semanas',        desc: 'Circulacao melhora visivelmente' },
      { d: 30,    icon: '⚡', title: '1 mes',            desc: 'Energia e folego renovados' },
      { d: 90,    icon: '❤️‍🩹', title: '3 meses',          desc: 'Risco de infarto reduz em 50%' },
      { d: 365,   icon: '🏆', title: '1 ano',            desc: 'Risco de doenca cardiaca cai 50%' }
    ];
    mList.innerHTML = milestones.map(m => {
      const done = days >= m.d;
      return `
        <div class="milestone ${done ? '' : 'locked'}">
          <div class="m-icon">${done ? m.icon : '🔒'}</div>
          <div class="m-info"><h4>${m.title}</h4><p>${m.desc}</p></div>
          ${done ? '<span class="m-badge">OK</span>' : ''}
        </div>`;
    }).join('');
  }

  // Streak 30 dias com scroll horizontal
  const sGrid = document.getElementById('streak-grid');
  if (sGrid) {
    sGrid.innerHTML = '';
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const tsS = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const tsE = tsS + 86399999;
      const hadRelapse = state.history.some(h => h.type === 'relapse' && h.timestamp >= tsS && h.timestamp <= tsE);
      const afterStart = state.journeyStart < tsE;
      let cls = 'streak-day';
      if (i === 0) cls += ' today';
      if (afterStart) cls += hadRelapse ? ' fail' : ' done';
      const dayLabel = d.getDate();
      const monthLabel = (d.getMonth()+1).toString().padStart(2,'0');
      sGrid.innerHTML += `<div class="${cls}" title="${dayLabel}/${monthLabel}">${dayLabel}</div>`;
    }
    // Scroll para o dia de hoje (mais recente, � direita)
    setTimeout(() => { sGrid.scrollLeft = sGrid.scrollWidth; }, 50);
  }
}

// 
// GATILHOS  dados reais do hist�rico
// 
function renderTriggers() {
  // Heatmap por hora
  const hourCount = {};
  state.history.forEach(h => {
    const hr = new Date(h.timestamp).getHours();
    hourCount[hr] = (hourCount[hr] || 0) + 1;
  });
  const maxH = Math.max(...Object.values(hourCount), 1);

  const heatmap = document.getElementById('heatmap');
  if (heatmap) {
    heatmap.innerHTML = '';
    for (let i = 0; i < 24; i++) {
      const count = hourCount[i] || 0;
      const ratio = count / maxH;
      let bg = 'var(--bg-surface)';
      if (ratio > 0.7) bg = 'var(--danger)';
      else if (ratio > 0.3) bg = 'var(--secondary)';
      else if (ratio > 0) bg = 'rgba(232,93,58,0.3)';
      heatmap.innerHTML += `<div class="heat-block" style="background:${bg}" title="${count} eventos">${i}h</div>`;
    }
  }

  // Barras de gatilhos reais
  const trigCount = {};
  state.history.forEach(h => {
    if (h.trigger) trigCount[h.trigger] = (trigCount[h.trigger] || 0) + 1;
  });
  const sorted = Object.entries(trigCount).sort((a,b) => b[1]-a[1]).slice(0, 5);
  const maxT = sorted.length ? sorted[0][1] : 1;

  const tbars = document.getElementById('trigger-bars');
  if (tbars) {
    if (sorted.length === 0) {
      tbars.innerHTML = '<p style="color:var(--text-sec);text-align:center;padding:20px">Nenhum dado ainda. Registre gatilhos para ver aqui.</p>';
    } else {
      tbars.innerHTML = sorted.map(([trig, cnt]) => {
        const pct = Math.round((cnt / maxT) * 100);
        return `
          <div class="t-bar-wrap">
            <span class="t-bar-label">${trig}</span>
            <div class="t-bar-track"><div class="t-bar-fill" data-width="${pct}"></div></div>
            <span class="t-bar-val">${cnt}x</span>
          </div>`;
      }).join('');
      // Anima as barras ap�s render
      requestAnimationFrame(() => {
        document.querySelectorAll('.t-bar-fill').forEach((el, i) => {
          el.style.transitionDelay = `${i * 0.12}s`;
          el.style.width = (el.dataset.width || '0') + '%';
        });
      });
    }
  }

  // Padr�es din�micos
  const pList = document.getElementById('pattern-list');
  if (pList) {
    if (sorted.length === 0) {
      pList.innerHTML = '<p style="color:var(--text-sec);text-align:center;padding:20px">Registros futuros mostrar�o seus padr�es aqui.</p>';
    } else {
      const topHour = Object.entries(hourCount).sort((a,b)=>b[1]-a[1])[0];
      pList.innerHTML = sorted.slice(0,3).map(([trig, cnt], i) => {
        const risk = i === 0 ? 'high' : 'medium';
        const riskLabel = i === 0 ? 'Alto' : 'Medio';
        return `
          <div class="pattern-item">
            <span class="pattern-icon">${triggerIcon(trig)}</span>
            <div class="pattern-text"><strong>${trig}</strong><p>${cnt} registro${cnt>1?'s':''} ${topHour ? `� pico �s ${topHour[0]}h` : ''}</p></div>
            <span class="pattern-risk ${risk}">${riskLabel}</span>
          </div>`;
      }).join('');
    }
  }
}

function triggerIcon(name) {
  const map = { 'Estresse':'🔥','Cafe':'☕','Pos-refeicao':'🍽️','Tedio':'🌀','Ansiedade':'😮‍💨','Alcool':'🍺','Social':'👥','Briga':'⚡','Cansaco':'😴','Rotina':'🧭' };
  return map[name] || '📍';
}

// 
// HISTRICO
// 
function renderHistory() {
  const hList = document.getElementById('history-list');
  if (!hList) return;

  if (state.history.length === 0) {
    hList.innerHTML = `<div class="empty-state"><span class="empty-icon">📝</span><p>Nenhum registro ainda.<br>Comece registrando um momento de crise.</p></div>`;
    return;
  }

  const sorted = [...state.history].sort((a,b) => b.timestamp - a.timestamp);
  hList.innerHTML = sorted.map(h => {
    const d = new Date(h.timestamp);
    const dateStr = `${d.getDate()}/${d.getMonth()+1} as ${d.getHours()}:${d.getMinutes().toString().padStart(2,'0')}`;
    const isWin = h.type === 'win';
    const sub = [h.trigger, h.location].filter(Boolean).join(' - ');
    return `
      <div class="hist-item">
        <div class="hist-info">
          <span class="hist-title">${isWin ? 'Crise vencida' : 'Recaida'}</span>
          <span class="hist-date">${dateStr}${sub ? '  ' + sub : ''}</span>
          ${h.note ? `<span class="hist-note">${h.note}</span>` : ''}
        </div>
        <span class="hist-badge ${isWin ? 'win' : 'fail'}">${isWin ? 'Vitoria' : 'Registro'}</span>
      </div>`;
  }).join('');
}

// 
// PERFIL
// 
function renderProfile() {
  const init = (state.user.name || 'A').charAt(0).toUpperCase();

  // Supabase nao tem foto  usa inicial do nome
  const av = document.getElementById('profile-avatar');
  if (av) {
    av.style.backgroundImage = '';
    av.textContent = init;
  }

  const displayName = state.user.name || 'Amigo';
  const email = currentUser?.email || '';

  setEl('profile-name-display', displayName);
  setEl('profile-email', email);

  const days = state.journeyStart ? Math.floor((Date.now() - state.journeyStart) / 86400000) : 0;
  setEl('profile-sub', `Em jornada h� ${days} dia${days !== 1 ? 's' : ''}`);
  setEl('profile-motive', `"${state.user.motivation || 'Para ter uma vida melhor'}"`);

  const sn = document.getElementById('support-name');
  const sp = document.getElementById('support-phone');
  if (sn) sn.value = state.user.supportName || '';
  if (sp) sp.value = state.user.supportPhone || '';

  // Mostrar bot�es de contato se numero salvo
  const supportActions = document.getElementById('support-actions');
  if (supportActions) {
    supportActions.style.display = state.user.supportPhone ? 'flex' : 'none';
  }

  // Hor�rio de lembrete
  const wt = document.getElementById('wake-time');
  if (wt) wt.value = state.wakeTime || '07:00';

  // Estado do toggle de notifica��es
  const ntToggle = document.getElementById('notif-toggle');
  if (ntToggle) ntToggle.checked = state.notifications || false;

  // Banner de notifica��o: mostrar se ainda nao concedeu
  const notifBanner = document.getElementById('notif-banner-profile');
  if (notifBanner) {
    const perm = Notification?.permission;
    notifBanner.style.display = (perm === 'granted' || perm === 'denied') ? 'none' : 'flex';
  }

  updateAIStatus();
}

function saveSupport() {
  state.user.supportName  = (document.getElementById('support-name').value || '').trim();
  state.user.supportPhone = (document.getElementById('support-phone').value || '').trim();
  saveData();
  // Mostrar bot�es de a��o se tiver numero
  const supportActions = document.getElementById('support-actions');
  if (supportActions) {
    supportActions.style.display = state.user.supportPhone ? 'flex' : 'none';
  }
  showToast('Contato de apoio salvo! x"');
}

function openWhatsApp() {
  const phone = state.user.supportPhone.replace(/\D/g, '');
  if (!phone) { showToast('Nenhum numero salvo.'); return; }
  const name  = encodeURIComponent(state.user.name || 'eu');
  const msg   = encodeURIComponent(`Oi! Preciso de apoio agora  estou usando o Respira para parar de fumar. x"`);
  window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
}

function callSupport() {
  const phone = state.user.supportPhone.replace(/\D/g, '');
  if (!phone) { showToast('Nenhum numero salvo.'); return; }
  window.location.href = `tel:+${phone}`;
}

// 
// MODAL DE EDI!�O DE PERFIL
// 
function openEditModal() {
  const modal = document.getElementById('edit-modal');
  if (!modal) return;
  // Preenche os campos com os dados atuais
  document.getElementById('edit-name').value   = state.user.name || '';
  document.getElementById('edit-motive').value = state.user.motivation || '';
  document.getElementById('edit-cigs').value   = state.user.cigsPerDay || 10;
  document.getElementById('edit-price').value  = state.user.packPrice || 12;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeEditModal() {
  const modal = document.getElementById('edit-modal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}

function handleModalBackdrop(e) {
  // Fecha ao clicar fora do sheet
  if (e.target.id === 'edit-modal') closeEditModal();
}

function saveEditModal() {
  const name   = document.getElementById('edit-name').value.trim();
  const motive = document.getElementById('edit-motive').value.trim();
  const cigs   = parseInt(document.getElementById('edit-cigs').value);
  const price  = parseFloat(document.getElementById('edit-price').value);

  if (name)   state.user.name       = name;
  if (motive) state.user.motivation = motive;
  if (!isNaN(cigs)  && cigs  > 0) state.user.cigsPerDay = cigs;
  if (!isNaN(price) && price > 0) state.user.packPrice  = price;

  saveData();
  renderProfile();
  closeEditModal();
  showToast('S& Perfil atualizado com sucesso!');
}

// Mant�m compatibilidade com chamadas antigas (caso exista)
function editProfile() { openEditModal(); }

function resetApp() {
  if (confirm('Tem certeza que deseja apagar todos os dados e recome�ar do zero?\n\nSuas chaves de API ser�o mantidas.')) {
    localStorage.removeItem('respiraData');
    // Nao remove as chaves de API  o usuario nao precisa redigit�-las
    location.reload();
  }
}

// 
// PERSIST`NCIA
// 
function saveData() {
  localStorage.setItem('respiraData', JSON.stringify(state));
  saveToCloud(state); // sincroniza na nuvem (fire-and-forget)
}

function loadData() {
  const raw = localStorage.getItem('respiraData');
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      // Mescla profunda para garantir que novas propriedades existam
      state = {
        ...state,
        ...saved,
        user: { ...state.user, ...(saved.user || {}) }
      };
    } catch(e) {
      console.warn('Falha ao carregar dados:', e);
    }
  }
}

// 
// NOTIFICA!"ES
// 
async function requestNotifPermission() {
  if (!('Notification' in window)) {
    showToast('Seu navegador nao suporta notificacoes.');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    state.notifications = true;
    saveData();
    scheduleNotifications();
    // Ocultar o banner
    const banner = document.getElementById('notif-banner-profile');
    if (banner) banner.style.display = 'none';
    // Marcar toggle
    const toggle = document.getElementById('notif-toggle');
    if (toggle) toggle.checked = true;
    showToast('Lembretes ativados! Te veremos amanha.');
  } else if (perm === 'denied') {
    const banner = document.getElementById('notif-banner-profile');
    if (banner) banner.style.display = 'none';
    showToast('Permissao negada. Ative nas configuracoes do navegador.');
  }
}

function toggleNotifications(enabled) {
  if (enabled) {
    requestNotifPermission();
  } else {
    state.notifications = false;
    saveData();
    showToast('Lembretes desativados.');
  }
}

function saveWakeTime(time) {
  state.wakeTime = time;
  saveData();
  if (state.notifications && Notification?.permission === 'granted') {
    scheduleNotifications();
    showToast(`Lembrete agendado para as ${time}.`);
  }
}

/** Agenda notifica��o via Service Worker (1x por dia no horario salvo) */
function scheduleNotifications() {
  if (!('serviceWorker' in navigator) || Notification?.permission !== 'granted') return;

  navigator.serviceWorker.ready.then(reg => {
    reg.active?.postMessage({
      type: 'SCHEDULE_NOTIF',
      wakeTime: state.wakeTime || '07:00',
      name: state.user.name || 'amigo',
      days: state.journeyStart
        ? Math.floor((Date.now() - state.journeyStart) / 86400000)
        : 0
    });
  }).catch(() => {});

  scheduleMilestoneNotifications(new Date(state.journeyStart || Date.now()));
}

/** Dispara notifica��o imediata via SW (para confirmar que esta funcionando) */
function fireTestNotification() {
  if (Notification?.permission !== 'granted') return;
  navigator.serviceWorker.ready.then(reg => {
    reg.showNotification('Respira x"', {
      body: 'Seus lembretes diarios estao ativos. Continue firme!',
      icon: 'https://cdn-icons-png.flaticon.com/512/3209/3209865.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/3209/3209865.png',
      vibrate: [200, 100, 200],
      tag: 'respira-test'
    });
  }).catch(() => {});
}

// 
// UTILIDADES
// 
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

/** Exibe o indicador de sincroniza��o na home */
function showSyncIndicator(status) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  el.className = `sync-indicator ${status}`;
  if (status === 'synced') {
    setTimeout(() => { el.className = 'sync-indicator'; }, 2500);
  }
}

function burstConfetti() {
  const container = document.getElementById('particles');
  if (!container) return;
  container.innerHTML = '';
  const colors = ['#E85D3A','#F5A623','#34C759','#5AC8FA','#FF2D55'];
  for (let i = 0; i < 40; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.animationDelay = Math.random() * 1.5 + 's';
    c.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    c.style.width = c.style.height = (Math.random() * 8 + 6) + 'px';
    c.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    container.appendChild(c);
  }
  setTimeout(() => container.innerHTML = '', 5000);
}

// 
// IA  GROQ API
// 

/** Monta o system prompt contextualizado com os dados do usuario */
function buildSystemPrompt(intensity) {
  const days = state.journeyStart
    ? Math.floor((Date.now() - state.journeyStart) / 86400000)
    : 0;
  const name = state.user.name || 'amigo';
  const motive = state.user.motivation || 'ter uma vida mais saudavel';
  const topTrig = (() => {
    const c = {};
    state.history.forEach(h => { if (h.trigger) c[h.trigger] = (c[h.trigger]||0)+1; });
    return Object.keys(c).sort((a,b)=>c[b]-c[a])[0] || null;
  })();

  return `Voce � o Respira, um coach emp�tico e acolhedor especializado em cessa��o do tabagismo.
Voce esta ajudando ${name} em tempo real durante uma crise de fissura.

Contexto do usuario:
- Nome: ${name}
- Dias sem fumar: ${days}
- Motivacao para parar: "${motive}"
- Crises ja vencidas: ${state.crisesWon}
${topTrig ? `- Gatilho mais comum: ${topTrig}` : ''}
- Intensidade atual da fissura: ${intensity || '?'}/10

Regras CR�TICAS:
1. Responda SEMPRE em portugues brasileiro, de forma calorosa, sem julgamentos.
2. Respostas curtas (max. 3 frases). Direto ao ponto.
3. Use o nome do usuario �s vezes para personalizar.
4. Nunca use linguagem clinica ou formal  seja humano, pr�ximo.
5. Sugira a��es concretas: respira��o, agua gelada, sair do ambiente, ligar para alguem.
6. Se intensidade >= 8, priorize tecnicas imediatas de grounding (5-4-3-2-1).
7. Celebre cada vit�ria, mesmo pequena.
8. Jamais julgue se a pessoa fumou.`;
}

/** Envia mensagem do usuario para a IA e exibe resposta */
async function handleSendAIMessage(inputId, btnId) {
  if (aiTyping) return;
  const input = document.getElementById(inputId);
  const text = input?.value?.trim();
  if (!text) return;
  input.value = '';
  appendChatBubble('user', text);
  aiConversation.push({ role: 'user', content: text });

  showTypingIndicator();
  aiTyping = true;
  const sendBtn = document.getElementById(btnId);
  if (sendBtn) sendBtn.disabled = true;

  try {
    const aiReply = await fetchAIResponse(aiConversation, window._crisisIntensity || 5);
    aiConversation.push({ role: 'assistant', content: aiReply });
    removeTypingIndicator();
    appendChatBubble('ai', aiReply);
  } catch (err) {
    removeTypingIndicator();
    appendChatBubble('ai', 'Não consegui conectar agora, mas estou aqui. Respire fundo: inspire 4s, segure 4s, expire 4s.');
    console.error('AI API error:', err);
  } finally {
    aiTyping = false;
    if (sendBtn) sendBtn.disabled = false;
    input?.focus();
  }
}

async function sendAIMessage() {
  await handleSendAIMessage('ai-user-input', 'ai-send-btn');
}

async function sendCoachMessage() {
  await handleSendAIMessage('coach-user-input', 'coach-send-btn');
}

/** Abstra��o para chamada das APIs de IA  via proxy Supabase Edge Function */
async function fetchAIResponse(messages, intensity) {
  const systemPrompt = buildSystemPrompt(intensity);

  // Chama nosso proxy no Supabase (a chave real fica no servidor)
  const resp = await fetch(AI_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON}` // anon key (p�blica, sem problema)
    },
    body: JSON.stringify({
      provider: state.aiProvider || 'groq',
      messages,
      systemPrompt,
      intensity
    })
  });

  if (!resp.ok) throw new Error(`Proxy error: ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data.reply || 'Estou aqui com você.';
}

/** Retorna o chat ativo (crise ou coach) */
function getActiveChat() {
  if (document.getElementById('screen-crisis')?.classList.contains('active')) {
    return document.getElementById('crisis-chat');
  }
  if (document.getElementById('screen-coach')?.classList.contains('active')) {
    return document.getElementById('coach-chat');
  }
  // fallback: tenta qualquer um que esteja vis�vel
  return document.getElementById('coach-chat') || document.getElementById('crisis-chat');
}

/** Adiciona bolha de chat ao DOM */
function appendChatBubble(role, text) {
  const chat = getActiveChat();
  if (!chat) return;
  const div = document.createElement('div');
  div.className = `chat-bubble ${role}`;
  div.innerHTML = `<p>${escapeHTML(text)}</p>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

/** Indicador de digita��o animado */
function showTypingIndicator() {
  const chat = getActiveChat();
  if (!chat) return;
  const el = document.createElement('div');
  el.className = 'chat-bubble ai typing-indicator typing-dot';
  el.innerHTML = `<span></span><span></span><span></span>`;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}

function removeTypingIndicator() {
  document.querySelectorAll('.typing-dot').forEach(el => el.remove());
}

function escapeHTML(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 
// IA  CONFIGURA!�O NO PERFIL
// 
function selectProvider(p) {
  state.aiProvider = p;
  saveData();
  
  // Atualiza bot�es
  document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById(`prov-${p}`)?.classList.add('selected');
  
  updateAIStatus();
}

function updateAIStatus() {
  const el = document.getElementById('ai-status');
  if (!el) return;
  
  const providerName = state.aiProvider === 'gemini' ? 'Google Gemini' : (state.aiProvider === 'openai' ? 'OpenAI' : 'Groq');
  el.textContent = `IA ativa via servidor (${providerName})`;
  el.className = 'ai-status active';
  
  // Sincroniza seletores
  document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById(`prov-${state.aiProvider}`)?.classList.add('selected');
}

// 
// �UDIO  Web Audio API (breathing tones)
// 
let audioCtx = null;
let _osc = null;
let _gain = null;
let audioEnabled = true;

function initAudioEngine() {
  if (!audioEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch(e) { audioEnabled = false; }
}

function playBreathingTone(phase) {
  if (!audioEnabled || !audioCtx) return;
  stopBreathingTone();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0, now);
  if (phase === 0) {      // Inspire: 220 400Hz, fadein
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(400, now + 3.8);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.4);
  } else if (phase === 1) { // Segure: steady hum 400Hz
    osc.frequency.setValueAtTime(400, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.3);
  } else if (phase === 2) { // Expire: 400 220Hz, fadeout
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.linearRampToValueAtTime(220, now + 3.8);
    gain.gain.linearRampToValueAtTime(0.10, now + 0.3);
    gain.gain.linearRampToValueAtTime(0, now + 3.6);
  } else {                  // Espere: silence
    gain.gain.setValueAtTime(0, now);
  }
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  _osc = osc; _gain = gain;
}

function stopBreathingTone() {
  if (_osc) { try { _osc.stop(); } catch(e) {} _osc = null; }
  _gain = null;
}

function toggleCrisisAudio() {
  audioEnabled = !audioEnabled;
  const btn = document.getElementById('audio-toggle-btn');
  if (btn) btn.textContent = audioEnabled ? 'x`' : 'x!';
  if (!audioEnabled) stopBreathingTone();
  else { initAudioEngine(); playBreathingTone(breathePhase); }
}

// 
// VIBRA!�O H�PTICA
// 
function vibrate(pattern = [50]) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch(e) {}
}

// 
// BADGES / CONQUISTAS
// 
const BADGES = [
  { id: 'min20',    icon: 'xR&', title: '20 Minutos',       desc: 'Pressao arterial come�ando a normalizar',  cond: s => daysSince(s) >= 0.014 },
  { id: 'h8',       icon: 'xR', title: '8 Horas',          desc: 'Oxigenio no sangue normalizado',           cond: s => daysSince(s) >= 0.33  },
  { id: 'd1',       icon: 'xR"', title: 'Primeiro Dia',      desc: 'Monoxido de carbono eliminado',            cond: s => daysSince(s) >= 1     },
  { id: 'd3',       icon: 'x', title: '3 Dias Livres',     desc: 'Nicotina zerada no organismo',             cond: s => daysSince(s) >= 3     },
  { id: 'w1',       icon: 'x', title: '1 Semana',          desc: 'Pulmoes come�ando a se limpar',            cond: s => daysSince(s) >= 7     },
  { id: 'w2',       icon: 'd', title: '2 Semanas',         desc: 'Circulacao visivelmente melhor',           cond: s => daysSince(s) >= 14    },
  { id: 'm1',       icon: 'a', title: '1 M�s Livre',       desc: 'Energia e folego renovados',               cond: s => daysSince(s) >= 30    },
  { id: 'm3',       icon: 'x ', title: '3 Meses',           desc: 'Risco de infarto reduz em 50%',            cond: s => daysSince(s) >= 90    },
  { id: 'y1',       icon: 'xRx', title: '1 Ano Livre',       desc: 'Risco de doenca card�aca cai 50%',         cond: s => daysSince(s) >= 365   },
  { id: 'crisis1',  icon: 'x', title: '1a Crise Vencida',  desc: 'Voce nao cedeu � primeira vez',            cond: s => s.crisesWon >= 1      },
  { id: 'crisis5',  icon: 'x`', title: '5 Crises',          desc: 'Voce � mais forte que o habito',           cond: s => s.crisesWon >= 5      },
  { id: 'crisis10', icon: 'x:', title: '10 Crises',         desc: 'Um guerreiro da for�a de vontade',         cond: s => s.crisesWon >= 10     },
  { id: 'crisis20', icon: 'x}', title: '20 Crises',         desc: 'Mestre do autocontrole',                   cond: s => s.crisesWon >= 20     },
];

function daysSince(s) {
  if (!s.journeyStart) return 0;
  return (Date.now() - s.journeyStart) / 86400000;
}

function checkBadges() {
  if (!state.unlockedBadges) state.unlockedBadges = [];
  let newUnlock = false;
  BADGES.forEach(b => {
    if (!state.unlockedBadges.includes(b.id) && b.cond(state)) {
      state.unlockedBadges.push(b.id);
      newUnlock = true;
      saveData();
      setTimeout(() => showBadgeUnlock(b), 800);
    }
  });
  return newUnlock;
}

function showBadgeUnlock(badge) {
  const overlay = document.getElementById('badge-overlay');
  if (!overlay) return;
  document.getElementById('badge-unlock-icon').textContent  = badge.icon;
  document.getElementById('badge-unlock-title').textContent = badge.title;
  document.getElementById('badge-unlock-desc').textContent  = badge.desc;
  overlay.classList.add('show');
  vibrate([100, 60, 200, 60, 300]);
  setTimeout(() => overlay.classList.remove('show'), 4500);
}

function renderBadges() {
  const grid = document.getElementById('badges-grid');
  if (!grid) return;
  const unlocked = state.unlockedBadges || [];
  grid.innerHTML = BADGES.map(b => `
    <div class="badge-item ${unlocked.includes(b.id) ? 'unlocked' : 'locked'}" title="${b.desc}">
      <div class="badge-icon-wrap">${unlocked.includes(b.id) ? b.icon : 'x'}</div>
      <div class="badge-name">${b.title}</div>
    </div>`).join('');
}

// 
// GR�FICO DE EVOLU!�O  14 dias
// 
function renderEvolutionChart() {
  const chart = document.getElementById('evolution-chart');
  if (!chart) return;
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const tsS = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const tsE = tsS + 86399999;
    const wins     = state.history.filter(h => h.type === 'win'     && h.timestamp >= tsS && h.timestamp <= tsE).length;
    const relapses = state.history.filter(h => h.type === 'relapse' && h.timestamp >= tsS && h.timestamp <= tsE).length;
    days.push({ wins, relapses, label: d.getDate() + '/' + (d.getMonth()+1), isToday: i === 0 });
  }
  const maxVal = Math.max(...days.map(d => d.wins + d.relapses), 1);
  chart.innerHTML = days.map(d => `
    <div class="evo-col">
      <div class="evo-bars">
        ${d.relapses > 0 ? `<div class="evo-bar fail" style="height:${Math.max((d.relapses/maxVal)*100,8)}%" title="${d.relapses} recaida(s)"></div>` : ''}
        ${d.wins > 0 ? `<div class="evo-bar win" style="height:${Math.max((d.wins/maxVal)*100,8)}%" title="${d.wins} vit�ria(s)"></div>` : ''}
        ${d.wins === 0 && d.relapses === 0 ? '<div class="evo-empty"></div>' : ''}
      </div>
      <div class="evo-label${d.isToday ? ' today' : ''}">${d.label}</div>
    </div>`).join('');
}

// 
// COMPARTILHAR PROGRESSO (Canvas   imagem)
// 
function shareProgress() {
  const days  = state.journeyStart ? Math.floor((Date.now() - state.journeyStart) / 86400000) : 0;
  const saved = state.journeyStart ? Math.round((days * state.user.cigsPerDay / 20) * state.user.packPrice) : 0;
  const name  = state.user.name || 'Amigo';

  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = 800;
  const ctx = canvas.getContext('2d');

  // BG gradient
  const bg = ctx.createLinearGradient(0, 0, 800, 800);
  bg.addColorStop(0, '#08080f'); bg.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 800, 800);

  // Glow
  const glow = ctx.createRadialGradient(400, 320, 0, 400, 320, 320);
  glow.addColorStop(0, 'rgba(255,107,107,0.18)'); glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, 800, 800);

  // App name
  ctx.fillStyle = '#FF6B6B'; ctx.font = 'bold 52px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('respira', 400, 110);

  // Tagline
  ctx.fillStyle = '#6B7280'; ctx.font = '26px sans-serif';
  ctx.fillText('livre do cigarro', 400, 152);

  // Days number
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 200px sans-serif';
  ctx.fillText(days, 400, 380);

  ctx.fillStyle = '#9CA3AF'; ctx.font = '38px sans-serif';
  ctx.fillText('dias sem fumar', 400, 440);

  // Stats cards
  function card(x, y, w, h) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 20); ctx.fill();
  }
  card(60, 490, 320, 130); card(420, 490, 320, 130);

  ctx.fillStyle = '#FF6B6B'; ctx.font = 'bold 52px sans-serif';
  ctx.fillText(`R$${saved}`, 220, 560);
  ctx.fillStyle = '#9CA3AF'; ctx.font = '24px sans-serif';
  ctx.fillText('economizado', 220, 598);

  ctx.fillStyle = '#A78BFA'; ctx.font = 'bold 52px sans-serif';
  ctx.fillText(state.crisesWon, 580, 560);
  ctx.fillStyle = '#9CA3AF'; ctx.font = '24px sans-serif';
  ctx.fillText('crises vencidas', 580, 598);

  // Name
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '28px sans-serif';
  ctx.fillText(`${name} esta livre do cigarro`, 400, 690);

  ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '20px sans-serif';
  ctx.fillText('feito com carinho pelo Respira', 400, 770);

  canvas.toBlob(blob => {
    const file = new File([blob], 'respira-progresso.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: `${days} dias sem fumar!`, text: `${days} dias de vitoria usando o Respira!` });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'respira-progresso.png'; a.click();
    }
  });
}

// 
// BACKUP  Exportar / Importar JSON
// 
function exportData() {
  const backup = {
    version: '3.0',
    exportedAt: new Date().toISOString(),
    state
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `respira-backup-${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.json`;
  a.click();
  showToast('S& Backup exportado!');
}

function importData(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.state) throw new Error('invalid');
      const date = new Date(data.exportedAt).toLocaleDateString('pt-BR');
      if (!confirm(`Restaurar backup de ${date}?\nIsso substituira todos os dados atuais.`)) return;
      state = { ...state, ...data.state, user: { ...state.user, ...(data.state.user || {}) } };

      saveData(); renderProfile();
      showToast('S& Backup restaurado com sucesso!');
    } catch { showToast('R Arquivo invalido. Use um backup Respira.'); }
  };
  reader.readAsText(file); input.value = '';
}




// Milestones
const MILESTONE_COLORS = {
  cardiovascular: '#E85D3A',
  respiratorio: '#34B3FF',
  neurologico: '#8B5CF6',
  celular: '#2CB67D'
};

function formatDurationFromMinutes(totalMinutes) {
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  return `${d}d ${h}h ${m}m`;
}

function humanizeRemainingMinutes(minutes) {
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return `${d}d ${hh}h`;
}

function useMilestones(quitDate) {
  if (!quitDate || !window.RespiraMilestones) return { achieved: [], next: null, nextProgress: 0, minutesSinceQuit: 0 };
  return window.RespiraMilestones.useMilestones(new Date(quitDate));
}

function renderCategoryFilter() {
  const el = document.getElementById('ms-category-filter');
  if (!el) return;
  const categories = [
    { id: 'all', label: 'Todos' },
    { id: 'cardiovascular', label: 'Cardiovascular' },
    { id: 'respiratorio', label: 'Respiratorio' },
    { id: 'neurologico', label: 'Neurologico' },
    { id: 'celular', label: 'Celular' }
  ];
  el.innerHTML = categories.map(c => `
    <button class="category-filter-chip chip-${c.id} ${state.milestoneCategoryFilter === c.id ? 'active' : ''}" onclick="setMilestoneCategory('${c.id}')">${c.label}</button>
  `).join('');
}

function setMilestoneCategory(category) {
  state.milestoneCategoryFilter = category;
  saveData();
  renderMilestonesScreen();
}

function milestoneCard(milestone, achieved, minutesSinceQuit) {
  const achievedAt = state.journeyStart ? new Date(state.journeyStart + milestone.minutes * 60000) : null;
  const timeLeft = Math.max(0, milestone.minutes - minutesSinceQuit);
  return `
    <div class="milestone-item-card ${achieved ? '' : 'locked'}" ${achieved ? `onclick="openMilestoneModal('${milestone.id}')"` : ''}>
      <div class="ms-icon">${achieved ? milestone.icon : '='}</div>
      <div>
        <p class="ms-title">${milestone.label}  ${milestone.title}</p>
        <p class="ms-body">${achieved ? milestone.body : 'Continue firme. Seu corpo esta trabalhando por voce neste exato momento.'}</p>
        <p class="ms-meta">${achieved ? `Conquistado em ${achievedAt.toLocaleString('pt-BR')}` : `Faltam ${humanizeRemainingMinutes(timeLeft)}`}</p>
      </div>
    </div>
  `;
}

function renderMilestonesScreen() {
  const totalEl = document.getElementById('ms-total-time');
  const listEl = document.getElementById('ms-list');
  const nextCardEl = document.getElementById('ms-next-card');
  const progressFill = document.getElementById('ms-next-progress-fill');
  const progressLabel = document.getElementById('ms-next-progress-label');
  if (!totalEl || !listEl || !nextCardEl || !progressFill || !progressLabel) return;

  const data = useMilestones(new Date(state.journeyStart || Date.now()));
  totalEl.textContent = formatDurationFromMinutes(data.minutesSinceQuit);
  progressFill.style.width = `${data.nextProgress}%`;
  progressLabel.textContent = `${data.nextProgress}% para o próximo marco`;

  if (data.next) {
    const remain = Math.max(0, data.next.minutes - data.minutesSinceQuit);
    nextCardEl.innerHTML = `
      <h4>${data.next.icon} Proximo marco: ${data.next.label}</h4>
      <p><strong>Falta:</strong> ${humanizeRemainingMinutes(remain)}</p>
      <p>${data.next.body}</p>
    `;
  } else {
    nextCardEl.innerHTML = '<h4>< Todos os marcos concluidos</h4><p>Seu corpo ja consolidou uma recuperacao extraordinaria. Continue celebrando sua jornada.</p>';
  }

  renderCategoryFilter();

  const all = (window.RespiraMilestones?.MILESTONES || []);
  const achievedIds = new Set(data.achieved.map(a => a.id));
  const filtered = all.filter(m => state.milestoneCategoryFilter === 'all' || m.category === state.milestoneCategoryFilter);
  listEl.innerHTML = filtered.map(m => milestoneCard(m, achievedIds.has(m.id), data.minutesSinceQuit)).join('');

  if (!state.milestoneIntroSeen && data.minutesSinceQuit < 20) {
    state.milestoneIntroSeen = true;
    saveData();
    showToast('Novidade: acompanhe os marcos do seu corpo em tempo real!');
  }
}

function openMilestoneModal(milestoneId) {
  const ms = (window.RespiraMilestones?.MILESTONES || []).find(m => m.id === milestoneId);
  if (!ms || !state.journeyStart) return;
  const modal = document.getElementById('milestone-modal');
  const t = document.getElementById('milestone-modal-title');
  const b = document.getElementById('milestone-modal-body');
  const d = document.getElementById('milestone-modal-date');
  if (!modal || !t || !b || !d) return;

  t.textContent = `${ms.icon} ${ms.title}`;
  b.textContent = ms.body;
  d.textContent = new Date(state.journeyStart + ms.minutes * 60000).toLocaleString('pt-BR');
  modal.classList.add('active');
}

function closeMilestoneModal() {
  document.getElementById('milestone-modal')?.classList.remove('active');
}

function handleMilestoneModalBackdrop(e) {
  if (e.target?.id === 'milestone-modal') closeMilestoneModal();
}

function showMilestoneCelebration(ms) {
  const overlay = document.getElementById('milestone-celebration-overlay');
  if (!overlay) return;
  document.getElementById('milestone-celebration-icon').textContent = ms.icon;
  document.getElementById('milestone-celebration-title').textContent = ms.title;
  document.getElementById('milestone-celebration-body').textContent = ms.body;
  overlay.classList.add('show');
  burstConfetti();
  setTimeout(() => overlay.classList.remove('show'), 4000);
}

function checkMilestoneRealtime() {
  if (!state.journeyStart || !window.RespiraMilestones) return;
  const data = useMilestones(new Date(state.journeyStart));
  if (!data.achieved.length) return;
  const latest = data.achieved[0];
  if (state.milestoneLastCelebratedId !== latest.id) {
    state.milestoneLastCelebratedId = latest.id;
    saveData();
    showMilestoneCelebration(latest);
  }
}

function clearMilestoneTimers() {
  milestoneTimeouts.forEach(id => clearTimeout(id));
  milestoneTimeouts = [];
}

function scheduleMilestoneNotifications(quitDate) {
  clearMilestoneTimers();
  if (!state.notifications || Notification?.permission !== 'granted' || !quitDate || !window.RespiraMilestones) return;

  const now = Date.now();
  const quitMs = new Date(quitDate).getTime();
  const future = window.RespiraMilestones.MILESTONES.filter(m => (quitMs + m.minutes * 60000) > now);

  future.forEach(ms => {
    if (state.milestoneNotifiedIds.includes(ms.id)) return;
    const delay = (quitMs + ms.minutes * 60000) - now;
    const timeoutId = setTimeout(() => {
      new Notification(`< ${ms.label}: ${ms.title}`, { body: ms.body.slice(0, 140), tag: `milestone-${ms.id}` });
      state.milestoneNotifiedIds.push(ms.id);
      saveData();
      checkMilestoneRealtime();
    }, Math.max(1000, delay));
    milestoneTimeouts.push(timeoutId);
  });
}

function handleRelapseReset() {
  if (!state.journeyStart) return;
  const previousDays = Math.floor((Date.now() - state.journeyStart) / 86400000);
  state.lastRelapseDays = previousDays;
  state.attemptsHistory.push({ endedAt: Date.now(), days: previousDays });
  state.journeyStart = Date.now();
  state.milestoneNotifiedIds = [];
  state.milestoneLastCelebratedId = null;
  saveData();
  scheduleMilestoneNotifications(new Date(state.journeyStart));
  showToast(`Voce conquistou ${previousDays} dia(s) na tentativa anterior. Recomear tambem e coragem.`);
}






