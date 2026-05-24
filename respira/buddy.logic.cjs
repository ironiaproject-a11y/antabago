function generateInviteCode(randomFn = Math.random) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(randomFn() * chars.length)];
  return out;
}

function validateInviteCode(code) {
  return /^[A-Z2-9]{6}$/.test(String(code || '').toUpperCase());
}

function createBuddyConnectionState() {
  return { connection: null, buddy: null, isLoading: false, error: null, inviteCode: null, inviteExpiresAt: null };
}

function reduceBuddyState(state, action) {
  switch (action.type) {
    case 'invite_generated':
      return { ...state, inviteCode: action.inviteCode, inviteExpiresAt: action.expiresAt };
    case 'connected':
      return { ...state, connection: action.connection, buddy: action.buddy, error: null };
    case 'ended':
      return { ...state, connection: null, buddy: null };
    case 'error':
      return { ...state, error: action.error };
    default:
      return state;
  }
}

module.exports = { generateInviteCode, validateInviteCode, createBuddyConnectionState, reduceBuddyState };
