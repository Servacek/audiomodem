/**
 * freq-range-picker.js
 *
 * Posuvny vyber TX frekvencneho spektra.
 *
 * Klucove spravanie:
 *  - Presuvanie sa prichytava na najblizsi FFT bin (freq_bin_hz).
 *  - Manualne cislove vstupy akceptuju lubovolne hodnoty, ale ukazu varovanie
 *    a navrh najblizsieho binu, ak hodnota nie je nasobkom binu.
 *  - Popisky nad trackom ukazuju hodnotu v Hz a index binu.
 *  - "Frekvencia A / B" je nahradena explicitnym oznacenim Min / Max s kratkou
 *    poznamkou, aby si pouzivatelia nesplietli s bitmi 0/1.
 */

/**
 * @param {object}  mp        modem profile (needs sample_rate, min_tx_freq,
 *                            max_tx_freq, freq_bin_hz)
 * @param {string}  idSuffix  profile id or 'default'
 * @param {boolean} readonly
 */
export function renderFreqPicker(mp, idSuffix, readonly) {
    const nyquist = Math.round(mp.sample_rate / 2);
    const minF    = mp.min_tx_freq ?? 800;
    const maxF    = mp.max_tx_freq ?? 1600;
    const binHz   = mp.freq_bin_hz || 1;           // FFT bin size in Hz
    const bw      = Math.abs(maxF - minF);

    const alignedA = isAligned(minF, binHz);
    const alignedB = isAligned(maxF, binHz);

    const inputAttrs = (field, val) => readonly
        ? `type="number" value="${val}" disabled`
        : `type="number" value="${val}"
           data-profile-id="${idSuffix}" data-field="${field}"
           min="0" max="${nyquist}" step="1"
           id="freq-input-${field}-${idSuffix}"`;

    return `
    <div class="freq-picker-wrap" id="freq-picker-${idSuffix}"
         data-profile-id="${idSuffix}"
         data-nyquist="${nyquist}"
         data-bin-hz="${binHz}"
         data-readonly="${readonly ? '1' : '0'}">

        <!-- Header -->
        <div class="freq-picker-header">
            <span class="freq-picker-label">
                <i class="fas fa-wave-square"></i>
                Frekvenčné spektrum TX
            </span>
            <div class="freq-picker-header-right">
                <span class="freq-picker-bin-info" title="Veľkosť FFT binu — frekvencie by mali byť násobkami tejto hodnoty">
                    <i class="fas fa-th-large"></i>
                    Bin: ${formatHz(binHz)}
                </span>
                <span class="freq-picker-bw" id="freq-bw-${idSuffix}">
                    BW: <strong>${formatHz(bw)}</strong>
                </span>
            </div>
        </div>

        <!-- Track -->
        <div class="freq-picker-track${readonly ? ' freq-picker-track--readonly' : ''}"
             id="freq-track-${idSuffix}">

            <!-- Bin grid lines (painted by JS) -->
            <div class="freq-picker-bin-grid" id="freq-grid-${idSuffix}"></div>

            <div class="freq-picker-band" id="freq-band-${idSuffix}"></div>

            <!-- Min handle -->
            <div class="freq-picker-handle freq-picker-handle--min${readonly ? ' freq-picker-handle--readonly' : ''}"
                 id="freq-handle-min-${idSuffix}"
                 data-handle="min"
                 tabindex="${readonly ? -1 : 0}"
                 role="slider" aria-label="Min TX frekvencia"
                 aria-valuemin="0" aria-valuemax="${nyquist}" aria-valuenow="${minF}">
                <div class="freq-picker-handle-pip"></div>
                <div class="freq-picker-handle-label" id="freq-hlabel-min-${idSuffix}">
                    <span class="freq-hlabel-tag freq-hlabel-tag--min">MIN</span>
                    <span class="freq-hlabel-val">${formatHz(minF)}</span>
                    <span class="freq-hlabel-bin">#${Math.round(minF / binHz)}</span>
                </div>
            </div>

            <!-- Max handle -->
            <div class="freq-picker-handle freq-picker-handle--max${readonly ? ' freq-picker-handle--readonly' : ''}"
                 id="freq-handle-max-${idSuffix}"
                 data-handle="max"
                 tabindex="${readonly ? -1 : 0}"
                 role="slider" aria-label="Max TX frekvencia"
                 aria-valuemin="0" aria-valuemax="${nyquist}" aria-valuenow="${maxF}">
                <div class="freq-picker-handle-pip"></div>
                <div class="freq-picker-handle-label" id="freq-hlabel-max-${idSuffix}">
                    <span class="freq-hlabel-tag freq-hlabel-tag--max">MAX</span>
                    <span class="freq-hlabel-val">${formatHz(maxF)}</span>
                    <span class="freq-hlabel-bin">#${Math.round(maxF / binHz)}</span>
                </div>
            </div>
        </div>

        <!-- Axis ticks -->
        <div class="freq-picker-axis" id="freq-axis-${idSuffix}"></div>

        <!-- Inputs + Measure button -->
        <div class="freq-picker-inputs">

            <!-- Min input -->
            <div class="freq-picker-input-group">
                <div class="freq-picker-input-header">
                    <label class="freq-picker-input-label">
                        <span class="freq-input-tag freq-input-tag--min">MIN</span>
                        Min TX frekvencia
                    </label>
                </div>
                <div class="freq-picker-input-row">
                    <input ${inputAttrs('min_tx_freq', minF)}>
                    <span class="freq-picker-input-unit">Hz</span>
                </div>
                <div class="freq-align-hint" id="freq-align-min-${idSuffix}"
                     style="display:${alignedA || readonly ? 'none' : 'flex'}">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span id="freq-align-min-text-${idSuffix}">Nie je nasobok binu</span>
                </div>
            </div>

            <!-- Measure button -->
            <div class="freq-picker-measure-wrap">
                ${readonly ? '<div></div>' : `
                <button type="button" class="freq-picker-measure-btn"
                        id="freq-measure-${idSuffix}"
                        title="Automaticky odmerat pouzitelne spektrum media">
                    <span class="freq-measure-icon-wrap">
                        <i class="fas fa-satellite-dish freq-measure-icon-dish"></i>
                        <span class="freq-measure-ripple"></span>
                    </span>
                    <span class="freq-measure-label">Odmerat medium</span>
                </button>`}
            </div>

            <!-- Max input -->
            <div class="freq-picker-input-group freq-picker-input-group--right">
                <div class="freq-picker-input-header freq-picker-input-header--right">
                    <label class="freq-picker-input-label">
                        Max TX frekvencia
                        <span class="freq-input-tag freq-input-tag--max">MAX</span>
                    </label>
                </div>
                <div class="freq-picker-input-row">
                    <span class="freq-picker-input-unit">Hz</span>
                    <input ${inputAttrs('max_tx_freq', maxF)}>
                </div>
                <div class="freq-align-hint freq-align-hint--right" id="freq-align-max-${idSuffix}"
                     style="display:${alignedB || readonly ? 'none' : 'flex'}">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span id="freq-align-max-text-${idSuffix}">Nie je nasobok binu</span>
                </div>
            </div>
        </div>

        <!-- Clarifying note -->
        <p class="freq-picker-note">
            <i class="fas fa-info-circle"></i>
            Min/Max urcuje rozsah spektra, nie frekvencie pre konkretne bity.
            Pre minimalne spektralne uniky by mali byt hodnoty nasobkami velkosti FFT binu (${formatHz(binHz)}).
        </p>
    </div>`;
}

