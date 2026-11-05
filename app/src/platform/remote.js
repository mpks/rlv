/**
 * platform/remote.js
 *
 * "Remote…" button: open .expt/.refl files from another machine over SSH.
 * Desktop app only (imported by platform/desktop.js).
 *
 * The SSH work is done by the app's Rust side (src-tauri/src/remote.rs),
 * which runs the system `ssh`. Version 1 supports key-based login only.
 *
 * File names from the remote machine are untrusted: they are only ever put
 * on the page with textContent, never innerHTML.
 */

import { showLoading, showError } from '../ui/statusbar.js';

const RECENT_KEY    = 'rlv.remote.recentHosts';
const LAST_HOST_KEY = 'rlv.remote.lastHost';
const dirKey = host => `rlv.remote.lastDir.${host}`;
const MAX_RECENT = 8;

/**
 * invoke: Tauri's invoke function.
 * onLoad(exptFile, reflFile, mode): the same loader the Open dialog uses.
 */
export function initRemote(invoke, onLoad) {
  _injectStyle();
  const ui = _buildDialog();
  _addToolbarButton(openDialog);

  let host = null;   // host of the current listing
  let dir = null;    // folder of the current listing
  let entries = [];
  let expt = null;   // chosen remote paths
  let refl = null;
  let busy = false;

  // ── Dialog ─────────────────────────────────────────────────

  async function openDialog() {
    expt = refl = null;
    _showChosen();
    ui.root.style.display = 'flex';
    ui.host.value = _load(LAST_HOST_KEY) ?? '';
    ui.host.focus();

    // Host suggestions: hosts used before, then ~/.ssh/config.
    let configHosts = [];
    try { configHosts = await invoke('remote_hosts'); } catch { /* none */ }
    const names = [...new Set([..._recentHosts(), ...configHosts])];
    ui.hostList.replaceChildren(...names.map(n => {
      const o = document.createElement('option');
      o.value = n;
      return o;
    }));
    if (!host) _setMessage('Choose a host and click Connect.');
  }

  function closeDialog() {
    ui.root.style.display = 'none';
  }

  // ── Connecting and browsing ────────────────────────────────

  async function connect() {
    const h = ui.host.value.trim();
    if (!h) { _setMessage('Enter a host, e.g. user@login.example.ac.uk'); return; }
    const lastDir = _load(dirKey(h)) ?? '';
    try {
      await list(h, lastDir, `Connecting to ${h}…`);
    } catch (e) {
      // The remembered folder may be gone: fall back to the home folder.
      if (lastDir && e.kind === 'remote') {
        try { await list(h, '', `Connecting to ${h}…`); return; } catch (e2) { e = e2; }
      }
      _setMessage(_errText(e), true);
    }
  }

  /** List a folder; throws the Rust error ({kind, message}) on failure. */
  async function list(h, d, message = 'Loading…') {
    if (busy) return;
    _setBusy(true);
    _setMessage(message);
    try {
      const res = await invoke('remote_list', { host: h, dir: d });
      if (h !== host) { expt = refl = null; _showChosen(); }
      host = h;
      dir = res.dir;
      entries = res.entries;
      _save(LAST_HOST_KEY, h);
      _save(dirKey(h), dir);
      _addRecent(h);
      ui.path.value = dir;
      _render();
    } finally {
      _setBusy(false);
    }
  }

  async function go(d) {
    if (!host) return;
    try { await list(host, d); }
    catch (e) { _setMessage(_errText(e), true); }
  }

  function _render() {
    const dirs  = entries.filter(e => e.is_dir && !e.name.startsWith('.'));
    const files = entries.filter(e => !e.is_dir && /\.(expt|refl)$/i.test(e.name));
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
    dirs.sort(byName);
    files.sort(byName);
    const hidden = entries.length - dirs.length - files.length;

    const rows = [];
    for (const e of dirs) {
      rows.push(_row('📁', e.name + '/', '', 'rlvr-dir', () => go(_join(dir, e.name))));
    }
    for (const e of files) {
      const path = _join(dir, e.name);
      const row = _row('📄', e.name, _size(e.size), 'rlvr-file', () => choose(path));
      if (path === expt || path === refl) row.classList.add('rlvr-chosen');
      rows.push(row);
    }
    ui.list.replaceChildren(...rows);
    if (rows.length === 0) _setMessage('No folders or .expt/.refl files here.');
    else _setMessage(hidden ? `${hidden} other item(s) not shown.` : '');
  }

  function choose(path) {
    const isExpt = /\.expt$/i.test(path);
    if (isExpt) expt = path; else refl = path;
    // Pick the matching partner (indexed.expt ↔ indexed.refl) if not chosen.
    const stem = _basename(path).replace(/\.(expt|refl)$/i, '');
    const partner = entries.find(e =>
      !e.is_dir && e.name.toLowerCase() === `${stem}.${isExpt ? 'refl' : 'expt'}`.toLowerCase());
    if (partner) {
      if (isExpt && !refl) refl = _join(dir, partner.name);
      if (!isExpt && !expt) expt = _join(dir, partner.name);
    }
    _showChosen();
    _render();
  }

  // ── Loading ────────────────────────────────────────────────

  async function load() {
    if (!expt || !refl) {
      _setMessage('Choose both a .expt and a .refl file.', true);
      return;
    }
    const mode = ui.addMode.checked ? 'add' : 'replace';
    const [h, e, r] = [host, expt, refl];
    closeDialog();
    try {
      showLoading(`Downloading ${_basename(e)} from ${h}…`);
      const eBytes = await invoke('remote_read', { host: h, path: e });
      showLoading(`Downloading ${_basename(r)} from ${h}…`);
      const rBytes = await invoke('remote_read', { host: h, path: r });
      await onLoad(new File([eBytes], _basename(e)),
                   new File([rBytes], _basename(r)), mode);
    } catch (err) {
      showError(_errText(err));
      console.error(err);
    }
  }

  // ── Small UI helpers ───────────────────────────────────────

  function _showChosen() {
    ui.expt.value = expt ? _basename(expt) : '';
    ui.expt.title = expt ?? '';
    ui.refl.value = refl ? _basename(refl) : '';
    ui.refl.title = refl ?? '';
  }

  function _setMessage(text, isError = false) {
    ui.msg.textContent = text;
    ui.msg.classList.toggle('rlvr-error', isError);
  }

  function _setBusy(b) {
    busy = b;
    for (const el of [ui.connect, ui.up, ui.load]) el.disabled = b;
    ui.root.classList.toggle('rlvr-busy', b);
  }

  // ── Wiring ─────────────────────────────────────────────────

  ui.connect.addEventListener('click', connect);
  ui.host.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
  ui.up.addEventListener('click', () => {
    if (dir && dir !== '/') go(dir.replace(/\/[^/]*$/, '') || '/');
  });
  ui.path.addEventListener('keydown', e => {
    if (e.key === 'Enter') go(ui.path.value.trim());
  });
  ui.cancel.addEventListener('click', closeDialog);
  ui.load.addEventListener('click', load);
  ui.root.addEventListener('keydown', e => { if (e.key === 'Escape') closeDialog(); });
}

