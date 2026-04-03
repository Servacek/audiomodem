import { TinyTUS } from '../../libs/tinytus/tinytus.js';

const SAMPLE_RATE = 48000;
const DB_FLOOR = -90;
const NOISE_ADAPT = 0.05;
const MAGNITUDE_SCALE = 30.0; // mierka pre normalizaciu magnitudy
const SPECTROGRAM_NOISE_GATE_MULT = 1.85;
const SPECTROGRAM_MEAN_GATE_RATIO = 0.12;
const SPECTROGRAM_PEAK_SHARPEN_BLEND = 0.55;
const SPECTROGRAM_SOFT_KNEE = 0.55;
const SPECTROGRAM_RESPONSE_GAMMA = 1.45;
const FRAME_ACTIVE_CONTRAST_BOOST = 10;
const SPECTRUM_SIDE_PAD_RATIO = 0.08;
const SPECTRUM_SIDE_PAD_MIN_BINS = 4;
const FRAME_ACTIVITY_DB_DELTA = 9;
const FRAME_SILENCE_HANG_ROWS = 3;
const DECODE_FREEZE_EXTRA_ROWS = 16;
const DECODE_FREEZE_FORCE_ROWS = 44;

// --- Prvky DOM ---
const graphTab = document.getElementById('tab-graph');
const container = document.getElementById('spectrogram-container');

const canvas = document.createElement('canvas');
canvas.id = 'spectrogram-canvas';
canvas.style.width = '100%';
canvas.style.height = '100%';
canvas.style.border = '2px solid var(--spectrogram-canvas-border, #373637)';
container.appendChild(canvas);
const ctx = canvas.getContext('2d');

graphTab.classList.add('loaded');

// --- Stav ---
let fftSize = 1024;
let binHz = SAMPLE_RATE / fftSize;
let dispMinBin = 0, dispMaxBin = fftSize / 2 - 1;
let numBins = dispMaxBin - dispMinBin + 1;
let usedMinBin = dispMinBin, usedMaxBin = dispMaxBin;

let fftRe, fftIm, bitRev, twRe, twIm, win;
let ringBuf = null, ringFill = 0, hopSize = 0;
let noiseDb = DB_FLOOR;
let rowCounter = 0;

let frameActivityActive = false;
let frameActivityStartRow = 0;
let frameActivityLastRow = 0;
let detectedFrameStartRow = null;
let detectedFrameEndRow = null;
let decodeFreezePending = false;
let decodeFreezeTargetRow = 0;
let decodeFreezeForceRow = 0;

// --- Nastavenie FFT ---
function setupFFT(N) {
    fftSize = N;
    binHz = SAMPLE_RATE / fftSize;
    fftRe = new Float32Array(N);
    fftIm = new Float32Array(N);

    // bitova reverzacia
    bitRev = new Uint32Array(N);
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
        let x = i, y = 0;
        for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; }
        bitRev[i] = y;
    }

    // twiddle faktory
    twRe = new Float32Array(N / 2);
    twIm = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) { const a = -2 * Math.PI * i / N; twRe[i] = Math.cos(a); twIm[i] = Math.sin(a); }

    // Vynasobime polovicnym kosinusom.
    win = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
    }

    ringBuf = new Float32Array(N);
    ringFill = 0;
    hopSize = Math.max(1, N / 2); // Zabrani nekonecnej slucke pri fftSize=1.
}

// --- Spustenie FFT ---
function runFFT() {
    const N = fftSize;
    for (let i = 0; i < N; i++) {
        const j = bitRev[i];
        if (j > i) { [fftRe[i], fftRe[j]] = [fftRe[j], fftRe[i]];[fftIm[i], fftIm[j]] = [fftIm[j], fftIm[i]]; }
    }
    for (let size = 2; size <= N; size <<= 1) {
        const half = size >> 1, step = N / size;
        for (let i = 0; i < N; i += size) {
            for (let k = 0; k < half; k++) {
                const j = k * step;
                const tr = fftRe[i + k + half] * twRe[j] - fftIm[i + k + half] * twIm[j];
                const ti = fftRe[i + k + half] * twIm[j] + fftIm[i + k + half] * twRe[j];
                fftRe[i + k + half] = fftRe[i + k] - tr; fftIm[i + k + half] = fftIm[i + k] - ti;
                fftRe[i + k] += tr; fftIm[i + k] += ti;
            }
        }
    }
}

