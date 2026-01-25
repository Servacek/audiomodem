// import { Tinitus } from '../tinitus.js';
// import { plotFFT, plotFFTWaterfall, plotWaveform, drawFFT } from '../plotter.js';
// import * as CONST from "../constants.js";

// const TAB = document.getElementById(CONST.TAB.GRAPH);

// const fftGraph = document.getElementById("fft-result-graph");
// const waveformGraph = document.getElementById("input-waveform-graph");
// const waterfallCheckbox = document.getElementById("waterfall-checkbox");

// function onClick() {fftGraph.paused = !fftGraph.paused;}

// fftGraph.addEventListener("click", onClick)
// waveformGraph.addEventListener("click", onClick)


// function onProcessAudioFFTChunk(e) {
//     // Do only update the canvas when we are visible and running!
//     if (fftGraph.paused == true || fftGraph.offsetParent == null) {
//         return;
//     }

//     if (TAB.classList.contains("loaded") == false) {
//         TAB.classList.add("loaded");
//     }

//     const inputBuffer = e.detail.inputBuffer;

//     // Plot the input waveform we are computing the FFT from.
//     plotWaveform(waveformGraph, inputBuffer);

//     const fftSize = inputBuffer.length; // Should already be a power of 2.
//     const startPtr = Tinitus.MEMORY_STACK_START;
//     const realPtr = startPtr;
//     const imagPtr = realPtr + fftSize*4;

//     // Prepare the arrays for the FFT.
//     Tinitus.MEMORY_F32.set(inputBuffer, realPtr>>2);
//     Tinitus.MEMORY_F32.fill(0, imagPtr>>2, (imagPtr+fftSize*4)>>2);
//     Tinitus.EXPORTS.fft(realPtr, imagPtr, fftSize);

//     // Retrieve the computed real and imaginary numbers from memory
//     const computedReal = new Float32Array(Tinitus.BUFFER, realPtr, fftSize)
//     const computedImag = new Float32Array(Tinitus.BUFFER, imagPtr, fftSize)

//     // console.log("Computed Real:", computedReal);
//     // console.log("Computed Imaginary:", computedImag);

//     // for (let i = 0; i < computedImag.length; i++) {
//     //     console.log(`Computed Imaginary [${i}]:`, computedImag[i]);
//     // }

//     const SAMPLING_FREQUENCY = Tinitus.MEMORY_U32[48000/4];

//     const maxFreq = 5000; // Define the maximum frequency to display
//     const freqBinSize = SAMPLING_FREQUENCY / fftSize; // Frequency resolution

//     // Generate frequencies array and calculate magnitudes
//     const frequencies = Array.from({ length: fftSize / 2 }, (_, i) => Math.round(i * freqBinSize));
//     const magnitudes = computedReal.map((r, i) => Math.sqrt(r * r + computedImag[i] * computedImag[i]));

//     // Filter frequencies and magnitudes for the desired range
//     const filteredFrequencies = frequencies.filter((freq) => freq <= maxFreq);
//     const filteredMagnitudes = magnitudes.slice(0, filteredFrequencies.length); // Match the filtered frequencies
//     //const filteredMagnitudesDB = filteredMagnitudes.map((mag) => 20 * Math.log10(mag));

//     // Plot the result
//     // plotFFT(fft_graph, filteredFrequencies, filteredMagnitudes);
//     if (waterfallCheckbox.checked) {
//         plotFFTWaterfall(fftGraph, filteredFrequencies, filteredMagnitudes);
//     } else {
//         drawFFT(fftGraph, filteredFrequencies, filteredMagnitudes);
//     }

//     const peakMagnitudeIndex = filteredMagnitudes.indexOf(Math.max(...filteredMagnitudes));
//     const peakFrequency = filteredFrequencies[peakMagnitudeIndex];
//     const peakFrequencySpan = document.getElementById("peak-frequency");
//     peakFrequencySpan.textContent = `Peak frequency: ${peakFrequency} Hz`;

//     //console.log(getPeakFrequency(normalizedBuffer));

//     // if (res && res.length > 0) {
//     //     res = new TextDecoder("utf-8").decode(res);
//     //     rxData.value = res;
//     // }
// }

// window.addEventListener("audioprocess", onProcessAudioFFTChunk);

import { Tinitus } from '../../libs/tinitus/tinitus.js';
import { plotWaveform, plotFFTWaterfall, drawFFT } from '../plotter.js';
import * as CONST from "../constants.js";

/**
 * Spectrogram Visualizer
 * Handles FFT computation and visualization with waterfall mode
 */
