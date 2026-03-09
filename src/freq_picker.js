/**
 * freq-range-picker.js
 *
 * Posuvny vyber TX frekvencneho spektra.
 *
 * Posuvnik sa chyta na najblizsi FFT bin.
 * Vstupy a popisky drzia MIN/MAX v Hz.
 */

/**
 * @param {object}  mp        modem profil (vyzaduje sample_rate, min_tx_freq,
 *                            max_tx_freq, freq_bin_hz)
 * @param {string}  idSuffix  id profilu alebo 'default'
 * @param {boolean} readonly
 */
export function renderFreqPicker(mp, idSuffix, readonly) {
    const nyquist = Math.round(mp.sample_rate / 2);
    const minF    = mp.min_tx_freq ?? 800;
    const maxF    = mp.max_tx_freq ?? 1600;
    const binHz   = mp.freq_bin_hz || 1;
    const bw      = Math.abs(maxF - minF);

    const inputAttrs = (field, val) => readonly
        ? `type="number" value="${val}" disabled`
        : `type="number" value="${val}" inputmode="none"
           data-profile-id="${idSuffix}" data-field="${field}"
           min="0" max="${nyquist}" step="${binHz}"
           id="freq-input-${field}-${idSuffix}"
           title="Pouzi sipky alebo posuvnik"`;

    return `
    <div class="freq-picker-wrap" id="freq-picker-${idSuffix}"
         data-profile-id="${idSuffix}"
         data-nyquist="${nyquist}"
         data-bin-hz="${binHz}"
         data-min-freq="${minF}"
         data-max-freq="${maxF}"
         data-readonly="${readonly ? '1' : '0'}">

        <!-- Hlavicka -->
        <div class="freq-picker-top">
            <label class="freq-picker-field-label">Frekvenčné spektrum TX</label>
            <span class="freq-picker-bw" id="freq-bw-${idSuffix}">BW: <strong>${formatHz(bw)}</strong></span>
        </div>

        <!-- Track -->
        <div class="freq-picker-track${readonly ? ' freq-picker-track--readonly' : ''}"
             id="freq-track-${idSuffix}">
            <div class="freq-picker-bin-grid" id="freq-grid-${idSuffix}"></div>
            <div class="freq-picker-band" id="freq-band-${idSuffix}"></div>

            <div class="freq-picker-handle freq-picker-handle--min${readonly ? ' freq-picker-handle--readonly' : ''}"
                 id="freq-handle-min-${idSuffix}" data-handle="min"
                 tabindex="${readonly ? -1 : 0}"
                 role="slider" aria-label="Min TX frekvencia"
                 aria-valuemin="0" aria-valuemax="${nyquist}" aria-valuenow="${minF}">
                <div class="freq-picker-handle-pip"></div>
                <div class="freq-picker-handle-label" id="freq-hlabel-min-${idSuffix}">
                    <span class="freq-hlabel-tag freq-hlabel-tag--min">MIN</span>
                    <span class="freq-hlabel-val">${formatHz(minF)}</span>
                </div>
            </div>

            <div class="freq-picker-handle freq-picker-handle--max${readonly ? ' freq-picker-handle--readonly' : ''}"
                 id="freq-handle-max-${idSuffix}" data-handle="max"
                 tabindex="${readonly ? -1 : 0}"
                 role="slider" aria-label="Max TX frekvencia"
                 aria-valuemin="0" aria-valuemax="${nyquist}" aria-valuenow="${maxF}">
                <div class="freq-picker-handle-pip"></div>
                <div class="freq-picker-handle-label" id="freq-hlabel-max-${idSuffix}">
                    <span class="freq-hlabel-tag freq-hlabel-tag--max">MAX</span>
                    <span class="freq-hlabel-val">${formatHz(maxF)}</span>
                </div>
            </div>
        </div>

        <!-- Graf utlmu -->
        <div class="freq-picker-att-wrap" id="freq-att-wrap-${idSuffix}" style="display:none">
            <canvas class="freq-picker-att-canvas" id="freq-att-canvas-${idSuffix}"></canvas>
        </div>

        <!-- Osa -->
        <div class="freq-picker-axis" id="freq-axis-${idSuffix}"></div>

        <!-- Vstupy + tlacidlo -->
        <div class="freq-picker-inputs">
            <div class="freq-picker-input-grp">
                <span class="freq-input-tag freq-input-tag--min">MIN</span>
                <input ${inputAttrs('min_tx_freq', minF)}>
                <span class="freq-picker-unit">Hz</span>
            </div>
            ${readonly ? '' : `
            <button type="button" class="freq-picker-measure-btn"
                    id="freq-measure-${idSuffix}"
                    title="Odmerat frekvenčnú odozvu kanálu">
                <span class="freq-measure-icon-wrap">
                    <i class="fas fa-satellite-dish freq-measure-icon-dish"></i>
                    <span class="freq-measure-ripple"></span>
                </span>
            </button>`}
            <div class="freq-picker-input-grp">
                <span class="freq-input-tag freq-input-tag--max">MAX</span>
                <input ${inputAttrs('max_tx_freq', maxF)}>
                <span class="freq-picker-unit">Hz</span>
            </div>
        </div>
    </div>`;
}

