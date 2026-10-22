/**
 * ui/dialog.js
 *
 * File open dialog for .expt/.refl pairs.
 * Supports two modes:
 *   replace — clears existing data first
 *   add     — merges with existing data
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
  _el('dlg-expt-input')
    ?.addEventListener('change', e => {
      _pendingExpt = e.target.files[0];
      _el('dlg-expt-name').value =
        _pendingExpt?.name ?? '';
    });
  _el('dlg-refl-input')
    ?.addEventListener('change', e => {
      _pendingRefl = e.target.files[0];
      _el('dlg-refl-name').value =
        _pendingRefl?.name ?? '';
    });
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