// --- Inicializacia ---

export function initFreqPickers() {
    document.querySelectorAll('.freq-picker-wrap').forEach(initSinglePicker);
}

function initSinglePicker(wrap) {
    const idSuffix = wrap.dataset.profileId;
    const readonly = wrap.dataset.readonly === '1';
    const nyquist  = parseInt(wrap.dataset.nyquist, 10);
    const binHz    = parseFloat(wrap.dataset.binHz) || 1;

    const track      = document.getElementById(`freq-track-${idSuffix}`);
    const band       = document.getElementById(`freq-band-${idSuffix}`);
    const gridEl     = document.getElementById(`freq-grid-${idSuffix}`);
    const bwEl       = document.getElementById(`freq-bw-${idSuffix}`);
    const axisEl     = document.getElementById(`freq-axis-${idSuffix}`);
    const inputMin   = document.getElementById(`freq-input-min_tx_freq-${idSuffix}`);
    const inputMax   = document.getElementById(`freq-input-max_tx_freq-${idSuffix}`);
    const hintMin    = document.getElementById(`freq-align-min-${idSuffix}`);
    const hintMax    = document.getElementById(`freq-align-max-${idSuffix}`);
    const hintMinTxt = document.getElementById(`freq-align-min-text-${idSuffix}`);
    const hintMaxTxt = document.getElementById(`freq-align-max-text-${idSuffix}`);
    const measureBtn = document.getElementById(`freq-measure-${idSuffix}`);

    if (!track || !band) return;

    let valMin = inputMin ? (parseInt(inputMin.value, 10) || 800)  : 800;
    let valMax = inputMax ? (parseInt(inputMax.value, 10) || 1600) : 1600;

    buildAxis(axisEl, nyquist);
    buildBinGrid(gridEl, nyquist, binHz);
    paint();

    if (readonly) return;

    // --- Presuvanie ---

    let dragging = null;

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function snapToGrid(hz) {
        // Snap to nearest FFT bin multiple
        return Math.round(hz / binHz) * binHz;
    }

    function pxToHz(clientX) {
        const rect = track.getBoundingClientRect();
        const t    = clamp((clientX - rect.left) / rect.width, 0, 1);
        return snapToGrid(t * nyquist);
    }

    // Clone handles to drop stale listeners on re-init
    ['min', 'max'].forEach(which => {
        const el = document.getElementById(`freq-handle-${which}-${idSuffix}`);
        if (!el) return;
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
    });

    const hMin = document.getElementById(`freq-handle-min-${idSuffix}`);
    const hMax = document.getElementById(`freq-handle-max-${idSuffix}`);

    function onPointerDown(e) {
        if (e.button !== 0) return;
        dragging = e.currentTarget.dataset.handle;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
    }

    function onPointerMove(e) {
        if (!dragging) return;
        const hz = pxToHz(e.clientX);
        if (dragging === 'min') {
            valMin = clamp(hz, 0, valMax - binHz);
        } else {
            valMax = clamp(hz, valMin + binHz, nyquist);
        }
        paint();
        if (dragging === 'min' && inputMin) inputMin.value = valMin;
        if (dragging === 'max' && inputMax) inputMax.value = valMax;
    }

    function onPointerUp() {
        if (!dragging) return;
        const input = dragging === 'min' ? inputMin : inputMax;
        dragging = null;
        if (input) input.dispatchEvent(new Event('change', { bubbles: true }));
        // Drag always produces bin-aligned values, so no hint needed
        updateHints();
    }

    function onKeyDown(e) {
        const handle = e.currentTarget.dataset.handle;
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
        e.preventDefault();

        // Arrow key step = 1 bin; Shift = 10 bins
        const step = (e.shiftKey ? 10 : 1) * binHz;
        const dir  = (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 1 : -1;

        if (handle === 'min') {
            valMin = clamp(valMin + dir * step, 0, valMax - binHz);
            if (inputMin) { inputMin.value = valMin; inputMin.dispatchEvent(new Event('change', { bubbles: true })); }
        } else {
            valMax = clamp(valMax + dir * step, valMin + binHz, nyquist);
            if (inputMax) { inputMax.value = valMax; inputMax.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        paint();
        updateHints();
    }

    [hMin, hMax].forEach(h => {
        if (!h) return;
        h.addEventListener('pointerdown', onPointerDown);
        h.addEventListener('pointermove', onPointerMove);
        h.addEventListener('pointerup',   onPointerUp);
        h.addEventListener('keydown',     onKeyDown);
    });

    // --- Synchronizacia vstupov -> ovladace ---

    if (inputMin) {
        inputMin.addEventListener('input', () => {
            const v = parseInt(inputMin.value, 10);
            if (!isNaN(v)) { valMin = clamp(v, 0, valMax - 1); paint(); updateHints(); }
        });
    }
    if (inputMax) {
        inputMax.addEventListener('input', () => {
            const v = parseInt(inputMax.value, 10);
            if (!isNaN(v)) { valMax = clamp(v, valMin + 1, nyquist); paint(); updateHints(); }
        });
    }

    // --- Tlacidlo merania ---

    if (measureBtn) {
        measureBtn.addEventListener('click', () => {
            if (measureBtn.classList.contains('freq-measure-btn--scanning')) return;
            measureBtn.classList.add('freq-measure-btn--scanning');
            // TODO: wire up real spectrum analyser here.
            setTimeout(() => measureBtn.classList.remove('freq-measure-btn--scanning'), 2400);
        });
    }

    // --- Hinty zarovnania ---

    function updateHints() {
        showHint(hintMin, hintMinTxt, valMin, binHz);
        showHint(hintMax, hintMaxTxt, valMax, binHz);
    }

    // --- Kreslenie ---

    function paint() {
        const loPct  = (valMin / nyquist) * 100;
        const hiPct  = (valMax / nyquist) * 100;
        const bw     = Math.abs(valMax - valMin);

        band.style.left  = `${loPct}%`;
        band.style.width = `${hiPct - loPct}%`;

        const hMin2 = document.getElementById(`freq-handle-min-${idSuffix}`);
        const hMax2 = document.getElementById(`freq-handle-max-${idSuffix}`);

        updateHandle(hMin2, `freq-hlabel-min-${idSuffix}`, valMin, loPct, binHz, 'MIN', false);
        updateHandle(hMax2, `freq-hlabel-max-${idSuffix}`, valMax, hiPct, binHz, 'MAX', true);

        if (bwEl) bwEl.innerHTML = `BW: <strong>${formatHz(bw)}</strong>`;
    }
}

// --- Verejne: obnov ked sa sample_rate / freq_bin_hz zmenia ---

export function updateFreqPickerRange(idSuffix, mp) {
    const wrap = document.getElementById(`freq-picker-${idSuffix}`);
    if (!wrap) return;
    wrap.dataset.nyquist = Math.round(mp.sample_rate / 2);
    wrap.dataset.binHz   = mp.freq_bin_hz || 1;
    initSinglePicker(wrap);
}

// --- Pomocne funkcie ---

function isAligned(hz, binHz) {
    if (binHz <= 0) return true;
    return Math.abs(hz % binHz) < 0.5;
}

function nearestBin(hz, binHz) {
    return Math.round(hz / binHz) * binHz;
}

function formatHz(hz) {
    if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 2)} kHz`;
    return `${Math.round(hz * 10) / 10} Hz`;
}

function showHint(hintEl, textEl, val, binHz) {
    if (!hintEl) return;
    const aligned = isAligned(val, binHz);
    hintEl.style.display = aligned ? 'none' : 'flex';
    if (!aligned && textEl) {
        const suggested = nearestBin(val, binHz);
        textEl.textContent = `Nie je nasobok binu - najblizsi: ${formatHz(suggested)}`;
    }
}

function updateHandle(handleEl, labelId, val, pct, binHz, tag, isMax) {
    if (!handleEl) return;
    handleEl.style.left = `${pct}%`;
    handleEl.setAttribute('aria-valuenow', val);

    const aligned = isAligned(val, binHz);
    handleEl.classList.toggle('freq-picker-handle--misaligned', !aligned);

    const labelEl = document.getElementById(labelId);
    if (!labelEl) return;

    const binIdx = binHz > 0 ? Math.round(val / binHz) : '?';
    labelEl.innerHTML = `
        <span class="freq-hlabel-tag freq-hlabel-tag--${isMax ? 'max' : 'min'}">${tag}</span>
        <span class="freq-hlabel-val">${formatHz(val)}</span>
        <span class="freq-hlabel-bin${aligned ? '' : ' freq-hlabel-bin--warn'}">#${binIdx}</span>`;

    // Edge clamping so labels don't overflow the track
    labelEl.style.transform = pct < 14
        ? 'translateX(0)'
        : pct > 86
            ? 'translateX(-100%)'
            : 'translateX(-50%)';
}

function buildAxis(axisEl, nyquist) {
    if (!axisEl) return;
    const intervals = [100, 250, 500, 1000, 2000, 5000, 10000];
    const interval  = intervals.find(i => nyquist / i <= 7) ?? intervals.at(-1);
    let html = '';
    for (let f = 0; f <= nyquist; f += interval) {
        const pct = (f / nyquist) * 100;
        html += `<div class="freq-axis-tick" style="left:${pct}%">
                    <div class="freq-axis-mark"></div>
                    <div class="freq-axis-label">${formatHz(f)}</div>
                 </div>`;
    }
    axisEl.innerHTML = html;
}

function buildBinGrid(gridEl, nyquist, binHz) {
    if (!gridEl || binHz <= 0) return;
    // Only draw grid if there are a reasonable number of visible bins
    const nBins = nyquist / binHz;
    if (nBins > 80 || nBins < 2) { gridEl.innerHTML = ''; return; }

    let html = '';
    for (let f = binHz; f < nyquist; f += binHz) {
        const pct = (f / nyquist) * 100;
        html += `<div class="freq-bin-line" style="left:${pct}%"></div>`;
    }
    gridEl.innerHTML = html;
}
