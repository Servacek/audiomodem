// Spektrogram pre GFSK vizualizaciu.
// FFT_SIZE 1024 musi sediet s modem samples_per_symbol.
// Brana 1 kontroluje lokalny kontrast, brana 2 absolutny prah.

const FFT_SIZE         = 1024;   // Musi sediet s modem samples_per_symbol.
const SAMPLE_RATE      = 48000;
const MIN_DISPLAY_FREQ = 1800;
const MAX_DISPLAY_FREQ = 8000;
const HOP_SIZE         = 512;    // Asi 94 riadkov/s.
const CANVAS_W         = 512;
const CANVAS_H         = 256;

// Brana 1: lokalny pomer k minimu susedov.
// Funguje pre marker aj datove tony.
const CONTRAST_RADIUS    = 2;
const CONTRAST_THRESHOLD = 3.5;
const CONTRAST_CEILING   = 28.0;

// Brana 2: nizky squelch, potlaci len ticho.
// Nesmie potlacit slabe marker tony.
const FLOOR_ADAPT_RATE = 0.02;
const FLOOR_MARGIN     = 2.5;    // Nizky margin len pre squelch.
const ACTIVITY_RATIO   = 3.5;   // Pri aktivite zmraz floor.

// DOM a canvas.
const container = document.getElementById("spectrogram-container");
const graphTab  = document.getElementById("tab-graph");

const canvas   = document.createElement("canvas");
canvas.width   = CANVAS_W;
canvas.height  = CANVAS_H;
container.appendChild(canvas);

let spectrogramRunning = true;
canvas.addEventListener("click", () => { spectrogramRunning = !spectrogramRunning; });

const ctx = canvas.getContext("2d", { willReadFrequently: false });
graphTab.classList.add("loaded");

ctx.fillStyle = "#f8f6f0";
ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

// Stav.
let adaptiveFloor = 1e-5;

const ringBuffer = new Float32Array(FFT_SIZE);
let ringFilled = 0;
let hopCount   = 0;

// Mapovanie frekvencnych binov.
const binHz   = SAMPLE_RATE / FFT_SIZE;   // 46.875 Hz/bin, sedi s modem mriezkou.
const minBin  = Math.floor(MIN_DISPLAY_FREQ / binHz);
const maxBin  = Math.min(Math.ceil(MAX_DISPLAY_FREQ  / binHz), FFT_SIZE / 2);
const numBins = maxBin - minBin;

// Blackman-Harris 4-term okno.
const bhWindow = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
    const a = (2 * Math.PI * i) / (FFT_SIZE - 1);
    bhWindow[i] =  0.35875
                 - 0.48829 * Math.cos(    a)
                 + 0.14128 * Math.cos(2 * a)
                 - 0.01168 * Math.cos(3 * a);
}

// FFT tabulky.
const bitReversalTable = new Uint32Array(FFT_SIZE);
{
    const bits = Math.log2(FFT_SIZE) | 0;
    for (let i = 0; i < FFT_SIZE; i++) {
        let rev = 0, val = i;
        for (let b = 0; b < bits; b++) { rev = (rev << 1) | (val & 1); val >>= 1; }
        bitReversalTable[i] = rev;
    }
}
const twiddleRe = new Float64Array(FFT_SIZE / 2);
const twiddleIm = new Float64Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) {
    const a = (-2 * Math.PI * i) / FFT_SIZE;
    twiddleRe[i] = Math.cos(a);
    twiddleIm[i] = Math.sin(a);
}
const fftRe = new Float64Array(FFT_SIZE);
const fftIm = new Float64Array(FFT_SIZE);

function fft(re, im) {
    const N = re.length;
    for (let i = 0; i < N; i++) {
        const j = bitReversalTable[i];
        if (j > i) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    for (let size = 2; size <= N; size *= 2) {
        const half = size >> 1, step = N / size;
        for (let i = 0; i < N; i += size) {
            for (let k = 0; k < half; k++) {
                const tw   = k * step;
                const eIdx = i + k, oIdx = eIdx + half;
                const oR = re[oIdx] * twiddleRe[tw] - im[oIdx] * twiddleIm[tw];
                const oI = re[oIdx] * twiddleIm[tw] + im[oIdx] * twiddleRe[tw];
                re[oIdx] = re[eIdx] - oR;  im[oIdx] = im[eIdx] - oI;
                re[eIdx] += oR;            im[eIdx] += oI;
            }
        }
    }
}

// Farebna mapa od svetlej po tmavu.
const BG_R = 248, BG_G = 246, BG_B = 240;
const colourLUT = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let r, g, b;
    if (v < 0.06) {
        r = BG_R; g = BG_G; b = BG_B;
    } else if (v < 0.22) {
        const t = (v - 0.06) / 0.16;
        r = 255; g = Math.round(BG_G - (BG_G - 200) * t); b = Math.round(BG_B - (BG_B - 120) * t);
    } else if (v < 0.42) {
        const t = (v - 0.22) / 0.20;
        r = 255; g = Math.round(200 - 70 * t); b = Math.round(120 - 90 * t);
    } else if (v < 0.62) {
        const t = (v - 0.42) / 0.20;
        r = 255; g = Math.round(130 - 80 * t); b = Math.round(30 - 20 * t);
    } else if (v < 0.78) {
        const t = (v - 0.62) / 0.16;
        r = 255; g = Math.round(50 - 40 * t); b = 0;
    } else if (v < 0.90) {
        const t = (v - 0.78) / 0.12;
        r = Math.round(255 - 140 * t); g = Math.round(10 - 10 * t); b = 0;
    } else {
        const t = (v - 0.90) / 0.10;
        r = Math.round(115 - 89 * t); g = 0; b = 0;
    }
    colourLUT[i * 3    ] = r;
    colourLUT[i * 3 + 1] = g;
    colourLUT[i * 3 + 2] = b;
}

