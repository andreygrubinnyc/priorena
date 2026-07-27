(function initializeSecurityUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PmSecurity = Object.freeze(api);
})(typeof globalThis === 'object' ? globalThis : this, function createSecurityUtils() {
  function escapeCsvCell(value) {
    let text = String(value == null ? '' : value);
    if (/^[\t\r]|^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function escapeMarkdownCell(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, '<br>');
  }

  return { escapeCsvCell, escapeMarkdownCell };
});