let COLOR_MIN_HEX = "#0d0d0d"; // tmava modra / takmer cierna
let COLOR_MAX_HEX = "#58ee87"; // zelenkasto-biela

function readCssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

function applyThemePalette(shouldClearCanvas = false) {
    COLOR_MIN_HEX = readCssVar('--spectrogram-color-min', '#0d0d0d');
    COLOR_MAX_HEX = readCssVar('--spectrogram-color-max', '#58ee87');

    if (!shouldClearCanvas || canvasW <= 0 || canvasH <= 0) return;

    // Pri zmene schemy prekreslime pozadie novou paletou.
    ctx.fillStyle = COLOR_MIN_HEX;
    ctx.fillRect(0, 0, canvasW, canvasH);
    drawOverlayMarkers();
}

// --- Platno ---
let canvasW = 0, canvasH = 0;
function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvasW = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvasH = Math.max(1, Math.round(canvas.clientHeight * dpr));
    canvas.width = canvasW; canvas.height = canvasH;
    ctx.fillStyle = COLOR_MIN_HEX;
    ctx.fillRect(0, 0, canvasW, canvasH);
    drawOverlayMarkers();
}

function clampInt(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function drawSpectrumBoundaryMarkers() {
    if (canvasW <= 0 || canvasH <= 0 || numBins <= 0) return;

    const binsShown = Math.max(1, dispMaxBin - dispMinBin + 1);
    const pxPerBin = canvasW / binsShown;

    const leftX = clampInt(Math.round(((usedMinBin - dispMinBin) + 0.5) * pxPerBin), 0, canvasW - 1);
    const rightX = clampInt(Math.round(((usedMaxBin - dispMinBin) + 0.5) * pxPerBin), 0, canvasW - 1);

    // Tenkymi cervenymi ciarami oznacime hranice pouziteho spektra.
    ctx.fillStyle = 'rgba(255, 72, 72, 0.92)';
    ctx.fillRect(leftX, 0, 1, canvasH);
    if (rightX !== leftX) ctx.fillRect(rightX, 0, 1, canvasH);
}

function drawOverlayMarkers() {
    drawSpectrumBoundaryMarkers();
}

function freezeOnSuccessfulDecodeNow() {
    if (rowCounter <= 0) return;

    let startRow = detectedFrameStartRow;
    let endRow = detectedFrameEndRow;

    if (frameActivityActive) {
        startRow = frameActivityStartRow;
        endRow = Math.max(frameActivityLastRow, rowCounter);
    }

    if (startRow == null || endRow == null || endRow < startRow) {
        startRow = Math.max(1, rowCounter - 8);
        endRow = rowCounter;
    }

    paused = true;
    canvas.classList.add('paused');
    drawOverlayMarkers();
}

function scheduleFreezeOnSuccessfulDecode() {
    if (rowCounter <= 0) return;

    decodeFreezePending = true;
    decodeFreezeTargetRow = Math.max(decodeFreezeTargetRow, rowCounter + DECODE_FREEZE_EXTRA_ROWS);
    decodeFreezeForceRow = Math.max(decodeFreezeForceRow, rowCounter + DECODE_FREEZE_FORCE_ROWS);
}

// Konverzia HEX na [r, g, b]
function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(h => h + h).join('');
    const intVal = parseInt(hex, 16);
    return [(intVal >> 16) & 0xff, (intVal >> 8) & 0xff, intVal & 0xff];
}

