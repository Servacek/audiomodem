import { TinyTUS } from '../../libs/tinytus/tinytus.js';

const SAMPLE_RATE = 48000;
const DB_FLOOR = 100;
const DB_CEIL = -15;
const NOISE_ADAPT = 0.5;

// ─── DOM ─────────────────────────────────────
const graphTab = document.getElementById('tab-graph');
const container = document.getElementById('spectrogram-container');

const canvas = document.createElement('canvas');
canvas.id = 'spectrogram-canvas';
canvas.style.width = '100%';
canvas.style.height = '100%';
canvas.style.border = "2px solid #373637";
container.appendChild(canvas);
const ctx = canvas.getContext('2d');

graphTab.classList.add('loaded');

// ─── STATE ───────────────────────────────────
let fftSize = 1024;
let binHz = SAMPLE_RATE / fftSize;
let dispMinBin = 0, dispMaxBin = fftSize / 2 - 1;
let numBins = dispMaxBin - dispMinBin + 1;

let fftRe, fftIm, bitRev, twRe, twIm, win;
let ringBuf = null, ringFill = 0, hopSize = 0;
let noiseDb = DB_FLOOR;

// ─── FFT SETUP ───────────────────────────────
function setupFFT(N) {
    fftSize = N;
    binHz = SAMPLE_RATE / fftSize;
    fftRe = new Float32Array(N);
    fftIm = new Float32Array(N);

    // bit reverse
    bitRev = new Uint32Array(N);
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
        let x = i, y = 0;
        for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; }
        bitRev[i] = y;
    }

    // twiddles
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
    hopSize = Math.max(1, N / 2); // Zabrání nekonecnej slucke pri fftSize=1.
}

// ─── RUN FFT ─────────────────────────────────
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

let COLOR_MIN_HEX = "#0d0d0d"; // dark blue / near black
let COLOR_MAX_HEX = "#58ee87"; // greenish-white

// ─── CANVAS ──────────────────────────────────
let canvasW = 0, canvasH = 0;
function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvasW = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvasH = Math.max(1, Math.round(canvas.clientHeight * dpr));
    canvas.width = canvasW; canvas.height = canvasH;
    ctx.fillStyle = COLOR_MIN_HEX;
    ctx.fillRect(0, 0, canvasW, canvasH);
}

// Convert HEX to [r,g,b]
function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(h => h + h).join('');
    const intVal = parseInt(hex, 16);
    return [(intVal >> 16) & 0xff, (intVal >> 8) & 0xff, intVal & 0xff];
}

// db → color interpolation
function dbToColor(db, dynamicMin, colorMinHex = COLOR_MIN_HEX, colorMaxHex = COLOR_MAX_HEX) {
    const colorMin = hexToRgb(colorMinHex);
    const colorMax = hexToRgb(colorMaxHex);

    const floor = dynamicMin + 8;
    const t = Math.max(0, Math.min(1, (db - floor) / (DB_CEIL - floor)));

    const r = Math.round(colorMin[0] + t * (colorMax[0] - colorMin[0]));
    const g = Math.round(colorMin[1] + t * (colorMax[1] - colorMin[1]));
    const b = Math.round(colorMin[2] + t * (colorMax[2] - colorMin[2]));

    return (255 << 24) | (b << 16) | (g << 8) | r; // ABGR
}

// ─── PROCESS FRAME ──────────────────────────
const ROW_HEIGHT = 3; // number of pixels per FFT frame

function processFrame(samples) {
    for (let i = 0; i < fftSize; i++) {
        fftRe[i] = samples[i] * win[i];
        fftIm[i] = 0;
    }
    runFFT();

    const n = numBins;
    const dbs = new Float32Array(n);

    // Compute all dB values for noise floor estimation
    for (let i = 0; i < n; i++) {
        const b = dispMinBin + i;
        const re = fftRe[b], im = fftIm[b];
        const mag = Math.sqrt(re * re + im * im);
        dbs[i] = 20 * Math.log10(mag + 1e-12);
    }

    // Adaptive noise floor (15th percentile)
    const sorted = dbs.slice().sort((a, b) => a - b);
    const noiseEstimate = sorted[(n * 0.15) | 0];
    noiseDb += NOISE_ADAPT * (noiseEstimate - noiseDb);

    const row = new Uint32Array(canvasW);
    for (let px = 0; px < canvasW; px++) {
        const b = Math.min(dispMinBin + Math.floor(px * (n / canvasW)), dispMaxBin);
        const re = fftRe[b], im = fftIm[b];
        const mag = Math.sqrt(re * re + im * im);
        const db = 20 * Math.log10(mag + 1e-12);
        if (db < -4) {
            // 15, 14, 15
            const colorMin = hexToRgb(COLOR_MIN_HEX);
            row[px] = (255 << 24) | (colorMin[2] << 16) | (colorMin[1] << 8) | colorMin[0]; // Set to black for low dB values
        } else {
            row[px] = dbToColor(db, noiseDb);
        }
    }

    // Posun obsah hore a nakresli novy riadok na spodok.
    ctx.drawImage(canvas, 0, -ROW_HEIGHT);
    const tmpRow = new Uint32Array(canvasW * ROW_HEIGHT);
    for (let i = 0; i < ROW_HEIGHT; i++) tmpRow.set(row, i * canvasW);
    const imgRow = new ImageData(new Uint8ClampedArray(tmpRow.buffer), canvasW, ROW_HEIGHT);
    ctx.putImageData(imgRow, 0, canvasH - ROW_HEIGHT);
}

// ─── AUDIO ──────────────────────────────────
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

// ─── PROFILE ────────────────────────────────
function updateProfile() {
    const mp = TinyTUS?.currentlyUsedModemProfile;
    let size = mp ? Number(mp.samples_per_symbol) : 1024;
    let p = 1; while (p < size) p <<= 1;
    setupFFT(p);

    const minF = mp ? Number(mp.min_tx_freq) : 1500;
    const maxF = mp ? Number(mp.max_tx_freq) : 4000;
    dispMinBin = Math.floor(Math.min(minF, maxF) / binHz);
    dispMaxBin = Math.ceil(Math.max(minF, maxF) / binHz);
    numBins = Math.max(1, dispMaxBin - dispMinBin + 1);

    noiseDb = DB_FLOOR;
    resize();
}

window.addEventListener('active-modem-profile-changed', updateProfile);
window.addEventListener('resize', resize);
canvas.addEventListener('click', () => {
    paused = !paused;
});

updateProfile();
