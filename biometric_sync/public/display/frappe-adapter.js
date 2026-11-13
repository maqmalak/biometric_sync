/* Runs the local tool's Check-in Display on Frappe: its api() calls go to biometric_sync.display,
   settings come from Biometric Sync Settings. Loaded after core.js, so these definitions win. */
'use strict';

const API_MAP = { '/display/today': 'biometric_sync.display.today', '/devices': 'biometric_sync.display.devices',
  '/settings': 'biometric_sync.display.settings' };

async function api(path) {
  const [p, qs] = path.split('?');
  const method = API_MAP[p];
  if (!method) throw new ApiError('Not available here: ' + p, 404);
  let res;
  try { res = await fetch(`/api/method/${method}${qs ? '?' + qs : ''}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } }); }
  catch (e) { store.connected = false; throw new ApiError('Cannot reach the server.', 0); }
  if (res.status === 401 || res.status === 403) { location.href = '/login?redirect-to=' + encodeURIComponent('/checkin-display' + location.search); throw new ApiError('Login required', 401); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { store.connected = false; throw new ApiError((data._server_messages && 'Server error') || data.exception || res.statusText, res.status); }
  store.connected = true;
  return data.message;
}
async function loadDevices() { store.devices = await api('/devices'); return store.devices; }
async function loadSettings() { store.settings = await api('/settings'); return store.settings; }
function showLogin() { location.href = '/login?redirect-to=/checkin-display'; }
function toggleTheme() {
  const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('bas-theme', t); } catch (e) { /* ignore */ }
  emit('theme', t);
}

(async () => {
  try { const t = localStorage.getItem('bas-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) { /* ignore */ }
  store.connected = true;
  const view = document.getElementById('view');
  const args = new URLSearchParams(location.search).has('kiosk') ? ['kiosk'] : [];
  try { await Pages.display.render(view, args); }
  catch (e) { view.innerHTML = `<div class="dx-empty">${esc(e.message)}</div>`; }
})();