// Linearna magnituda -> farba s gate a kontrastnym mapovanim.
function magToColor(mag, meanMag, gateMag, contrastBoost) {
    const gatedMag = Math.max(0, mag - gateMag);
    const denom = Math.max(1e-12, (MAGNITUDE_SCALE * meanMag) / contrastBoost);
    let alpha = gatedMag / denom;
    alpha = alpha / (alpha + SPECTROGRAM_SOFT_KNEE);
    alpha = Math.pow(Math.min(1, alpha), SPECTROGRAM_RESPONSE_GAMMA);
    const colorMin = hexToRgb(COLOR_MIN_HEX);
    const colorMax = hexToRgb(COLOR_MAX_HEX);
    const r = Math.round(colorMin[0] + alpha * (colorMax[0] - colorMin[0]));
    const g = Math.round(colorMin[1] + alpha * (colorMax[1] - colorMin[1]));
    const b = Math.round(colorMin[2] + alpha * (colorMax[2] - colorMin[2]));
    return (255 << 24) | (b << 16) | (g << 8) | r; // ABGR
}

// --- Spracovanie ramca ---
const ROW_HEIGHT = 3; // pocet pixelov na jeden FFT ramec

function processFrame(samples) {
    for (let i = 0; i < fftSize; i++) {
        fftRe[i] = samples[i] * win[i];
        fftIm[i] = 0;
    }
    runFFT();

    const n = numBins;

    // Vypocitame linearne magnitudy pre vsetky zobrazene biny a ich priemer
    let sumMag = 0;
    const mags = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const b = dispMinBin + i;
        const re = fftRe[b], im = fftIm[b];
        mags[i] = Math.sqrt(re * re + im * im);
        sumMag += mags[i];
    }
    const meanMag = sumMag / n;

    // Adaptivna uroven sumu (15. percentil) - sluzi vylucne na detekciu aktivity ramca
    const magsSorted = mags.slice().sort((a, b) => a - b);
    const noiseMag = magsSorted[(n * 0.15) | 0];
    noiseDb += NOISE_ADAPT * (20 * Math.log10(noiseMag + 1e-12) - noiseDb);

    const currentRow = ++rowCounter;
    const usedStart = clampInt(usedMinBin - dispMinBin, 0, n - 1);
    const usedEnd = clampInt(usedMaxBin - dispMinBin, 0, n - 1);
    let usedPeakDb = -Infinity;
    for (let i = usedStart; i <= usedEnd; i++) usedPeakDb = Math.max(usedPeakDb, 20 * Math.log10(mags[i] + 1e-12));
    const frameIsActive = usedPeakDb >= (noiseDb + FRAME_ACTIVITY_DB_DELTA);

    if (frameIsActive) {
        if (!frameActivityActive) frameActivityStartRow = currentRow;
        frameActivityActive = true;
        frameActivityLastRow = currentRow;
    } else if (frameActivityActive && (currentRow - frameActivityLastRow) >= FRAME_SILENCE_HANG_ROWS) {
        frameActivityActive = false;
        detectedFrameStartRow = frameActivityStartRow;
        detectedFrameEndRow = frameActivityLastRow;
    }

    if (decodeFreezePending) {
        // Nechaj spektrogram chvilu bezat, aby bol viditelny cely ramec.
        const tailReady = currentRow >= decodeFreezeTargetRow;
        const forceStop = currentRow >= decodeFreezeForceRow;
        if ((tailReady && !frameActivityActive) || forceStop) {
            decodeFreezePending = false;
            freezeOnSuccessfulDecodeNow();
        }
    }

    // Zvysime kontrast potlacenim sumoveho pozadia.
    const gateMag = Math.max(
        noiseMag * SPECTROGRAM_NOISE_GATE_MULT,
        meanMag * SPECTROGRAM_MEAN_GATE_RATIO
    );
    const contrastBoost = frameIsActive ? FRAME_ACTIVE_CONTRAST_BOOST : 1;

    // Vytiahneme lokalne vrcholy, aby boli jednotlive tony ostrejsie.
    const magsEnhanced = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const left = i > 0 ? mags[i - 1] : mags[i];
        const center = mags[i];
        const right = i + 1 < n ? mags[i + 1] : mags[i];
        const localPeak = Math.max(left, center, right);
        magsEnhanced[i] = center * (1 - SPECTROGRAM_PEAK_SHARPEN_BLEND) + localPeak * SPECTROGRAM_PEAK_SHARPEN_BLEND;
    }

    // Vykreslime kazdy pixel pomocou gate + kontrastnej mapy.
    const row = new Uint32Array(canvasW);
    for (let px = 0; px < canvasW; px++) {
        const i = Math.min(n - 1, Math.floor(px * (n / canvasW)));
        row[px] = magToColor(magsEnhanced[i], meanMag, gateMag, contrastBoost);
    }

    // Posun obsah hore a nakresli novy riadok na spodok.
    ctx.drawImage(canvas, 0, -ROW_HEIGHT);
    const tmpRow = new Uint32Array(canvasW * ROW_HEIGHT);
    for (let i = 0; i < ROW_HEIGHT; i++) tmpRow.set(row, i * canvasW);
    const imgRow = new ImageData(new Uint8ClampedArray(tmpRow.buffer), canvasW, ROW_HEIGHT);
    ctx.putImageData(imgRow, 0, canvasH - ROW_HEIGHT);
    drawOverlayMarkers();
}

