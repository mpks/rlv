/**
 * ui/rangeSlider.js
 *
 * Double-handle range slider.
 *
 * createRangeSlider(el, opts) → { setRange(vMin, vMax, vLo, vHi) }
 *
 * el   — empty container div; receives class 'dbl-range-row'
 * opts:
 *   vMin, vMax       — internal value range
 *   vLo,  vHi        — initial thumb values
 *   toDisplay(v)     — internal → display string
 *   fromDisplay(s)   — display string → internal
 *   numLo, numHi     — optional <input type=number> to sync
 *   onLo(v)          — called when lo thumb changes
 *   onHi(v)          — called when hi thumb changes
 */
export function createRangeSlider(el, opts) {
  let {
    vMin = 0, vMax = 1, vLo = 0, vHi = 1,
    toDisplay   = v  => v.toFixed(2),
    fromDisplay = s  => parseFloat(s),
    numLo, numHi,
    onLo, onHi,
  } = opts;

  el.className  = 'dbl-range-row';
  el.innerHTML  =
    '<div class="dbl-range-track">'
    + '<div class="dbl-range-fill"></div>'
    + '<div class="dbl-range-thumb" data-t="lo"></div>'
    + '<div class="dbl-range-thumb" data-t="hi"></div>'
    + '</div>';

  const track = el.querySelector('.dbl-range-track');
  const fill  = el.querySelector('.dbl-range-fill');
  const tLo   = el.querySelector('[data-t="lo"]');
  const tHi   = el.querySelector('[data-t="hi"]');

  function _pct(v) {
    return vMax > vMin
      ? ((v - vMin) / (vMax - vMin)) * 100
      : 0;
  }

  function _fromPct(pct) {
    return vMin + (pct / 100) * (vMax - vMin);
  }

  function _clamp(v) {
    return Math.max(vMin, Math.min(vMax, v));
  }

  function _render() {
    const pLo = _pct(vLo);
    const pHi = _pct(vHi);
    tLo.style.left   = `${pLo}%`;
    tHi.style.left   = `${pHi}%`;
    fill.style.left  = `${pLo}%`;
    fill.style.width = `${pHi - pLo}%`;
    if (numLo && document.activeElement !== numLo)
      numLo.value = toDisplay(vLo);
    if (numHi && document.activeElement !== numHi)
      numHi.value = toDisplay(vHi);
  }

  function _startDrag(which, startEvent) {
    startEvent.preventDefault();
    function onMove(e) {
      const r = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100,
        (e.clientX - r.left) / r.width * 100));
      const v = _clamp(_fromPct(pct));
      if (which === 'lo') {
        vLo = Math.min(v, vHi);
        onLo?.(vLo);
      } else {
        vHi = Math.max(v, vLo);
        onHi?.(vHi);
      }
      _render();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    onMove(startEvent);
  }

  tLo.addEventListener('mousedown',
    e => _startDrag('lo', e));
  tHi.addEventListener('mousedown',
    e => _startDrag('hi', e));

  // Click on track/fill snaps nearest thumb
  track.addEventListener('mousedown', e => {
    if (e.target !== track && e.target !== fill) return;
    const r = track.getBoundingClientRect();
    const v = _clamp(_fromPct(
      (e.clientX - r.left) / r.width * 100));
    const which =
      Math.abs(v - vLo) <= Math.abs(v - vHi)
        ? 'lo' : 'hi';
    _startDrag(which, e);
  });

  if (numLo) {
    numLo.addEventListener('change', () => {
      const v = _clamp(fromDisplay(numLo.value));
      if (!isFinite(v)) return;
      vLo = Math.min(v, vHi);
      onLo?.(vLo);
      _render();
    });
    numLo.addEventListener('keydown', e => {
      if (e.key === 'Enter') numLo.blur();
      e.stopPropagation();
    });
  }

  if (numHi) {
    numHi.addEventListener('change', () => {
      const v = _clamp(fromDisplay(numHi.value));
      if (!isFinite(v)) return;
      vHi = Math.max(v, vLo);
      onHi?.(vHi);
      _render();
    });
    numHi.addEventListener('keydown', e => {
      if (e.key === 'Enter') numHi.blur();
      e.stopPropagation();
    });
  }

  _render();

  return {
    setRange(newMin, newMax, newLo, newHi) {
      vMin = newMin; vMax = newMax;
      vLo  = newLo;  vHi  = newHi;
      _render();
    },
  };
}
