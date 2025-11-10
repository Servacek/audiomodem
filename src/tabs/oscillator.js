
import * as WASM from "../bindings.js";
import { plotWaveform } from "../plotter.js";


const oscillatorWaveform = document.getElementById("oscillator-waveform");

const frequencySlider = document.getElementById("frequency-slider");
const amplitudeSlider = document.getElementById("amplitude-slider");
const phaseSlider     = document.getElementById("phase-slider");


// So we can have up to 20000 Hz
const SAMPLING_RATE = 48000;


let f, a, p;
let waveform = null;


let audioContext = null, bufferSource = null;
function onWaveformUpdated() {
    if (!audioContext) {
        audioContext = new AudioContext();
    }

    if (bufferSource) {
        bufferSource.stop();
        bufferSource.disconnect();
    }

    bufferSource = audioContext.createBufferSource();
    // The sampling rate has to be at least 8000
    const buffer = audioContext.createBuffer(1, waveform.length, SAMPLING_RATE);
    buffer.getChannelData(0).set(waveform);
    bufferSource.buffer = buffer;
    bufferSource.loop = true;
    bufferSource.connect(audioContext.destination);
    bufferSource.start();
}

function onWaveformParamsChanged(frequency, amplitude, phase) {
    f = frequency === null ? f : frequency;
    a = amplitude === null ? a : amplitude;
    p = phase === null ? p : phase;

    const period = 1 / f;
    const samples = SAMPLING_RATE;
    const additionalSamples = 100;

    WASM.EXPORTS.waveform(f, a, p, samples, WASM.OUTPUT_BUFFER_PTR);
    const new_waveform = WASM.getOutputBuffer(samples);
    // const new_waveform = new Float32Array(samples);
    // for (let i = 0; i < new_waveform.length; i++) {
    //     new_waveform[i] = a * Math.sin(2 * Math.PI * f * i / SAMPLING_RATE + p);
    // }
    waveform = new_waveform;
    // plotWaveform(oscillatorWaveform, new_waveform.slice(0, Math.round(period * SAMPLING_RATE) + additionalSamples), f)

    if (bufferSource) {
        onWaveformUpdated();
    }
}

function onSlidersUpdated() {
    onWaveformParamsChanged(frequencySlider.value, amplitudeSlider.value / 100, phaseSlider.value * Math.PI / 180)
}

for (const slider of document.getElementsByClassName("oscillator-slider")) {
    const display = document.getElementById(slider.id + "-display");
    slider.addEventListener("input", () => {
        display.textContent = slider.value;
        display.value = slider.value;
        onSlidersUpdated();
    })
    display.addEventListener("input", () => {
        const value = parseFloat(display.value);
        if (value < slider.min || value > slider.max) {
            display.value = slider.value;
            return;
        }
        slider.value = value;
        onSlidersUpdated();
    })
}

function onPlayingStateChanged(playing) {
    playButton.icon.className = playing ? "fas fa-pause-circle" : "fas fa-play-circle";
}

const playButton = document.getElementById("play-oscillator-button");
playButton.icon = playButton.getElementsByTagName("i")[0];
playButton.addEventListener("click", () => {
    if (!waveform) {
        onPlayingStateChanged(false);
        return;
    }

    if (bufferSource) {
        onPlayingStateChanged(false);
        bufferSource.stop();
        bufferSource.disconnect();
        bufferSource = null;
        return;
    }

    onPlayingStateChanged(true);
    onWaveformUpdated();
})


WASM.requiresLoadedWASM(() => {
    onSlidersUpdated()
})
