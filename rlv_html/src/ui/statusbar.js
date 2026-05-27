/**
 * ui/statusbar.js
 * Status bar helpers.
 */

export function setStatus(text) {
  const el =
    document.getElementById('status-msg');
  if (el) el.textContent = text;
}

export function setSpotCount(
  visible, total
) {
  const el = document.getElementById(
    'status-count');
  if (!el) return;
  el.textContent = total !== undefined
    ? `${visible.toLocaleString()}`
      + ` / ${total.toLocaleString()}`
      + ` spots`
    : `${visible.toLocaleString()} spots`;
}

export function showLoading(text) {
  const el =
    document.getElementById('loading');
  if (!el) return;
  el.textContent = text || 'Loading…';
  el.style.display = 'flex';
}

export function hideLoading() {
  const el =
    document.getElementById('loading');
  if (el) el.style.display = 'none';
}

export function showError(text) {
  const el =
    document.getElementById('loading');
  if (!el) return;
  el.textContent = 'Error: ' + text;
  el.style.display = 'flex';
}
