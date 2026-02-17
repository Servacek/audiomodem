// ─── Configuration ───────────────────────────────────────────────────
const FFT_SIZE = 1024;           // Must be power of 2
const SAMPLE_RATE = 48000;       // Must match AudioContext sample rate
const MAX_DISPLAY_FREQ = 6000;   // Max frequency shown on spectrogram (Hz)
const HOP_SIZE = 256;            // Hop between frames (75% overlap → 4× time resolution)
const CANVAS_W = 512;            // Fixed pixel width  (stretched via CSS)
const CANVAS_H = 256;            // Fixed pixel height
const NOISE_MARGIN = 3.0;        // Adaptive floor = median × this (higher = more noise suppression)
const ADAPT_RATE = 0.05;         // How fast the noise floor adapts (0–1, lower = smoother)

// ─── DOM Elements ────────────────────────────────────────────────────
const container = document.getElementById("spectrogram-container");
const graphTab = document.getElementById("tab-graph");

// Create canvas with fixed pixel dimensions (CSS stretches it to fill)
const canvas = document.createElement("canvas");
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
container.appendChild(canvas);

const ctx = canvas.getContext("2d", { willReadFrequently: false });

// Mark the tab as loaded — this hides the spinner and makes content visible
graphTab.classList.add("loaded");

// ─── Ring buffer for overlapping frames ──────────────────────────────
// Keeps FFT_SIZE samples; after first fill, shifts by HOP_SIZE each time.
const ringBuffer = new Float32Array(FFT_SIZE);
let ringFilled = 0;   // how many samples collected so far (before first full window)
let hopCount = 0;     // samples collected since last FFT frame

// ─── Number of FFT bins we actually display ──────────────────────────
const binHz = SAMPLE_RATE / FFT_SIZE;
const numBins = Math.min(Math.ceil(MAX_DISPLAY_FREQ / binHz), FFT_SIZE / 2);

// ─── Precomputed Hann Window ─────────────────────────────────────────
const hannWindow = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
    hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
}

// ─── Bit-reversal table ──────────────────────────────────────────────
const bitReversalTable = new Uint32Array(FFT_SIZE);
{
    const bits = Math.log2(FFT_SIZE) | 0;
    for (let i = 0; i < FFT_SIZE; i++) {
        let reversed = 0, val = i;
        for (let b = 0; b < bits; b++) {
            reversed = (reversed << 1) | (val & 1);
            val >>= 1;
        }
        bitReversalTable[i] = reversed;
    }
}

// ─── Precomputed twiddle factors ─────────────────────────────────────
const twiddleRe = new Float64Array(FFT_SIZE / 2);
const twiddleIm = new Float64Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) {
    const a = (-2 * Math.PI * i) / FFT_SIZE;
    twiddleRe[i] = Math.cos(a);
    twiddleIm[i] = Math.sin(a);
}

// ─── Precomputed colour LUT (256 entries) ────────────────────────────
// High-contrast colormap: black → blue → cyan → green → yellow → red → white
const colourLUT = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let r, g, b;
    if (v < 0.15) {
        // Black → deep blue
        const t = v / 0.15;
        r = 0; g = 0; b = Math.round(140 * t);
    } else if (v < 0.35) {
        // Deep blue → cyan
        const t = (v - 0.15) / 0.20;
        r = 0; g = Math.round(255 * t); b = Math.round(140 + 115 * t);
    } else if (v < 0.55) {
        // Cyan → green
        const t = (v - 0.35) / 0.20;
        r = 0; g = 255; b = Math.round(255 * (1 - t));
    } else if (v < 0.75) {
        // Green → yellow
        const t = (v - 0.55) / 0.20;
        r = Math.round(255 * t); g = 255; b = 0;
    } else if (v < 0.90) {
        // Yellow → red
        const t = (v - 0.75) / 0.15;
        r = 255; g = Math.round(255 * (1 - t)); b = 0;
    } else {
        // Red → white
        const t = (v - 0.90) / 0.10;
        r = 255; g = Math.round(255 * t); b = Math.round(255 * t);
    }
    colourLUT[i * 3]     = r;
    colourLUT[i * 3 + 1] = g;
    colourLUT[i * 3 + 2] = b;
}

// ─── Reusable row ImageData ──────────────────────────────────────────
const rowImageData = ctx.createImageData(CANVAS_W, 1);
const rowPixels = rowImageData.data; // Uint8ClampedArray

// ─── FFT (in-place, radix-2 Cooley-Tukey) ────────────────────────────
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
                const tw = k * step;
                const eIdx = i + k, oIdx = eIdx + half;
                const oR = re[oIdx] * twiddleRe[tw] - im[oIdx] * twiddleIm[tw];
                const oI = re[oIdx] * twiddleIm[tw] + im[oIdx] * twiddleRe[tw];
                re[oIdx] = re[eIdx] - oR;
                im[oIdx] = im[eIdx] - oI;
                re[eIdx] += oR;
                im[eIdx] += oI;
            }
        }
    }
}

