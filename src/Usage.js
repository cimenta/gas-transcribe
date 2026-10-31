// Tracks how many billed Speech-to-Text seconds this app used in the current month, so the admin
// console can show how much of the monthly free quota is left. Counts only this app's own requests.
const Usage = {
  DEFAULT_FREE_MINUTES: 60,

  // The free quota is monthly; the month is taken in UTC.
  monthKey(date) {
    return date.toISOString().slice(0, 7);
  },

  record(usage, seconds, month) {
    const base = usage && usage.month === month ? usage.seconds : 0;
    const add = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    return { month, seconds: base + add };
  },

  summary(usage, month, freeMinutes) {
    const usedSeconds = usage && usage.month === month ? usage.seconds : 0;
    const limitSeconds = freeMinutes * 60;
    const percent = limitSeconds > 0 ? Math.min(100, Math.round((usedSeconds / limitSeconds) * 100)) : 100;
    return {
      month,
      usedSeconds,
      limitSeconds,
      remainingSeconds: Math.max(0, limitSeconds - usedSeconds),
      percent,
      exceeded: usedSeconds >= limitSeconds,
    };
  },
};

const USAGE_KEY = 'usage';

function readUsage_() {
  const raw = Settings_get_(USAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

// Called under the script lock of pollOperations_, so concurrent updates cannot lose seconds.
function recordUsage_(seconds) {
  Settings_set_(USAGE_KEY, JSON.stringify(Usage.record(readUsage_(), seconds, Usage.monthKey(new Date()))));
}

function getUsageSummary_() {
  return Usage.summary(readUsage_(), Usage.monthKey(new Date()), getSettings_().freeMinutes);
}

if (typeof module !== 'undefined') module.exports = Usage;
