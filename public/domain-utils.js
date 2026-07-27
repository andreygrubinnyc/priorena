(function initializeDomainUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PmDomain = Object.freeze(api);
})(typeof globalThis === 'object' ? globalThis : this, function createDomainUtils() {
  const STATUS_ALIASES = new Map([
    ['done', 'Done'], ['complete', 'Done'], ['completed', 'Done'], ['resolved', 'Done'], ['closed', 'Done'],
    ['in progress', 'In progress'], ['in-progress', 'In progress'], ['ongoing', 'In progress'],
    ['blocked', 'Blocked'], ['on hold', 'Blocked'], ['active', 'Active'],
    ['planned', 'Planned'], ['to do', 'Planned'], ['todo', 'Planned'], ['backlog', 'Planned'], ['open', 'Planned'],
    ['not started', 'Not started'], ['not-started', 'Not started']
  ]);

  function inferOperatingStatus(value) {
    return STATUS_ALIASES.get(String(value == null ? '' : value).trim().toLowerCase()) || null;
  }

  function inferStoryStatus(story = {}) {
    const candidates = [];
    if (Array.isArray(story.labels)) candidates.push(...story.labels);
    else if (story.labels) candidates.push(...String(story.labels).split(','));
    candidates.push(story.jiraStatus, story.status);
    for (const candidate of candidates) {
      const status = inferOperatingStatus(candidate);
      if (status) return status;
    }
    if (Array.isArray(story.updates) && story.updates.length) return 'Active';
    return 'Not started';
  }

  function isAcceptableCommentTimestamp(value, nowMs = Date.now(), futureSkewMs = 5 * 60 * 1000) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) && timestamp <= nowMs + futureSkewMs;
  }

  function daysSinceTimestamp(value, nowMs = Date.now()) {
    if (!isAcceptableCommentTimestamp(value, nowMs, 0)) return null;
    return Math.floor((nowMs - Date.parse(value)) / 86400000);
  }

  function daysUntilCalendarDate(value, now = new Date()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    const [year, month, day] = String(value).split('-').map(Number);
    const target = Date.UTC(year, month - 1, day);
    if (!Number.isFinite(target)) return null;
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
  }

  return { inferOperatingStatus, inferStoryStatus, isAcceptableCommentTimestamp, daysSinceTimestamp, daysUntilCalendarDate };
});