class SpectrogramVisualizer {
    constructor() {
        // DOM elements
        this.tab = document.getElementById(CONST.TAB.GRAPH);
        this.fftCanvas = document.getElementById("fft-result-graph");
        this.waveformCanvas = document.getElementById("input-waveform-graph");
        this.waterfallCheckbox = document.getElementById("waterfall-checkbox");
        this.peakFrequencyDisplay = document.getElementById("peak-frequency");

        // Configuration
        this.config = {
            maxDisplayFrequency: 5000, // Hz
            defaultSampleRate: 48000   // Hz
        };

        // State
        this.isPaused = false;

        this.init();
    }

    init() {
        this.attachEventListeners();
        window.addEventListener("audioprocess", (e) => this.onAudioProcess(e));
    }

    attachEventListeners() {
        const togglePause = () => {
            this.isPaused = !this.isPaused;
            this.fftCanvas.paused = this.isPaused;
        };

        this.fftCanvas.addEventListener("click", togglePause);
        this.waveformCanvas.addEventListener("click", togglePause);
    }

    onAudioProcess(event) {
        if (!this.shouldRender()) return;

        this.markTabAsLoaded();

        const inputBuffer = event.detail.inputBuffer;
        this.renderWaveform(inputBuffer);

        const fftResult = this.computeFFT(inputBuffer);
        const spectrum = this.extractSpectrum(fftResult, inputBuffer.length);

        this.renderSpectrum(spectrum);
        this.updatePeakFrequency(spectrum);
    }

    shouldRender() {
        return !this.isPaused && this.fftCanvas.offsetParent !== null;
    }

    markTabAsLoaded() {
        if (!this.tab.classList.contains("loaded")) {
            this.tab.classList.add("loaded");
        }
    }

    renderWaveform(buffer) {
        plotWaveform(this.waveformCanvas, buffer);
    }

    computeFFT(inputBuffer) {
        const fftSize = inputBuffer.length;
        const startPtr = Tinitus.MEMORY_STACK_START;
        const realPtr = startPtr;
        const imagPtr = realPtr + fftSize * 4;

        // Prepare input arrays
        Tinitus.MEMORY_F32.set(inputBuffer, realPtr >> 2);
        Tinitus.MEMORY_F32.fill(0, imagPtr >> 2, (imagPtr + fftSize * 4) >> 2);

        // Compute FFT
        Tinitus.EXPORTS.fft(realPtr, imagPtr, fftSize);

        // Extract results
        const real = new Float32Array(Tinitus.BUFFER, realPtr, fftSize);
        const imag = new Float32Array(Tinitus.BUFFER, imagPtr, fftSize);

        return { real, imag };
    }

    extractSpectrum(fftResult, fftSize) {
        const sampleRate = Tinitus.MEMORY_U32[this.config.defaultSampleRate / 4];
        const freqBinSize = sampleRate / fftSize;
        const nyquistBins = fftSize / 2;

        // Calculate magnitudes
        const magnitudes = Array.from({ length: nyquistBins }, (_, i) => {
            const real = fftResult.real[i];
            const imag = fftResult.imag[i];
            return Math.sqrt(real * real + imag * imag);
        });

        // Generate frequency bins
        const frequencies = Array.from({ length: nyquistBins },
            (_, i) => Math.round(i * freqBinSize));

        // Filter to display range
        const maxIdx = frequencies.findIndex(f => f > this.config.maxDisplayFrequency);
        const cutoffIdx = maxIdx === -1 ? frequencies.length : maxIdx;

        return {
            frequencies: frequencies.slice(0, cutoffIdx),
            magnitudes: magnitudes.slice(0, cutoffIdx)
        };
    }

    renderSpectrum(spectrum) {
        if (this.waterfallCheckbox.checked) {
            plotFFTWaterfall(this.fftCanvas, spectrum.frequencies, spectrum.magnitudes, {
                magnitudeScaling: 'log',
                noiseFloor: 0.005,
                colormap: 'viridis'
            });
        } else {
            drawFFT(this.fftCanvas, spectrum.frequencies, spectrum.magnitudes);
        }
    }

    updatePeakFrequency(spectrum) {
        const peakIdx = spectrum.magnitudes.indexOf(Math.max(...spectrum.magnitudes));
        const peakFreq = spectrum.frequencies[peakIdx];

        this.peakFrequencyDisplay.textContent = `Peak frequency: ${peakFreq} Hz`;
    }
}

const spectrogramVisualizer = new SpectrogramVisualizer();
spectrogramVisualizer.init();
