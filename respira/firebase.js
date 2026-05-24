// firebase.js — Respira v3 Cloud Sync
// ─────────────────────────────────────────────
// ⚠️  PREENCHA COM SEUS DADOS DO FIREBASE CONSOLE
//     console.firebase.google.com → seu projeto →
//     ⚙️ Configurações → Seus apps → CDN
// ─────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "COLE_SUA_API_KEY_AQUI",
  authDomain:        "SEU_PROJETO.firebaseapp.com",
  projectId:         "SEU_PROJETO_ID",
  storageBucket:     "SEU_PROJETO.appspot.com",
  messagingSenderId: "SEU_SENDER_ID",
  appId:             "SEU_APP_ID"
};

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db   = firebase.firestore();

// Habilitar persistência offline (dados ficam no cache do browser)
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// ─── Usuário atual ──────────────────────────────
let currentUser = null;
let _unsubSnapshot = null;

// ─── Inicialização ──────────────────────────────
/**
 * Chama onReady(user) quando o estado de auth é conhecido.
 * user = null → não logado | user = objeto → logado
 */
function initFirebase(onReady) {
  auth.onAuthStateChanged(user => {
    currentUser = user;
    onReady(user);
  });
}

// ─── Login com Google ───────────────────────────
async function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
    // onAuthStateChanged vai disparar automaticamente
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showToast('Erro ao fazer login. Tente novamente.');
    }
  }
}

// ─── Logout ─────────────────────────────────────
async function doSignOut() {
  if (_unsubSnapshot) _unsubSnapshot();
  await auth.signOut();
  location.reload();
}

// ─── Salvar na nuvem (fire-and-forget) ──────────
function saveToCloud(stateObj) {
  if (!currentUser) return;
  // Cria cópia limpa — sem chaves de API (ficam só no localStorage)
  const { ...data } = stateObj;
  data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

  db.collection('users').doc(currentUser.uid)
    .set(data, { merge: true })
    .catch(() => {}); // falha silenciosa (offline etc.)
}

// ─── Carregar da nuvem ───────────────────────────
async function loadFromCloud() {
  if (!currentUser) return null;
  try {
    const snap = await db.collection('users').doc(currentUser.uid).get();
    if (!snap.exists) return null;
    const data = snap.data();
    delete data.updatedAt; // campo servidor, não faz parte do state
    return data;
  } catch(e) {
    return null; // offline ou sem permissão — usa localStorage
  }
}

// ─── Listener em tempo real ──────────────────────
// Atualiza o app quando o mesmo usuário edita em outro dispositivo
function subscribeToRealtime(onData) {
  if (!currentUser) return;
  if (_unsubSnapshot) _unsubSnapshot(); // cancela listener anterior
  _unsubSnapshot = db.collection('users').doc(currentUser.uid)
    .onSnapshot(snap => {
      if (snap.exists && !snap.metadata.hasPendingWrites) {
        const data = snap.data();
        delete data.updatedAt;
        onData(data);
      }
    }, () => {}); // ignora erros de rede
}