// Inicializacia.

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
    const measureBtn = document.getElementById(`freq-measure-${idSuffix}`);

    if (!track || !band) return;

    const defaultMin = parseInt(wrap.dataset.minFreq, 10);
    const defaultMax = parseInt(wrap.dataset.maxFreq, 10);
    let valMin = inputMin ? (parseInt(inputMin.value, 10) || defaultMin) : defaultMin;
    let valMax = inputMax ? (parseInt(inputMax.value, 10) || defaultMax) : defaultMax;

    // Deklaruj pred paint(), renderAttenuation ich potrebuje.
    const attCanvas = document.getElementById(`freq-att-canvas-${idSuffix}`);
    const attWrap   = document.getElementById(`freq-att-wrap-${idSuffix}`);
    let   attRafId  = null;

    buildAxis(axisEl, nyquist);
    buildBinGrid(gridEl, nyquist, binHz);
    paint();

    if (readonly) {
        // Pri readonly zobraz canvas len ak su data.
        const existing = loadAttenuationData(idSuffix);
        if (existing && existing.length >= 2 && attWrap) {
            attWrap.style.display = '';
            drawAttenuationOverlay(attCanvas, existing, nyquist, null, null);
            // Znovunakresli po rozbaleni profilu (offsetWidth bol 0 pri display:none).
            if (attCanvas) {
                const ro = new ResizeObserver(() =>
                    drawAttenuationOverlay(attCanvas, existing, nyquist, null, null));
                ro.observe(attCanvas);
            }
        }
        return;
    }

    // Vzdy zobraz canvas, aj bez dat.
    if (attWrap) attWrap.style.display = '';

    function renderAttenuation() {
        if (!attCanvas) return;
        // Zrus predchadzajuci frame, ak este bezi.
        if (attRafId) cancelAnimationFrame(attRafId);
        const data = loadAttenuationData(idSuffix);
        attRafId = requestAnimationFrame(() => {
            attRafId = null;
            drawAttenuationOverlay(attCanvas, data, nyquist, valMin, valMax);
        });
    }
    attRenderers.set(String(idSuffix), renderAttenuation);
    renderAttenuation();

    // Znovunakresli po rozbaleni profilu (offsetWidth bol 0 pri display:none).
    if (attCanvas) {
        const ro = new ResizeObserver(() => renderAttenuation());
        ro.observe(attCanvas);
    }

    // Presuvanie.

    let dragging = null;

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function snapToGrid(hz) {
        // Zaokruhli na najblizsi FFT bin.
        return Math.round(hz / binHz) * binHz;
    }

    function pxToHz(clientX) {
        const rect = track.getBoundingClientRect();
        const t    = clamp((clientX - rect.left) / rect.width, 0, 1);
        return snapToGrid(t * nyquist);
    }

    // Naklonuj uchyty a odstran stare listenery.
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
    }

    function onKeyDown(e) {
        const handle = e.currentTarget.dataset.handle;
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
        e.preventDefault();

        // Sipky idu po 1 bine, Shift po 10.
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
    }

    [hMin, hMax].forEach(h => {
        if (!h) return;
        h.addEventListener('pointerdown', onPointerDown);
        h.addEventListener('pointermove', onPointerMove);
        h.addEventListener('pointerup',   onPointerUp);
        h.addEventListener('keydown',     onKeyDown);
    });

    // Synchronizacia vstupov a ovladacov.

    // Blokuj pisanie, povol len sipky a posuvnik.
    function blockTyping(el) {
        el.addEventListener('keydown', e => {
            const allowed = ['ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Escape'];
            if (!allowed.includes(e.key)) e.preventDefault();
        });
        el.addEventListener('paste', e => e.preventDefault());
        el.addEventListener('focus', () => el.select());
    }

    if (inputMin) {
        blockTyping(inputMin);
        inputMin.addEventListener('input', () => {
            const v = parseInt(inputMin.value, 10);
            if (!isNaN(v)) { valMin = clamp(snapToGrid(v), 0, valMax - binHz); paint(); }
        });
        inputMin.addEventListener('change', () => {
            valMin = clamp(snapToGrid(parseInt(inputMin.value, 10) || 0), 0, valMax - binHz);
            inputMin.value = valMin;
            paint();
        });
    }
    if (inputMax) {
        blockTyping(inputMax);
        inputMax.addEventListener('input', () => {
            const v = parseInt(inputMax.value, 10);
            if (!isNaN(v)) { valMax = clamp(snapToGrid(v), valMin + binHz, nyquist); paint(); }
        });
        inputMax.addEventListener('change', () => {
            valMax = clamp(snapToGrid(parseInt(inputMax.value, 10) || nyquist), valMin + binHz, nyquist);
            inputMax.value = valMax;
            paint();
        });
    }

    // Tlacidlo merania.

    if (measureBtn) {
        measureBtn.addEventListener('click', () => {
            openMeasurementModal(String(idSuffix), binHz, nyquist);
        });
    }

    // Kreslenie.

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
        renderAttenuation();
    }
}

