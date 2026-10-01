/**
 * io/urlLoad.js
 *
 * Load .expt/.refl files named in the page address:
 *
 *   index.html?expt=<url>&refl=<url>[&expt=<url>&refl=<url> …]
 *
 * The URLs may be absolute (https://host/path/file.expt) or relative to the
 * page (refined.expt, /jobs/123/refined.expt). The files are downloaded with
 * fetch(), wrapped as File objects and passed to the same loadFiles() used by
 * the Open dialog and drag-and-drop, so everything downstream is unchanged.
 *
 * Browser rules that apply (see the wiki for details):
 *  - Files on the same server as the page load without restriction, and the
 *    user's login cookies are sent with the request.
 *  - Files on a different server load only if that server sends a CORS header
 *    (Access-Control-Allow-Origin) allowing this page's origin.
 *  - An https page cannot load http URLs, except http://localhost.
 */

import { showLoading, showError } from '../ui/statusbar.js';
import { store } from '../state/store.js';

/**
 * If the page address contains ?expt=…&refl=…, download and load them.
 * Several datasets can be given by repeating the pair; they are matched in
 * order and loaded one after another, as if opened in "add" mode:
 *
 *   ?expt=a.expt&refl=a.refl&expt=b.expt&refl=b.refl
 *
 * Does nothing if neither parameter is present.
 * @param {(expt: File, refl: File, mode: string) => Promise<void>} loadFiles
 */
export async function loadFromQuery(loadFiles) {
  const q = new URLSearchParams(window.location.search);
  const exptUrls = q.getAll('expt');
  const reflUrls = q.getAll('refl');
  if (exptUrls.length === 0 && reflUrls.length === 0) return;  // normal start-up
  if (exptUrls.length !== reflUrls.length) {
    showError(
      `The address has ${exptUrls.length} ?expt= and ${reflUrls.length}`
      + ' ?refl= parameters; they must come in pairs.');
    return;
  }

  // Download everything first (in parallel), so a bad URL is reported
  // before anything is loaded.
  let pairs;
  try {
    showLoading(exptUrls.length > 1
      ? `Downloading ${exptUrls.length} datasets…`
      : 'Downloading files…');
    pairs = await Promise.all(exptUrls.map((exptUrl, i) => Promise.all([
      fetchAsFile(exptUrl, '.expt'),
      fetchAsFile(reflUrls[i], '.refl'),
    ])));
  } catch (e) {
    showError(e.message || String(e));
    console.error(e);
    return;
  }

  // Load in order: the first replaces, the rest are added.
  for (let i = 0; i < pairs.length; i++) {
    const before = store.datasets.length;
    await loadFiles(pairs[i][0], pairs[i][1], i === 0 ? 'replace' : 'add');
    // loadFiles shows its own errors; stop so the message stays visible.
    if (store.datasets.length === before) return;
  }
}

/**
 * Download a URL and return it as a File.
 * @param {string} url  absolute, or relative to the page
 * @param {string} ext  expected extension ('.expt' or '.refl'); the parsers
 *                      recognise files by name, so it is added if missing
 */
async function fetchAsFile(url, ext) {
  const u = new URL(url, window.location.href);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error(`Only http(s) URLs are supported: ${url}`);
  }

  let resp;
  try {
    resp = await fetch(u);
  } catch (e) {
    // fetch() rejects without detail on network errors, blocked CORS and
    // blocked mixed content (https page → http URL).
    const crossOrigin = u.origin !== window.location.origin;
    throw new Error(
      `Could not download ${u.href}`
      + (crossOrigin
        ? ' (network error, or the server does not allow cross-origin'
          + ' access: it must send an Access-Control-Allow-Origin header)'
        : ' (network error)'));
  }
  if (!resp.ok) {
    throw new Error(
      `Could not download ${u.href} (HTTP ${resp.status} ${resp.statusText})`);
  }

  const blob = await resp.blob();
  let name = decodeURIComponent(u.pathname.split('/').pop() || '');
  if (!name.toLowerCase().endsWith(ext)) name = (name || 'remote') + ext;
  return new File([blob], name);
}