// ─── Cached FFT work arrays ─────────────────────────────────────────
const fftRe = new Float64Array(FFT_SIZE);
const fftIm = new Float64Array(FFT_SIZE);

// ─── Adaptive noise floor state ──────────────────────────────────────
let noiseFloor = 0.001;          // Initial estimate, will auto-adjust
let medianEstimate = 0.001;      // Running estimate of median magnitude

// ─── Process one FFT frame and draw one spectrogram row ──────────────
function processFrame(samples) {
    // Window + copy into work arrays
    for (let i = 0; i < FFT_SIZE; i++) {
        fftRe[i] = samples[i] * hannWindow[i];
        fftIm[i] = 0;
    }

    fft(fftRe, fftIm);

    // Compute magnitudes for all displayed bins
    const mags = new Float32Array(numBins);
    for (let i = 0; i < numBins; i++) {
        mags[i] = Math.sqrt(fftRe[i] * fftRe[i] + fftIm[i] * fftIm[i]) / FFT_SIZE;
    }

    // Update adaptive noise floor: track the median magnitude
    // Use a partial sort to find the median efficiently
    const sorted = mags.slice().sort();
    const frameMedian = sorted[numBins >> 1];
    medianEstimate += ADAPT_RATE * (frameMedian - medianEstimate);
    noiseFloor = Math.max(medianEstimate * NOISE_MARGIN, 1e-6);

    const logFloor = Math.log10(noiseFloor);
    const invLogFloor = 1 / -logFloor;

    // Scroll the existing image up by 1 pixel (single GPU-accelerated op)
    ctx.drawImage(canvas, 0, -1);

    // Build the new bottom row into rowImageData
    const xScale = CANVAS_W / numBins;

    for (let i = 0; i < numBins; i++) {
        const logVal = Math.log10(Math.max(mags[i], noiseFloor));
        const norm = Math.max(0, Math.min(1, (logVal - logFloor) * invLogFloor));
        const lut = (norm * 255) | 0;

        const r = colourLUT[lut * 3];
        const g = colourLUT[lut * 3 + 1];
        const b = colourLUT[lut * 3 + 2];

        // Fill all pixels that this bin covers
        const x0 = (i * xScale) | 0;
        const x1 = ((i + 1) * xScale) | 0;
        for (let x = x0; x < x1; x++) {
            const p = x * 4;
            rowPixels[p]     = r;
            rowPixels[p + 1] = g;
            rowPixels[p + 2] = b;
            rowPixels[p + 3] = 255;
        }
    }

    // Draw the single new row at the bottom
    ctx.putImageData(rowImageData, 0, CANVAS_H - 1);
}

// ─── Audio event handler ─────────────────────────────────────────────
window.addEventListener("audioprocess", (e) => {
    // Only process when the graph tab is visible
    if (!graphTab.classList.contains("opened")) return;

    const input = e.detail.inputBuffer.getChannelData(0);
    const len = input.length;
    let offset = 0;

    while (offset < len) {
        if (ringFilled < FFT_SIZE) {
            // Initial fill — accumulate until we have a full window
            const need = FFT_SIZE - ringFilled;
            const toCopy = Math.min(need, len - offset);
            ringBuffer.set(input.subarray(offset, offset + toCopy), ringFilled);
            ringFilled += toCopy;
            offset += toCopy;
            if (ringFilled >= FFT_SIZE) {
                processFrame(ringBuffer);
                hopCount = 0;
            }
        } else {
            // Overlap mode — shift by HOP_SIZE and process
            const need = HOP_SIZE - hopCount;
            const toCopy = Math.min(need, len - offset);
            // Shift old samples left and append new ones at the end
            if (hopCount === 0 && toCopy === HOP_SIZE) {
                // Fast path: shift + copy in one go
                ringBuffer.copyWithin(0, HOP_SIZE);
                ringBuffer.set(input.subarray(offset, offset + toCopy), FFT_SIZE - HOP_SIZE);
            } else {
                // Partial: append into the tail region
                if (hopCount === 0) {
                    ringBuffer.copyWithin(0, HOP_SIZE);
                }
                ringBuffer.set(input.subarray(offset, offset + toCopy), FFT_SIZE - HOP_SIZE + hopCount);
            }
            hopCount += toCopy;
            offset += toCopy;
            if (hopCount >= HOP_SIZE) {
                processFrame(ringBuffer);
                hopCount = 0;
            }
        }
    }
});