// --- Audio ---
let paused = false;
window.addEventListener('audioprocess', (e) => {
    if (!graphTab.classList.contains('opened') || paused) return;
    if (canvasW <= 1 || canvasH <= 1) resize();
    const input = e.detail.inputBuffer.getChannelData(0);
    let offset = 0, len = input.length;
    while (offset < len) {
        const need = fftSize - ringFill;
        const toCopy = Math.min(need, len - offset);
        ringBuf.set(input.subarray(offset, offset + toCopy), ringFill);
        ringFill += toCopy; offset += toCopy;
        if (ringFill >= fftSize) {
            processFrame(ringBuf);
            ringBuf.copyWithin(0, hopSize);
            ringFill -= hopSize;
        }
    }
});

// --- Profil ---
function updateProfile() {
    const mp = TinyTUS?.currentlyUsedModemProfile;
    let size = mp ? Number(mp.samples_per_symbol) : 1024;
    let p = 1; while (p < size) p <<= 1;
    setupFFT(p);

    const maxBin = fftSize / 2 - 1;
    const minF = mp ? Number(mp.min_tx_freq) : 1500;
    const maxF = mp ? Number(mp.max_tx_freq) : 4000;
    usedMinBin = clampInt(Math.floor(Math.min(minF, maxF) / binHz), 0, maxBin);
    usedMaxBin = clampInt(Math.ceil(Math.max(minF, maxF) / binHz), 0, maxBin);

    const usedBins = Math.max(1, usedMaxBin - usedMinBin + 1);
    const sidePadBins = Math.max(
        SPECTRUM_SIDE_PAD_MIN_BINS,
        Math.round(usedBins * SPECTRUM_SIDE_PAD_RATIO)
    );

    // Pridame malu rezervu po bokoch, aby hranicne ciary neboli nalepene na okraj.
    dispMinBin = clampInt(usedMinBin - sidePadBins, 0, maxBin);
    dispMaxBin = clampInt(usedMaxBin + sidePadBins, 0, maxBin);
    numBins = Math.max(1, dispMaxBin - dispMinBin + 1);

    noiseDb = DB_FLOOR;
    rowCounter = 0;
    frameActivityActive = false;
    frameActivityStartRow = 0;
    frameActivityLastRow = 0;
    detectedFrameStartRow = null;
    detectedFrameEndRow = null;
    decodeFreezePending = false;
    decodeFreezeTargetRow = 0;
    decodeFreezeForceRow = 0;
    paused = false;
    canvas.classList.remove('paused');
    resize();
}

window.addEventListener('active-modem-profile-changed', updateProfile);
window.addEventListener('resize', resize);
window.addEventListener('message-received', scheduleFreezeOnSuccessfulDecode);
window.addEventListener('image-frame-received', scheduleFreezeOnSuccessfulDecode);

const themeClassObserver = new MutationObserver(() => {
    applyThemePalette(true);
});
themeClassObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
});

canvas.addEventListener('click', () => {
    paused = !paused;
    canvas.classList.toggle('paused', paused);
    if (!paused) {
        decodeFreezePending = false;
        decodeFreezeTargetRow = 0;
        decodeFreezeForceRow = 0;
    }
});

applyThemePalette();
updateProfile();