// ── Building the dialog ───────────────────────────────────────

function _addToolbarButton(onClick) {
  const open = document.getElementById('btn-open-dials');
  if (!open) return;
  const btn = document.createElement('button');
  btn.className = 'tbtn';
  btn.id = 'btn-open-remote';
  btn.textContent = 'Remote…';
  btn.title = 'Open .expt/.refl files from another machine over SSH';
  btn.addEventListener('click', onClick);
  open.before(btn);
}

function _buildDialog() {
  const root = document.createElement('div');
  root.id = 'dlg-remote';
  root.className = 'rlvr-overlay';
  root.innerHTML = `
    <div class="rlvr-box">
      <div class="rlvr-title">Open files over SSH</div>

      <div class="rlvr-label">Host (an alias from ~/.ssh/config, or user@host)</div>
      <div class="rlvr-row-flex">
        <input class="rlvr-input" data-id="host" list="rlvr-hosts"
               placeholder="e.g. cluster" spellcheck="false" autocomplete="off">
        <datalist id="rlvr-hosts" data-id="hostList"></datalist>
        <button class="rlvr-btn rlvr-primary" data-id="connect">Connect</button>
      </div>

      <div class="rlvr-row-flex" style="margin-top:10px">
        <button class="rlvr-btn" data-id="up" title="Parent folder">↑</button>
        <input class="rlvr-input" data-id="path" spellcheck="false"
               placeholder="folder (press Enter to open)">
      </div>
      <div class="rlvr-list" data-id="list"></div>
      <div class="rlvr-msg" data-id="msg"></div>

      <div class="rlvr-label">Experiment file (.expt)</div>
      <input class="rlvr-input rlvr-chosen-field" data-id="expt" readonly
             placeholder="click a .expt file above">
      <div class="rlvr-label">Reflections file (.refl)</div>
      <input class="rlvr-input rlvr-chosen-field" data-id="refl" readonly
             placeholder="click a .refl file above">

      <label class="rlvr-check">
        <input type="checkbox" data-id="addMode" checked> Add to current data
      </label>

      <div class="rlvr-buttons">
        <button class="rlvr-btn" data-id="cancel">Cancel</button>
        <button class="rlvr-btn rlvr-primary" data-id="load">Load</button>
      </div>
      <div class="rlvr-note">Uses your SSH keys. Password login is not supported yet.</div>
    </div>`;
  document.body.appendChild(root);

  const ui = { root };
  for (const el of root.querySelectorAll('[data-id]')) ui[el.dataset.id] = el;
  return ui;
}

