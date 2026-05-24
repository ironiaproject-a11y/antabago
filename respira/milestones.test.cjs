const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMilestones, MILESTONES } = require('./milestones.logic.cjs');

test('retorna minutos desde parada corretamente', () => {
  const quit = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date('2026-01-01T00:20:00.000Z');
  const result = calculateMilestones(quit, now);
  assert.equal(result.minutesSinceQuit, 20);
  assert.equal(result.achieved[0].id, 'm20min');
});

test('proximo milestone e progresso parcial entre marcos', () => {
  const quit = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date('2026-01-01T06:00:00.000Z'); // 360 min
  const result = calculateMilestones(quit, now);
  assert.equal(result.next.id, 'm8h');
  assert.ok(result.nextProgress > 0 && result.nextProgress < 100);
});

test('quando ultrapassa todos os marcos, next e null e progresso 100', () => {
  const quit = new Date('2000-01-01T00:00:00.000Z');
  const now = new Date('2026-01-01T00:00:00.000Z');
  const result = calculateMilestones(quit, now);
  assert.equal(result.next, null);
  assert.equal(result.nextProgress, 100);
  assert.equal(result.achieved.length, MILESTONES.length);
});