// Spracovanie jedneho frame.
const rowImageData = ctx.createImageData(CANVAS_W, 1);
const rowPixels    = rowImageData.data;
const bgMin        = new Float32Array(numBins);

const LOG_THRESH  = Math.log(CONTRAST_THRESHOLD);
const LOG_CEIL    = Math.log(CONTRAST_CEILING);
const INV_LOG_RNG = 1.0 / (LOG_CEIL - LOG_THRESH);

function processFrame(samples) {
    // 1. Okno + FFT.
    for (let i = 0; i < FFT_SIZE; i++) {
        fftRe[i] = samples[i] * bhWindow[i];
        fftIm[i] = 0;
    }
    fft(fftRe, fftIm);

    // 2. Magnituda.
    const mags = new Float32Array(numBins);
    const invN = 1.0 / FFT_SIZE;
    for (let i = 0; i < numBins; i++) {
        const b  = minBin + i;
        const re = fftRe[b], im = fftIm[b];
        mags[i]  = Math.sqrt(re * re + im * im) * invN;
    }

    // 3a. Brana 2 so zmrazenym adaptive floor.
    // Pri aktivite floor zmraz, aby silne tony nezdvihli referenciu.
    const sorted  = mags.slice().sort();
    const median  = sorted[numBins >> 1];
    const isActive = (median > adaptiveFloor * ACTIVITY_RATIO);
    if (!isActive) {
        // V tichu nech floor sleduje realny sum.
        const frameP05 = sorted[(numBins * 0.05) | 0];
        adaptiveFloor += FLOOR_ADAPT_RATE * (frameP05 - adaptiveFloor);
    }
    // Pri aktivnom prenose adaptiveFloor ostava zmrazeny.
    const floorGate = adaptiveFloor * FLOOR_MARGIN;

    // 3b. Brana 1 pre lokalny kontrast.
    const R = CONTRAST_RADIUS;
    for (let i = 0; i < numBins; i++) {
        let minVal = Infinity;
        const lo = Math.max(0,           i - R);
        const hi = Math.min(numBins - 1, i + R);
        for (let j = lo; j <= hi; j++) {
            if (j !== i && mags[j] < minVal) minVal = mags[j];
        }
        bgMin[i] = (minVal === Infinity ? 1e-12 : minVal) + 1e-12;
    }

    // 4. Scroll.
    ctx.drawImage(canvas, 0, -1);

    // 5. Kreslenie.
    const xScale = CANVAS_W / numBins;
    for (let i = 0; i < numBins; i++) {
        const mag   = mags[i];
        const ratio = mag / bgMin[i];

        let norm = 0;
        if (ratio > CONTRAST_THRESHOLD && mag > floorGate) {
            const logR = Math.log(ratio);
            norm = Math.max(0, Math.min(1, (logR - LOG_THRESH) * INV_LOG_RNG));
        }

        const lut = (norm * 255) | 0;
        const r   = colourLUT[lut * 3    ];
        const g   = colourLUT[lut * 3 + 1];
        const b   = colourLUT[lut * 3 + 2];

        const x0 = (i       * xScale) | 0;
        const x1 = ((i + 1) * xScale) | 0;
        for (let x = x0; x < x1; x++) {
            const p          = x * 4;
            rowPixels[p    ] = r;
            rowPixels[p + 1] = g;
            rowPixels[p + 2] = b;
            rowPixels[p + 3] = 255;
        }
    }

    ctx.putImageData(rowImageData, 0, CANVAS_H - 1);
}

// Obsluha audio eventu.
let audioprocessHandler = null;

audioprocessHandler = function (e) {
    if (!graphTab.classList.contains("opened")) return;
    if (!spectrogramRunning) return;

    const input  = e.detail.inputBuffer.getChannelData(0);
    const len    = input.length;
    let   offset = 0;

    while (offset < len) {
        if (ringFilled < FFT_SIZE) {
            const need   = FFT_SIZE - ringFilled;
            const toCopy = Math.min(need, len - offset);
            ringBuffer.set(input.subarray(offset, offset + toCopy), ringFilled);
            ringFilled += toCopy;
            offset     += toCopy;
            if (ringFilled >= FFT_SIZE) {
                processFrame(ringBuffer);
                hopCount = 0;
            }
        } else {
            const need   = HOP_SIZE - hopCount;
            const toCopy = Math.min(need, len - offset);
            if (hopCount === 0 && toCopy === HOP_SIZE) {
                ringBuffer.copyWithin(0, HOP_SIZE);
                ringBuffer.set(input.subarray(offset, offset + toCopy), FFT_SIZE - HOP_SIZE);
            } else {
                if (hopCount === 0) ringBuffer.copyWithin(0, HOP_SIZE);
                ringBuffer.set(input.subarray(offset, offset + toCopy),
                               FFT_SIZE - HOP_SIZE + hopCount);
            }
            hopCount += toCopy;
            offset   += toCopy;
            if (hopCount >= HOP_SIZE) {
                processFrame(ringBuffer);
                hopCount = 0;
            }
        }
    }
};

window.addEventListener("audioprocess", audioprocessHandler);
