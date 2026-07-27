(function initializeWorkItemTypes(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PmWorkItemTypes = Object.freeze(api);
})(typeof globalThis === 'object' ? globalThis : this, function createWorkItemTypes() {
  const ITEM_TYPES = Object.freeze(['Story', 'Epic', 'Feature', 'Task', 'Bug', 'Other', 'Unknown']);
  const aliases = new Map([
    ['story', 'Story'], ['user story', 'Story'],
    ['epic', 'Epic'], ['feature', 'Feature'], ['task', 'Task'],
    ['bug', 'Bug'], ['defect', 'Bug'], ['other', 'Other'], ['unknown', 'Unknown']
  ]);

  function normalizeItemType(value) {
    const key = String(value == null ? '' : value).trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    return aliases.get(key) || '';
  }

  function itemTypeOrUnknown(value) {
    return normalizeItemType(value) || 'Unknown';
  }

  return { ITEM_TYPES, normalizeItemType, itemTypeOrUnknown };
});
