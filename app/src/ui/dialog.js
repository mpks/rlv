/**
 * ui/dialog.js
 *
 * File open dialog for .expt/.refl pairs.
 * Supports two modes:
 *   replace — clears existing data first
 *   add     — merges with existing data
 *
 * Choosing both files at once (Ctrl/Shift-click in the file chooser) fills
 * both fields. In the desktop app, choosing one file also fills in its
 * partner from the same folder (indexed.expt ↔ indexed.refl); see
 * platform/desktop.js. A browser page can't look into the folder, so
 * there the user picks both together instead.
 */

let _pendingExpt = null;
let _pendingRefl = null;
let _onLoad      = null;

/**
 * Initialise the dialog.
 * onLoad(exptFile, reflFile, mode) is
 * called when the user clicks Load.
 * mode is 'replace' or 'add'.
 */
export function initDialog(onLoad) {
  _onLoad = onLoad;

  _el('btn-open-dials')
    ?.addEventListener('click',
      _openDialog);
  for (const kind of ['expt', 'refl']) {
    const input = _el(`dlg-${kind}-input`);
    if (!input) continue;
    // Allow picking both files in one go; each goes to the field matching
    // its extension.
    input.multiple = true;
    input.accept = '.expt,.refl';
    input.addEventListener('change', e =>
      _onPicked(kind, Array.from(e.target.files)));
  }
  _el('dlg-cancel')
    ?.addEventListener('click',
      _closeDialog);
  _el('dlg-load')
    ?.addEventListener('click',
      _onLoadClicked);
}

/**
 * Set the chosen .expt ('expt') or .refl ('refl') file, as if picked with
 * the Browse button. Used by the desktop app's native file dialog.
 */
export function setPendingFile(kind, file) {
  if (kind === 'expt') _pendingExpt = file;
  else _pendingRefl = file;
  _el(`dlg-${kind}-name`).value = file?.name ?? '';
}

/** True if a file has already been chosen for 'expt' or 'refl'. */
export function hasPendingFile(kind) {
  return kind === 'expt' ? !!_pendingExpt : !!_pendingRefl;
}

// ── Picking files ─────────────────────────

/**
 * Files chosen with the Browse button for `kind`. A file whose extension
 * says it is the other kind goes to the other field.
 */
function _onPicked(kind, files) {
  const seen = new Set();
  for (const f of files) {
    const k = _kindOf(f.name) ?? kind;
    if (seen.has(k)) continue;        // first file of each kind wins
    seen.add(k);
    setPendingFile(k, f);
  }
}

function _kindOf(name) {
  const m = /\.(expt|refl)$/i.exec(name);
  return m ? m[1].toLowerCase() : null;
}

// ── Open / close ──────────────────────────

function _openDialog() {
  _pendingExpt = null;
  _pendingRefl = null;
  _el('dlg-expt-name').value = '';
  _el('dlg-refl-name').value = '';
  _el('dlg-expt-input').value = '';
  _el('dlg-refl-input').value = '';
  _el('dlg-add-mode').checked = true;
  _el('dlg-open').style.display = 'flex';
}

function _closeDialog() {
  _el('dlg-open').style.display = 'none';
}

async function _onLoadClicked() {
  if (!_pendingExpt || !_pendingRefl) {
    alert(
      'Please select both files first');
    return;
  }
  const mode = _selectedMode();
  _closeDialog();
  if (_onLoad) {
    await _onLoad(
      _pendingExpt, _pendingRefl, mode);
  }
  _pendingExpt = null;
  _pendingRefl = null;
}

function _selectedMode() {
  return _el('dlg-add-mode')?.checked
    ? 'add' : 'replace';
}

function _el(id) {
  return document.getElementById(id);
}