// Verejne API: obnov po zmene sample_rate alebo freq_bin_hz.

export function updateFreqPickerRange(idSuffix, mp) {
    const wrap = document.getElementById(`freq-picker-${idSuffix}`);
    if (!wrap) return;
    wrap.dataset.nyquist = Math.round(mp.sample_rate / 2);
    wrap.dataset.binHz   = mp.freq_bin_hz || 1;
    initSinglePicker(wrap);
}

// Pomocne funkcie.

function nearestBin(hz, binHz) {
    return Math.round(hz / binHz) * binHz;
}

function formatHz(hz) {
    if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 2)} kHz`;
    return `${Math.round(hz * 10) / 10} Hz`;
}

function updateHandle(handleEl, labelId, val, pct, binHz, tag, isMax) {
    if (!handleEl) return;
    handleEl.style.left = `${pct}%`;
    handleEl.setAttribute('aria-valuenow', val);
    const labelEl = document.getElementById(labelId);
    if (!labelEl) return;
    labelEl.innerHTML = `
        <span class="freq-hlabel-tag freq-hlabel-tag--${isMax ? 'max' : 'min'}">${tag}</span>
        <span class="freq-hlabel-val">${formatHz(val)}</span>`;

    // Orez okrajov, aby popisy nevysli mimo track.
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
    // Mriezku kresli len pri rozumnom pocte binov.
    const nBins = nyquist / binHz;
    if (nBins > 80 || nBins < 2) { gridEl.innerHTML = ''; return; }

    let html = '';
    for (let f = binHz; f < nyquist; f += binHz) {
        const pct = (f / nyquist) * 100;
        html += `<div class="freq-bin-line" style="left:${pct}%"></div>`;
    }
    gridEl.innerHTML = html;
}

// Meranie frekvencnej odozvy kanala.

const attRenderers = new Map(); // idSuffix -> () => void
let measurementInProgress = false;

// Ulozenie dat merania.

const ATT_KEY = 'spect_att';

function loadAttenuationData(idSuffix) {
    try {
        const raw = localStorage.getItem(`${ATT_KEY}_${idSuffix}`);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function saveAttenuationData(idSuffix, data) {
    try { localStorage.setItem(`${ATT_KEY}_${idSuffix}`, JSON.stringify(data)); } catch { /* ignore */ }
}

// Zluc merania tak, ze pre kazdy bod nechaj minimum.
function mergeAttenuationData(existing, newData) {
    const map = new Map(existing.map(p => [p.freq, p.db]));
    for (const p of newData) {
        const old = map.get(p.freq);
        map.set(p.freq, old !== undefined ? Math.min(old, p.db) : p.db);
    }
    return [...map.entries()]
        .map(([freq, db]) => ({ freq, db }))
        .sort((a, b) => a.freq - b.freq);
}

export function clearAttenuationData(idSuffix) {
    try { localStorage.removeItem(`${ATT_KEY}_${idSuffix}`); } catch { /* ignore */ }
}

// Kreslenie utlmovej krivky v pickeri.

function drawAttenuationOverlay(canvas, data, nyquist, selMin, selMax) {
    if (!canvas) return;
    const w   = canvas.offsetWidth || 300;
    const h   = 64;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const dark = document.documentElement.classList.contains('dark-scheme');
    // pad.l je 0, x-os sedi s trackom.
    const pad  = { t: 2, r: 0, b: 2, l: 0 };
    const gw   = w - pad.l - pad.r;
    const gh   = h - pad.t - pad.b;

    const dbs   = (data || []).map(d => d.db);
    let minDb   = -20;
    let maxDb   = 10;
    if (dbs.length) {
        minDb = Math.min(Math.floor(Math.min(...dbs) / 10) * 10 - 5, -20);
        maxDb = Math.max(Math.ceil (Math.max(...dbs) / 10) * 10 + 5,  10);
    }
    const range = maxDb - minDb || 1;

    function xOf(f) { return pad.l + (f / nyquist) * gw; }
    function yOf(d) { return pad.t + (1 - (d - minDb) / range) * gh; }

    // Ticha referencna ciara 0 dB.
    {
        const y = yOf(0);
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
        ctx.lineWidth   = 1;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + gw, y); ctx.stroke();
    }

    // Krivka utlmu, ak su data.
    if (data && data.length >= 2) {
        const THRESH_DB = -10;
        const yThresh   = yOf(THRESH_DB);
        const yBottom   = pad.t + gh;

        // Cervena zona pod -10 dB.
        if (yThresh < yBottom) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(pad.l, yThresh, gw, yBottom - yThresh);
            ctx.clip();
            ctx.beginPath();
            data.forEach((d, i) => i === 0
                ? ctx.moveTo(xOf(d.freq), yOf(d.db))
                : ctx.lineTo(xOf(d.freq), yOf(d.db)));
            ctx.lineTo(xOf(data.at(-1).freq), yBottom);
            ctx.lineTo(xOf(data[0].freq),     yBottom);
            ctx.closePath();
            ctx.fillStyle = dark ? 'rgba(248,113,113,0.18)' : 'rgba(239,68,68,0.13)';
            ctx.fill();
            ctx.restore();
        }

        // Prerusovana ciara prahu -10 dB.
        if (yThresh >= pad.t && yThresh <= yBottom) {
            ctx.save();
            ctx.strokeStyle = dark ? 'rgba(248,113,113,0.55)' : 'rgba(239,68,68,0.50)';
            ctx.lineWidth   = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(pad.l, yThresh); ctx.lineTo(pad.l + gw, yThresh); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }

        // Modra plocha nad prahom.
        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.l, pad.t, gw, Math.max(0, yThresh - pad.t));
        ctx.clip();
        ctx.beginPath();
        data.forEach((d, i) => i === 0
            ? ctx.moveTo(xOf(d.freq), yOf(d.db))
            : ctx.lineTo(xOf(d.freq), yOf(d.db)));
        ctx.lineTo(xOf(data.at(-1).freq), yBottom);
        ctx.lineTo(xOf(data[0].freq),     yBottom);
        ctx.closePath();
        ctx.fillStyle = dark ? 'rgba(96,165,250,0.12)' : 'rgba(59,130,246,0.10)';
        ctx.fill();
        ctx.restore();

        // Krivka: modra nad prahom, cervena pod nim.
        ctx.lineWidth = 1.5;
        ctx.lineJoin  = 'round';
        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.l, pad.t, gw, Math.max(0, yThresh - pad.t));
        ctx.clip();
        ctx.beginPath();
        data.forEach((d, i) => i === 0
            ? ctx.moveTo(xOf(d.freq), yOf(d.db))
            : ctx.lineTo(xOf(d.freq), yOf(d.db)));
        ctx.strokeStyle = dark ? '#60a5fa' : '#3b82f6';
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.l, yThresh, gw, yBottom - yThresh);
        ctx.clip();
        ctx.beginPath();
        data.forEach((d, i) => i === 0
            ? ctx.moveTo(xOf(d.freq), yOf(d.db))
            : ctx.lineTo(xOf(d.freq), yOf(d.db)));
        ctx.strokeStyle = dark ? '#f87171' : '#ef4444';
        ctx.stroke();
        ctx.restore();
    }

    // Stmav mimo vybrane pasmo.
    if (selMin != null && selMax != null && selMax > selMin) {
        const x1      = xOf(selMin);
        const x2      = xOf(selMax);
        const dimColor = dark ? 'rgba(0,0,0,0.45)' : 'rgba(200,210,230,0.60)';
        ctx.fillStyle = dimColor;
        if (x1 > pad.l)         ctx.fillRect(pad.l, pad.t, x1 - pad.l,        gh);
        if (x2 < pad.l + gw)   ctx.fillRect(x2,   pad.t, pad.l + gw - x2,   gh);
        // Zvisle ciary hranic vyberu.
        ctx.strokeStyle = dark ? 'rgba(96,165,250,0.55)' : 'rgba(59,130,246,0.50)';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x1, pad.t); ctx.lineTo(x1, pad.t + gh); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2, pad.t); ctx.lineTo(x2, pad.t + gh); ctx.stroke();
        ctx.setLineDash([]);
    }
}

// Pomocne funkcie pre meranie.

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function generateToneBuffer(audioCtx, freq, duration, amplitude) {
    const sr    = audioCtx.sampleRate;
    const n     = Math.floor(sr * duration);
    const buf   = audioCtx.createBuffer(1, n, sr);
    const ch    = buf.getChannelData(0);
    const fadeN = Math.floor(sr * 0.02);
    for (let i = 0; i < n; i++) {
        let s = amplitude * Math.sin(2 * Math.PI * freq * i / sr);
        if (i < fadeN)       s *= i / fadeN;
        if (i >= n - fadeN)  s *= (n - i) / fadeN;
        ch[i] = s;
    }
    return buf;
}

// DFT na cielovej frekvencii s Hannovym oknom.
// Okno tlmi okraje zaznamu a znizuje sum.
function measureDFT(samples, freq, sampleRate) {
    const N = samples.length;
    if (N < 2) return 0;
    const w = (2 * Math.PI * freq) / sampleRate;
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) {
        const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
        re += samples[i] * win * Math.cos(w * i);
        im += samples[i] * win * Math.sin(w * i);
    }
    // 4/N kompenzuje zisk Hannovho okna.
    return (4 / N) * Math.sqrt(re * re + im * im);
}

function robustMedian(values) {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    if (s.length === 1) return s[0];
    const q1  = s[Math.floor(s.length / 4)];
    const q3  = s[Math.floor(3 * s.length / 4)];
    const iqr = q3 - q1;
    const lo  = q1 - 1.5 * iqr;
    const hi  = q3 + 1.5 * iqr;
    const f   = s.filter(v => v >= lo && v <= hi);
    const t   = f.length ? f : s;
    const m   = Math.floor(t.length / 2);
    return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

// Prehraj ton a sucasne nahravaj mikrofon.
// Vrat stabilnu cast bez uvodu a zaveru.
async function playToneAndRecord(audioCtx, micStream, freq, duration, amplitude) {
    const sr   = audioCtx.sampleRate;
    const buf  = generateToneBuffer(audioCtx, freq, duration, amplitude);
    const mic  = audioCtx.createMediaStreamSource(micStream);
    const proc = audioCtx.createScriptProcessor(4096, 1, 1);
    // Tichy vystup, nech nie je echo.
    const sink = audioCtx.createGain();
    sink.gain.value = 0;
    const chunks = [];
    proc.onaudioprocess = e =>
        chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    mic.connect(proc);
    proc.connect(sink);
    sink.connect(audioCtx.destination);

    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    await new Promise(r => { src.onended = r; src.start(); });
    await sleep(170); // Pockaj na dobeh zaznamu.

    proc.disconnect();
    mic.disconnect();

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out   = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }

    // Odstrihni uvodnu latenciu a zaver.
    // K latency pridaj rezervu 50 ms.
    const latSec = (audioCtx.outputLatency || 0) + (audioCtx.baseLatency || 0);
    const skip   = Math.floor(sr * Math.max(0.07, latSec + 0.05));
    const tail   = Math.floor(sr * 0.06);
    const s = Math.min(skip, Math.max(0, total - 2));
    const e = Math.max(s + 1, total - tail);
    return out.slice(s, e);
}

// Kreslenie grafu v modale.

function drawMeasurementGraph(canvas, data, measureNyquist, measureMin = 0) {
    const w   = canvas.clientWidth  || 400;
    const h   = canvas.clientHeight || 180;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const dark = document.documentElement.classList.contains('dark-scheme');
    ctx.fillStyle = dark ? '#1a1f2e' : '#f9fafb';
    ctx.fillRect(0, 0, w, h);

    const pad = { t: 14, r: 10, b: 34, l: 42 };
    const gw  = w - pad.l - pad.r;
    const gh  = h - pad.t - pad.b;

    let minDb = -20, maxDb = 10;
    if (data.length > 0) {
        const dbs = data.map(d => d.db);
        minDb = Math.min(Math.floor(Math.min(...dbs) / 10) * 10 - 10, -20);
        maxDb = Math.max(Math.ceil (Math.max(...dbs) / 10) * 10 + 10,  10);
    }
    const range = maxDb - minDb || 1;

    function xOf(f) { return pad.l + ((f - measureMin) / ((measureNyquist - measureMin) || 1)) * gw; }
    function yOf(d) { return pad.t + (1 - (d - minDb) / range) * gh; }

    // Mriezka a popisy Y po 10 dB.
    ctx.font      = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    for (let db = Math.ceil(minDb / 10) * 10; db <= maxDb; db += 10) {
        const y = yOf(db);
        ctx.strokeStyle = db === 0
            ? (dark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)')
            : (dark ? 'rgba(255,255,255,0.06)'  : 'rgba(0,0,0,0.06)');
        ctx.lineWidth = db === 0 ? 1.5 : 1;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + gw, y); ctx.stroke();
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.35)' : '#6b7280';
        ctx.fillText(`${db}`, pad.l - 4, y + 3);
    }

    // Popisy X, preskoc ak by sa prekryvali.
    ctx.font      = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    const MIN_LABEL_GAP = 28;
    let lastLabelX = -Infinity;
    [100, 500, 1000, 2000, 5000, 10000, 20000].filter(f => f >= measureMin && f <= measureNyquist).forEach(f => {
        const x = xOf(f);
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
        ctx.lineWidth   = 1;
        ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + gh); ctx.stroke();
        if (x - lastLabelX >= MIN_LABEL_GAP) {
            ctx.fillStyle = dark ? 'rgba(255,255,255,0.30)' : '#6b7280';
            ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x, h - pad.b + 13);
            lastLabelX = x;
        }
    });

    // Popis osi Y.
    ctx.save();
    ctx.translate(11, pad.t + gh / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle  = dark ? 'rgba(255,255,255,0.30)' : '#9ca3af';
    ctx.textAlign  = 'center';
    ctx.fillText('Utlm [dB]', 0, 0);
    ctx.restore();

    if (data.length < 2) return;

    const THRESH_DB = -10; // Hranica pouzitelnosti spektra.
    const yThresh   = yOf(THRESH_DB);
    const yBottom   = pad.t + gh;

    // Cervena zona pod -10 dB.
    if (yThresh < yBottom) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.l, yThresh, gw, yBottom - yThresh);
        ctx.clip();
        ctx.beginPath();
        data.forEach((d, i) => i === 0
            ? ctx.moveTo(xOf(d.freq), yOf(d.db))
            : ctx.lineTo(xOf(d.freq), yOf(d.db)));
        ctx.lineTo(xOf(data.at(-1).freq), yBottom);
        ctx.lineTo(xOf(data[0].freq),     yBottom);
        ctx.closePath();
        ctx.fillStyle = dark ? 'rgba(248,113,113,0.18)' : 'rgba(239,68,68,0.13)';
        ctx.fill();
        ctx.restore();
    }

    // Prerusovana ciara prahu -10 dB.
    if (yThresh >= pad.t && yThresh <= yBottom) {
        ctx.save();
        ctx.strokeStyle = dark ? 'rgba(248,113,113,0.55)' : 'rgba(239,68,68,0.50)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(pad.l, yThresh); ctx.lineTo(pad.l + gw, yThresh); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font      = '8px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = dark ? 'rgba(248,113,113,0.70)' : 'rgba(239,68,68,0.65)';
        ctx.fillText('-10 dB', pad.l + 3, yThresh - 3);
        ctx.restore();
    }

    // Modra plocha nad prahom.
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, gw, Math.max(0, yThresh - pad.t));
    ctx.clip();
    ctx.beginPath();
    data.forEach((d, i) => i === 0
        ? ctx.moveTo(xOf(d.freq), yOf(d.db))
        : ctx.lineTo(xOf(d.freq), yOf(d.db)));
    ctx.lineTo(xOf(data.at(-1).freq), yBottom);
    ctx.lineTo(xOf(data[0].freq),     yBottom);
    ctx.closePath();
    ctx.fillStyle = dark ? 'rgba(96,165,250,0.12)' : 'rgba(59,130,246,0.10)';
    ctx.fill();
    ctx.restore();

    // Krivka: modra nad prahom, cervena pod nim.
    ctx.lineWidth = 2;
    ctx.lineJoin  = 'round';

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, gw, Math.max(0, yThresh - pad.t));
    ctx.clip();
    ctx.beginPath();
    data.forEach((d, i) => i === 0
        ? ctx.moveTo(xOf(d.freq), yOf(d.db))
        : ctx.lineTo(xOf(d.freq), yOf(d.db)));
    ctx.strokeStyle = dark ? '#60a5fa' : '#3b82f6';
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, yThresh, gw, yBottom - yThresh);
    ctx.clip();
    ctx.beginPath();
    data.forEach((d, i) => i === 0
        ? ctx.moveTo(xOf(d.freq), yOf(d.db))
        : ctx.lineTo(xOf(d.freq), yOf(d.db)));
    ctx.strokeStyle = dark ? '#f87171' : '#ef4444';
    ctx.stroke();
    ctx.restore();

    // Body, farba podla prahu.
    data.forEach(d => {
        ctx.beginPath();
        ctx.arc(xOf(d.freq), yOf(d.db), 3, 0, 2 * Math.PI);
        ctx.fillStyle = d.db < THRESH_DB
            ? (dark ? '#f87171' : '#ef4444')
            : (dark ? '#60a5fa' : '#3b82f6');
        ctx.fill();
    });
}

// Modalny dialog.

function openMeasurementModal(idSuffix, binHz, nyquist) {
    if (measurementInProgress) return;
    measurementInProgress = true;

    const overlay = document.createElement('div');
    overlay.className = 'spect-measure-overlay';
    overlay.innerHTML = `
    <div class="spect-measure-modal" role="dialog" aria-modal="true">
        <div class="spect-measure-header">
            <span class="spect-measure-title">
                <i class="fas fa-satellite-dish"></i>
                Meranie frekvenčnej odozvy
            </span>
            <button class="spect-measure-close" id="spect-close-${idSuffix}" title="Zavrieť">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="spect-measure-body">
            <div class="spect-measure-config" id="spect-config-${idSuffix}">
                <div class="spect-cfg-row">
                    <span class="spect-cfg-label">Rozsah</span>
                    <input type="number" class="spect-cfg-input" id="spect-fmin-${idSuffix}"
                           value="${Math.max(binHz, 50)}" min="${binHz}" max="${nyquist}" step="${binHz}">
                    <span class="spect-cfg-sep">–</span>
                    <input type="number" class="spect-cfg-input" id="spect-fmax-${idSuffix}"
                           value="${nyquist}" min="${binHz}" max="${nyquist}" step="${binHz}">
                    <span class="spect-cfg-unit">Hz</span>
                </div>
                <div class="spect-cfg-row">
                    <span class="spect-cfg-label">Referenčná f.</span>
                    <input type="number" class="spect-cfg-input" id="spect-ref-${idSuffix}"
                           value="${Math.round(Math.min(1000, nyquist) / binHz) * binHz}"
                           min="${binHz}" max="${nyquist}" step="${binHz}">
                    <span class="spect-cfg-unit">Hz</span>
                </div>
                <div class="spect-cfg-row">
                    <span class="spect-cfg-label">Body merania</span>
                    <select class="spect-cfg-select" id="spect-pts-${idSuffix}">
                        <option value="25">25</option>
                        <option value="50" selected>50</option>
                        <option value="100">100</option>
                        <option value="200">200</option>
                    </select>
                </div>
            </div>
            <canvas class="spect-measure-canvas" id="spect-canvas-${idSuffix}"></canvas>
            <div class="spect-measure-status-row">
                <span class="spect-measure-status-text" id="spect-status-${idSuffix}">Nakonfigurujte meranie a stlačte Spustiť.</span>
                <div class="spect-measure-progress-bar">
                    <div class="spect-measure-progress-fill" id="spect-prog-${idSuffix}" style="width:0%"></div>
                </div>
            </div>
        </div>
        <div class="spect-measure-footer">
            <button class="spect-measure-btn spect-measure-btn--start" id="spect-start-${idSuffix}">
                <i class="fas fa-play"></i> Spustiť meranie
            </button>
            <button class="spect-measure-btn spect-measure-btn--stop" id="spect-stop-${idSuffix}" style="display:none" disabled>
                <i class="fas fa-stop-circle"></i> Zastaviť a použiť
            </button>
            <button class="spect-measure-btn spect-measure-btn--merge" id="spect-merge-${idSuffix}" style="display:none">
                <i class="fas fa-layer-group"></i> Zlúčiť s predošlým
            </button>
            <button class="spect-measure-btn spect-measure-btn--pause" id="spect-pause-${idSuffix}" style="display:none" disabled>
                <i class="fas fa-pause"></i> Pozastaviť
            </button>
            <button class="spect-measure-btn spect-measure-btn--cancel" id="spect-cancel-${idSuffix}">
                <i class="fas fa-times-circle"></i> Zrušiť
            </button>
        </div>
    </div>`;
    document.body.appendChild(overlay);

    const mCanvas  = document.getElementById(`spect-canvas-${idSuffix}`);
    const statusEl = document.getElementById(`spect-status-${idSuffix}`);
    const progEl   = document.getElementById(`spect-prog-${idSuffix}`);
    const startBtn = document.getElementById(`spect-start-${idSuffix}`);
    const stopBtn  = document.getElementById(`spect-stop-${idSuffix}`);
    const mergeBtn = document.getElementById(`spect-merge-${idSuffix}`);
    const pauseBtn = document.getElementById(`spect-pause-${idSuffix}`);
    const cancelBtn= document.getElementById(`spect-cancel-${idSuffix}`);
    const closeBtn = document.getElementById(`spect-close-${idSuffix}`);
    const cfgFmin  = document.getElementById(`spect-fmin-${idSuffix}`);
    const cfgFmax  = document.getElementById(`spect-fmax-${idSuffix}`);
    const cfgRef   = document.getElementById(`spect-ref-${idSuffix}`);
    const cfgPts   = document.getElementById(`spect-pts-${idSuffix}`);

    let closed       = false;
    let running      = true;
    let paused       = false;
    let pauseResolve = null;
    let startResolve = null;
    let audioCtx  = null;
    let micStream = null;
    const measuredData = [];
    const existingData = loadAttenuationData(idSuffix) || [];

    async function waitIfPaused() {
        while (paused && running)
            await new Promise(r => { pauseResolve = r; });
    }

    function setStatus(txt) { if (statusEl) statusEl.textContent = txt; }
    function setProgress(p) { if (progEl) progEl.style.width = `${p}%`; }

    function closeModal(useData, merge = false) {
        if (closed) return;
        closed = true;
        running = false;
        if (paused)       { paused = false; pauseResolve?.(); }
        if (startResolve) { startResolve(); startResolve = null; }
        if (audioCtx)  { audioCtx.close().catch(() => {}); audioCtx = null; }
        if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
        overlay.remove();
        measurementInProgress = false;
        if (useData && measuredData.length >= 2) {
            const toSave = (merge && existingData.length >= 2)
                ? mergeAttenuationData(existingData, measuredData)
                : measuredData;
            saveAttenuationData(idSuffix, toSave);
            const render = attRenderers.get(idSuffix);
            if (render) render();
        }
    }

    cancelBtn.addEventListener('click', () => closeModal(false));
    closeBtn.addEventListener ('click', () => closeModal(false));
    overlay.addEventListener  ('click', e => { if (e.target === overlay) closeModal(false); });
    startBtn?.addEventListener('click', () => {
        if (closed) return;
        [cfgFmin, cfgFmax, cfgRef, cfgPts].forEach(el => { if (el) el.disabled = true; });
        startBtn.style.display = 'none';
        stopBtn.style.display  = '';
        pauseBtn.style.display = '';
        startResolve?.();
        startResolve = null;
    });
    stopBtn.addEventListener  ('click', () => {
        if (closed) return;
        running = false;
        if (paused) { paused = false; pauseResolve?.(); }
        closeModal(measuredData.length >= 2);
    });
    mergeBtn.addEventListener ('click', () => closeModal(true, true));
    pauseBtn.addEventListener ('click', () => {
        if (closed || !running) return;
        paused = !paused;
        if (paused) {
            pauseBtn.innerHTML = '<i class="fas fa-play"></i> Pokračovať';
            pauseBtn.classList.replace('spect-measure-btn--pause', 'spect-measure-btn--resume');
            setStatus('Meranie pozastavene...');
        } else {
            pauseBtn.innerHTML = '<i class="fas fa-pause"></i> Pozastaviť';
            pauseBtn.classList.replace('spect-measure-btn--resume', 'spect-measure-btn--pause');
            pauseResolve?.();
            pauseResolve = null;
        }
    });

    (async () => {
        // Pockaj na stlacenie "Spustit meranie".
        await new Promise(r => { startResolve = r; });
        if (!running) return closeModal(false);

        // Precitaj konfiguraciu (vstupy su uz disabled).
        const fMin = Math.max(binHz, Math.round((parseInt(cfgFmin?.value, 10) || Math.max(binHz, 50)) / binHz) * binHz);
        const fMax = Math.min(nyquist, Math.round((parseInt(cfgFmax?.value, 10) || nyquist) / binHz) * binHz);
        const refFreqCfg = Math.round((parseInt(cfgRef?.value,  10) || Math.min(1000, nyquist)) / binHz) * binHz;
        const maxPts     = parseInt(cfgPts?.value, 10) || 50;

        setStatus('Ziadam pristup k mikrofonu...');
        try {
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl:  false,
                },
            });
        } catch (err) {
            setStatus(`Chyba mikrofónu: ${err.message}`);
            cancelBtn.innerHTML = '<i class="fas fa-times-circle"></i> Zavrieť';
            return;
        }
        if (!running) return closeModal(false);

        audioCtx = new AudioContext();
        const sr = audioCtx.sampleRate;

        const AMPLITUDE  = 0.7;
        const TONE_DUR   = 0.58;  // Dlhsi ton da stabilnejsie vzorky.
        const SETTLE_MS  = 110;
        const REF_FREQ   = Math.min(refFreqCfg, Math.floor(sr / 2 / binHz) * binHz) || binHz;
        const MEAS_PER_F = 3;     // 3 merania pomozu odfiltrovat outlier.

        // Zoznam frekvencii podla konfiguracie.
        const rawF = [];
        for (let f = fMin; f <= fMax && f <= sr / 2; f += binHz)
            rawF.push(f);
        const step  = Math.max(1, Math.ceil(rawF.length / maxPts));
        const freqs = rawF.filter((_, i) => i % step === 0);
        const total = freqs.length;

        stopBtn.disabled = false;
        pauseBtn.disabled = false;
        setStatus('Zahrievam zvukovy hardver...');

        // Ohrev: 3 tony pre stabilizaciu hardveru.
        for (let i = 0; i < 3 && running; i++) {
            const buf = generateToneBuffer(audioCtx, REF_FREQ, TONE_DUR, AMPLITUDE);
            const src = audioCtx.createBufferSource();
            src.buffer = buf;
            src.connect(audioCtx.destination);
            await new Promise(r => { src.onended = r; src.start(); });
            await sleep(SETTLE_MS);
        }
        if (!running) return closeModal(false);

        // Meranie referencie, 4 pokusy pre spolahlivejsi median.
        setStatus(`Meriam referenciu (${REF_FREQ} Hz)...`);
        const refAmps = [];
        for (let i = 0; i < 4 && running; i++) {
            const rec = await playToneAndRecord(audioCtx, micStream, REF_FREQ, TONE_DUR, AMPLITUDE);
            refAmps.push(measureDFT(rec, REF_FREQ, sr));
            await sleep(SETTLE_MS);
        }
        if (!running) return closeModal(false);
        let refAmp = robustMedian(refAmps);
        const REF_REFRESH = 10; // Obnov referenciu kazdych 10 frekvencii.

        // Hlavna slucka po bodoch.
        for (let idx = 0; idx < total && running; idx++) {
            const freq = freqs[idx];
            setStatus(`Meriam ${formatHz(freq)}  (${idx + 1} / ${total})`);
            setProgress(((idx + 1) / total) * 100);
            await waitIfPaused();
            if (!running) break;

            // Periodicky obnov referenciu pre kompenzaciu driftu.
            if (idx > 0 && idx % REF_REFRESH === 0) {
                const rr = [];
                for (let i = 0; i < 2 && running; i++) {
                    const rec = await playToneAndRecord(audioCtx, micStream, REF_FREQ, TONE_DUR, AMPLITUDE);
                    rr.push(measureDFT(rec, REF_FREQ, sr));
                    await sleep(SETTLE_MS);
                }
                if (running && rr.length) {
                    const nr = robustMedian(rr);
                    if (nr > 0) refAmp = nr;
                }
            }

            const amps = [];
            for (let m = 0; m < MEAS_PER_F && running; m++) {
                const rec = await playToneAndRecord(audioCtx, micStream, freq, TONE_DUR, AMPLITUDE);
                amps.push(measureDFT(rec, freq, sr));
                await sleep(SETTLE_MS);
            }
            if (!running) break;

            const avgAmp = robustMedian(amps);
            const db     = (avgAmp > 0 && refAmp > 0)
                ? 20 * Math.log10(avgAmp / refAmp)
                : -60;
            measuredData.push({ freq, db });
            drawMeasurementGraph(mCanvas, measuredData, Math.min(fMax, sr / 2), fMin);
        }

        if (!running) return closeModal(measuredData.length >= 2);

        // Meranie dokoncene.
        setStatus('Meranie dokončené!');
        setProgress(100);
        pauseBtn.disabled = true;
        stopBtn.innerHTML = '<i class="fas fa-check"></i> Použiť výsledok';
        stopBtn.classList.replace('spect-measure-btn--stop', 'spect-measure-btn--done');
        stopBtn.disabled = false;
        if (existingData.length >= 2 && measuredData.length >= 2)
            mergeBtn.style.display = '';
    })().catch(err => {
        setStatus(`Chyba: ${err.message}`);
        cancelBtn.innerHTML = '<i class="fas fa-times-circle"></i> Zavrieť';
    });
}
