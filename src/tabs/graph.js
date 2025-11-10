import { plotFFT, plotFFTWaterfall, plotWaveform, drawFFT } from '../plotter.js';
import * as WASM from "../bindings.js";
import * as CONST from "../constants.js";

const TAB = document.getElementById(CONST.TAB.GRAPH);

const fftGraph = document.getElementById("fft-result-graph");
const waveformGraph = document.getElementById("input-waveform-graph");
const waterfallCheckbox = document.getElementById("waterfall-checkbox");

function onClick() {fftGraph.paused = !fftGraph.paused;}

fftGraph.addEventListener("click", onClick)
waveformGraph.addEventListener("click", onClick)


function onProcessAudioFFTChunk(e) {
    // Do only update the canvas when we are visible and running!
    if (fftGraph.paused == true || fftGraph.offsetParent == null) {
        return;
    }

    if (TAB.classList.contains("loaded") == false) {
        TAB.classList.add("loaded");
    }

    const inputBuffer = e.detail.inputBuffer;

    // Plot the input waveform we are computing the FFT from.
    plotWaveform(waveformGraph, inputBuffer);

    const fftSize = inputBuffer.length; // Should already be a power of 2.
    const startPtr = WASM.MEMORY_STACK_START;
    const realPtr = startPtr;
    const imagPtr = realPtr + fftSize*4;

    // Prepare the arrays for the FFT.
    WASM.MEMORY_F32.set(inputBuffer, realPtr>>2);
    WASM.MEMORY_F32.fill(0, imagPtr>>2, (imagPtr+fftSize*4)>>2);
    WASM.EXPORTS.fft(realPtr, imagPtr, fftSize);

    // Retrieve the computed real and imaginary numbers from memory
    const computedReal = new Float32Array(WASM.BUFFER, realPtr, fftSize)
    const computedImag = new Float32Array(WASM.BUFFER, imagPtr, fftSize)

    // console.log("Computed Real:", computedReal);
    // console.log("Computed Imaginary:", computedImag);

    // for (let i = 0; i < computedImag.length; i++) {
    //     console.log(`Computed Imaginary [${i}]:`, computedImag[i]);
    // }

    const SAMPLING_FREQUENCY = WASM.MEMORY_U32[WASM.EXPORTS.SAMPLING_FREQUENCY/4];

    const maxFreq = 5000; // Define the maximum frequency to display
    const freqBinSize = SAMPLING_FREQUENCY / fftSize; // Frequency resolution

    // Generate frequencies array and calculate magnitudes
    const frequencies = Array.from({ length: fftSize / 2 }, (_, i) => Math.round(i * freqBinSize));
    const magnitudes = computedReal.map((r, i) => Math.sqrt(r * r + computedImag[i] * computedImag[i]));

    // Filter frequencies and magnitudes for the desired range
    const filteredFrequencies = frequencies.filter((freq) => freq <= maxFreq);
    const filteredMagnitudes = magnitudes.slice(0, filteredFrequencies.length); // Match the filtered frequencies
    //const filteredMagnitudesDB = filteredMagnitudes.map((mag) => 20 * Math.log10(mag));

    // Plot the result
    // plotFFT(fft_graph, filteredFrequencies, filteredMagnitudes);
    if (waterfallCheckbox.checked) {
        plotFFTWaterfall(fftGraph, filteredFrequencies, filteredMagnitudes);
    } else {
        drawFFT(fftGraph, filteredFrequencies, filteredMagnitudes);
    }

    const peakMagnitudeIndex = filteredMagnitudes.indexOf(Math.max(...filteredMagnitudes));
    const peakFrequency = filteredFrequencies[peakMagnitudeIndex];
    const peakFrequencySpan = document.getElementById("peak-frequency");
    peakFrequencySpan.textContent = `Peak frequency: ${peakFrequency} Hz`;

    //console.log(getPeakFrequency(normalizedBuffer));

    // if (res && res.length > 0) {
    //     res = new TextDecoder("utf-8").decode(res);
    //     rxData.value = res;
    // }
}

window.addEventListener("audioprocess", onProcessAudioFFTChunk);
