const test = require('node:test');
const assert = require('node:assert/strict');
const { generateInviteCode, validateInviteCode, createBuddyConnectionState, reduceBuddyState } = require('./buddy.logic.cjs');

test('gera convite com 6 caracteres validos', () => {
  const code = generateInviteCode(() => 0.1);
  assert.equal(code.length, 6);
  assert.equal(validateInviteCode(code), true);
});

test('valida formato do codigo', () => {
  assert.equal(validateInviteCode('A3K9PW'), true);
  assert.equal(validateInviteCode('abc123'), false);
  assert.equal(validateInviteCode('AAAAA'), false);
});

test('hook state transitions basicas', () => {
  let st = createBuddyConnectionState();
  st = reduceBuddyState(st, { type: 'invite_generated', inviteCode: 'A3K9PW', expiresAt: '2026-01-01T00:00:00Z' });
  assert.equal(st.inviteCode, 'A3K9PW');

  st = reduceBuddyState(st, { type: 'connected', connection: { id: '1', status: 'active' }, buddy: { id: '2', display_name: 'Joao' } });
  assert.equal(st.connection.status, 'active');
  assert.equal(st.buddy.display_name, 'Joao');

  st = reduceBuddyState(st, { type: 'ended' });
  assert.equal(st.connection, null);
  assert.equal(st.buddy, null);
});
