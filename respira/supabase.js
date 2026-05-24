// supabase.js  Respira v3 Cloud Sync
// 
const SUPABASE_URL  = 'https://xxmwotnhfhxwhepermlq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bXdvdG5oZmh4d2hlcGVybWxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NjExMTksImV4cCI6MjA5NDQzNzExOX0.1ZobXvdw9trF-R7rEXCyB8jAb6ltsrK8N1az_NIIWr8';

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

//  Usu�rio atual 
let currentUser = null;
let _realtimeChannel = null;
let _otpEmail = ''; // guarda o e-mail para o passo 2

// 
// initFirebase  mantemos o mesmo nome para
// compatibilidade total com app.js
// 
function initFirebase(onReady) {
  // Timeout de seguran�a: se demorar mais de 5s, vai para login
  let _called = false;
  const _safeCall = (user) => {
    if (_called) return;
    _called = true;
    onReady(user);
  };
  const _timeout = setTimeout(() => {
    console.warn('Supabase getSession demorou demais  redirecionando para login.');
    _safeCall(null);
  }, 5000);

  _sb.auth.getSession()
    .then(({ data: { session }, error }) => {
      clearTimeout(_timeout);
      if (error) {
        console.error('Supabase getSession error:', error);
        _safeCall(null);
        return;
      }
      currentUser = session?.user ?? null;
      _safeCall(currentUser);
    })
    .catch((err) => {
      clearTimeout(_timeout);
      console.error('Supabase getSession falhou:', err);
      _safeCall(null);
    });

  _sb.auth.onAuthStateChange((_event, session) => {
    const prev = currentUser;
    currentUser = session?.user ?? null;
    if (!prev && currentUser) onReady(currentUser);
    if (prev && !currentUser) location.reload();
  });
}

// 
// PASSO 1  Envia c�digo OTP para o e-mail
// 
async function sendOTP() {
  const emailInput = document.getElementById('login-email');
  const email = emailInput?.value?.trim().toLowerCase();

  if (!email || !email.includes('@') || !email.includes('.')) {
    showLoginError('Digite um e-mail v�lido.');
    return;
  }

  // Bypass para testes / demonstra��o local
  if (email === 'teste@respira.app') {
    currentUser = { id: 'local-test-user', email: 'teste@respira.app' };
    document.getElementById('screen-login').classList.remove('active');
    if (typeof initFirebase === 'function') {
      // For�a a recarga para o app.js pegar o currentUser e ir pra Home
      location.reload();
    }
    return;
  }

  const btn = document.getElementById('btn-send-otp');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span>�</span> Enviando...'; }

  const { error } = await _sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true }
    // SEM emailRedirectTo   gera c�digo OTP de 6 d�gitos em vez de link
  });

  if (btn) { btn.disabled = false; btn.innerHTML = '<span>x</span> Enviar c�digo'; }

  if (error) {
    console.error('OTP error:', error);
    // Provavelmente Rate Limit do Supabase (limite de e-mails gratuitos)
    showLoginError(error.message.includes('rate') ? 'Limite de e-mails atingido. Tente novamente mais tarde.' : 'Erro: ' + error.message);
    return;
  }

  // Avan�a para o passo 2
  _otpEmail = email;
  document.getElementById('login-step-1').style.display = 'none';
  document.getElementById('login-step-2').style.display = 'block';
  document.getElementById('otp-email-display').textContent = email;
  setTimeout(() => document.getElementById('login-otp')?.focus(), 100);
}

// 
// PASSO 2  Verifica o c�digo digitado
// 
async function verifyOTP() {
  const token = document.getElementById('login-otp')?.value?.trim();

  if (!token || token.length !== 6) {
    showLoginError('Digite os 6 d�gitos do c�digo.');
    return;
  }

  const btn = document.getElementById('btn-verify-otp');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span>�</span> Verificando...'; }

  const { error } = await _sb.auth.verifyOtp({
    email: _otpEmail,
    token,
    type: 'email'
  });

  if (btn) { btn.disabled = false; btn.innerHTML = '<span>S&</span> Confirmar c�digo'; }

  if (error) {
    console.error('Verify OTP error:', error);
    showLoginError('C�digo inv�lido ou expirado. Tente novamente.');
    document.getElementById('login-otp').value = '';
    return;
  }

  // onAuthStateChange vai disparar e chamar initFirebase   onReady(user)
}

//  Volta para passo 1 (com auto-focus) 
function backToEmail() {
  document.getElementById('login-step-2').style.display = 'none';
  document.getElementById('login-step-1').style.display = 'block';
  document.getElementById('login-otp').value = '';
  document.getElementById('login-email').value = '';
  _otpEmail = '';
  setTimeout(() => document.getElementById('login-email')?.focus(), 100);
}

//  Exibe erro na tela de login 
function showLoginError(msg) {
  let err = document.getElementById('login-error');
  if (!err) {
    err = document.createElement('p');
    err.id = 'login-error';
    err.style.cssText = 'color:#FF6B6B;font-size:0.85rem;text-align:center;margin-top:12px;font-weight:600;';
    // Insere no card vis�vel
    const card = document.getElementById('login-step-2')?.style.display !== 'none'
      ? document.getElementById('login-step-2')
      : document.getElementById('login-step-1');
    card?.appendChild(err);
  }
  err.textContent = msg;
  setTimeout(() => { err.textContent = ''; }, 4000);
}

// 
// signInWithGoogle  mantemos o nome para compatibilidade
// (n�o usamos mais, mas evita erro se chamada de outro lugar)
// 
function signInWithGoogle() { sendOTP(); }

//  Logout 
async function doSignOut() {
  if (_realtimeChannel) {
    _sb.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
  await _sb.auth.signOut();
  location.reload();
}

//  Salvar na nuvem (com indicador de sync) 
async function saveToCloud(stateObj) {
  if (!currentUser) return;
  if (typeof showSyncIndicator === 'function') showSyncIndicator('syncing');
  const data = JSON.parse(JSON.stringify(stateObj));
  try {
    const { error } = await _sb
      .from('user_data')
      .upsert(
        { user_id: currentUser.id, data, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) throw error;
    if (typeof showSyncIndicator === 'function') showSyncIndicator('synced');
  } catch (e) {
    console.error('Erro ao salvar no banco:', e);
    if (typeof showSyncIndicator === 'function') showSyncIndicator('error');
  }
}

//  Carregar da nuvem 
async function loadFromCloud() {
  if (!currentUser) return null;
  try {
    const { data: rows, error } = await _sb
      .from('user_data')
      .select('data')
      .eq('user_id', currentUser.id)
      .single();
    if (error || !rows) return null;
    return rows.data;
  } catch (e) { return null; }
}

//  Listener em tempo real 
function subscribeToRealtime(onData) {
  if (!currentUser) return;
  if (_realtimeChannel) _sb.removeChannel(_realtimeChannel);

  _realtimeChannel = _sb
    .channel('user_data_realtime')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_data',
        filter: `user_id=eq.${currentUser.id}`
      },
      (payload) => {
        if (payload.new?.data) onData(payload.new.data);
      }
    )
    .subscribe();
}

window.RespiraSupabase = { client: _sb, getCurrentUser: () => currentUser };