function _injectStyle() {
  const style = document.createElement('style');
  style.textContent = `
    .rlvr-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.7);
      align-items:center; justify-content:center; z-index:9999; }
    .rlvr-box { background:#111118; border:1px solid #2a2a3a; border-radius:10px;
      padding:24px; width:520px; max-width:calc(100vw - 32px); }
    .rlvr-title { font-size:15px; font-weight:600; color:#eee; margin-bottom:16px; }
    .rlvr-label { font-size:11px; color:#aaa; margin:10px 0 4px; }
    .rlvr-row-flex { display:flex; gap:6px; }
    .rlvr-input { flex:1; min-width:0; box-sizing:border-box; width:100%;
      background:#0d0d14; border:1px solid #333; border-radius:4px;
      color:#ccc; font-size:11px; padding:4px 8px; }
    .rlvr-chosen-field { color:#7ab8f5; }
    .rlvr-btn { padding:4px 10px; background:transparent; border:1px solid #333;
      border-radius:4px; color:#999; font-size:11px; cursor:pointer; white-space:nowrap; }
    .rlvr-btn:hover:not(:disabled) { background:#1e1e2e; }
    .rlvr-btn:disabled { opacity:.5; cursor:default; }
    .rlvr-primary { background:#152a42; border-color:#185FA5; color:#7ab8f5; font-weight:600; }
    .rlvr-list { margin-top:6px; height:240px; overflow-y:auto; background:#0d0d14;
      border:1px solid #333; border-radius:4px; font-size:12px; }
    .rlvr-busy .rlvr-list { opacity:.5; }
    .rlvr-item { display:flex; gap:8px; padding:3px 8px; cursor:pointer; color:#bbb; }
    .rlvr-item:hover { background:#1e1e2e; }
    .rlvr-item .rlvr-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .rlvr-item .rlvr-size { color:#666; }
    .rlvr-file { color:#ddd; }
    .rlvr-chosen { background:#152a42; color:#7ab8f5; }
    .rlvr-msg { min-height:16px; font-size:11px; color:#888; margin-top:4px; }
    .rlvr-msg.rlvr-error { color:#e88; }
    .rlvr-check { display:flex; align-items:center; gap:6px; cursor:pointer;
      font-size:12px; color:#aaa; margin:14px 0 16px; }
    .rlvr-buttons { display:flex; justify-content:flex-end; gap:8px; }
    .rlvr-buttons .rlvr-btn { padding:6px 16px; font-size:13px; }
    .rlvr-note { font-size:10px; color:#666; margin-top:10px; }
  `;
  document.head.appendChild(style);
}

/** One list row. Remote names go in with textContent only. */
function _row(icon, name, size, cls, onClick) {
  const row = document.createElement('div');
  row.className = `rlvr-item ${cls}`;
  const i = document.createElement('span');
  i.textContent = icon;
  const n = document.createElement('span');
  n.className = 'rlvr-name';
  n.textContent = name;
  n.title = name;
  const s = document.createElement('span');
  s.className = 'rlvr-size';
  s.textContent = size;
  row.append(i, n, s);
  row.addEventListener('click', onClick);
  return row;
}

// ── Helpers ───────────────────────────────────────────────────

function _join(d, name) {
  return d.endsWith('/') ? d + name : `${d}/${name}`;
}

function _basename(path) {
  return path.split('/').pop();
}

function _size(bytes) {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v < 10 && u ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

function _errText(e) {
  return e?.message ?? String(e);
}

function _recentHosts() {
  try { return JSON.parse(_load(RECENT_KEY) ?? '[]'); } catch { return []; }
}

function _addRecent(h) {
  const list = [h, ..._recentHosts().filter(x => x !== h)].slice(0, MAX_RECENT);
  _save(RECENT_KEY, JSON.stringify(list));
}

// localStorage can be unavailable; these settings are only conveniences.
function _load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function _save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
