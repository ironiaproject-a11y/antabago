const MILESTONES = [
  { id:'m20min', minutes:20 },{ id:'m8h', minutes:480 },{ id:'m24h', minutes:1440 },{ id:'m48h', minutes:2880 },{ id:'m72h', minutes:4320 },{ id:'m1w', minutes:10080 },{ id:'m2w', minutes:20160 },{ id:'m1m', minutes:43200 },{ id:'m3m', minutes:129600 },{ id:'m6m', minutes:259200 },{ id:'m1y', minutes:525600 },{ id:'m5y', minutes:2628000 },{ id:'m10y', minutes:5256000 },{ id:'m15y', minutes:7884000 }
];

function getMinutesSinceQuit(quitDate, now) {
  const quitMs = quitDate instanceof Date ? quitDate.getTime() : new Date(quitDate).getTime();
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
  if (!Number.isFinite(quitMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - quitMs) / 60000));
}

function calculateMilestones(quitDate, now) {
  const minutesSinceQuit = getMinutesSinceQuit(quitDate, now);
  const achievedAsc = MILESTONES.filter(m => minutesSinceQuit >= m.minutes);
  const achieved = achievedAsc.slice().reverse();
  const next = MILESTONES.find(m => minutesSinceQuit < m.minutes) || null;
  let nextProgress = 100;
  if (next) {
    const prev = achievedAsc.length ? achievedAsc[achievedAsc.length - 1] : null;
    const prevMinutes = prev ? prev.minutes : 0;
    const span = Math.max(1, next.minutes - prevMinutes);
    nextProgress = Math.round(Math.max(0, Math.min(100, ((minutesSinceQuit - prevMinutes) / span) * 100)));
  }
  return { achieved, next, nextProgress, minutesSinceQuit };
}

module.exports = { MILESTONES, calculateMilestones };
