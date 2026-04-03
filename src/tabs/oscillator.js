import { plotWaveform } from "../plotter.js";

const oscillatorWaveform = document.getElementById("oscillator-waveform");
const frequencySlider = document.getElementById("frequency-slider");
const amplitudeSlider = document.getElementById("amplitude-slider");
const phaseSlider = document.getElementById("phase-slider");
const playButton = document.getElementById("play-oscillator-button");

const SAMPLING_RATE = 48000;
const MIN_SAMPLE_RATE = 8000;

let state = {
    frequency: 440,
    amplitude: 0.5,
    phase: 0,
    isPlaying: false,
    animationPhase: 0
};

let audioContext = null;
let oscillatorNode = null;
let gainNode = null;
let animationFrameId = null;

// Generuj waveform v cistom JavaScripte.
function generateWaveform(frequency, amplitude, phase, samples) {
    const waveform = new Float32Array(samples);
    const angularFrequency = 2 * Math.PI * frequency;

    for (let i = 0; i < samples; i++) {
        const time = i / SAMPLING_RATE;
        waveform[i] = amplitude * Math.sin(angularFrequency * time + phase);
    }

    return waveform;
}

// Inicializuj alebo obnov audio context.
function ensureAudioContext() {
    if (!audioContext) {
        audioContext = new AudioContext();
    }

    // Pri suspended stave obnov context.
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    return audioContext;
}

// Zastav aktualne prehravanie.
function stopAudio() {
    if (oscillatorNode) {
        try {
            oscillatorNode.stop();
            oscillatorNode.disconnect();
        } catch (e) {
            // Uz zastavene.
        }
        oscillatorNode = null;
    }

    if (gainNode) {
        gainNode.disconnect();
        gainNode = null;
    }
}

// Spusti prehravanie cez Web Audio oscillator.
function startAudio() {
    stopAudio();

    const ctx = ensureAudioContext();
    const { frequency, amplitude, phase } = state;

    // Vytvor oscillator a gain node.
    oscillatorNode = ctx.createOscillator();
    gainNode = ctx.createGain();

    oscillatorNode.type = 'sine';
    oscillatorNode.frequency.setValueAtTime(frequency, ctx.currentTime);

    // Fazu nastav cez casove oneskorenie.
    const phaseDelay = phase / (2 * Math.PI * frequency);

    gainNode.gain.setValueAtTime(amplitude, ctx.currentTime);

    oscillatorNode.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillatorNode.start(ctx.currentTime + phaseDelay);
}

// Plynulo aktualizuj audio parametre bez zastavenia.
function updateAudioParams() {
    if (!oscillatorNode || !state.isPlaying) return;

    const ctx = audioContext;
    const { frequency, amplitude } = state;
    const now = ctx.currentTime;
    const rampTime = 0.01; // 10 ms rampa proti klikom.

    // Plynuly prechod na nove hodnoty.
    oscillatorNode.frequency.setTargetAtTime(frequency, now, rampTime);
    gainNode.gain.setTargetAtTime(amplitude, now, rampTime);
}

// Aktualizuj vykreslenie waveformu.
function updateWaveformDisplay() {
    const { frequency, amplitude, phase, animationPhase } = state;
    const period = 1 / frequency;
    const samples = SAMPLING_RATE;

    // Pri vykresleni pouzi animovanu fazu.
    const displayPhase = phase + animationPhase;
    const waveform = generateWaveform(frequency, amplitude, displayPhase, samples);

    // Zobraz 2-3 periody pre lepsiu citatelnost.
    const samplesToPlot = Math.min(
        Math.round(period * SAMPLING_RATE * 3) + 100,
        samples
    );

    plotWaveform(
        oscillatorWaveform,
        waveform.slice(0, samplesToPlot),
        frequency
    );
}

// Animacna slucka plynuleho pohybu waveformu.
function animate() {
    // Posun fazu umerne frekvencii.
    state.animationPhase += 0.05 * (state.frequency / 440);

    updateWaveformDisplay();

    animationFrameId = requestAnimationFrame(animate);
}

// Spusti animaciu.
function startAnimation() {
    if (!animationFrameId) {
        animate();
    }
}

// Zastav animaciu.
function stopAnimation() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

// Aktualizuj parametre waveformu.
function updateWaveform() {
    // Aktualizuj vykreslenie.
    updateWaveformDisplay();

    // Pri prehravani plynulo uprav audio.
    if (state.isPlaying) {
        updateAudioParams();
    }
}

// Aktualizuj hodnoty zo sliderov.
function updateFromSliders() {
    state.frequency = parseFloat(frequencySlider.value);
    state.amplitude = parseFloat(amplitudeSlider.value) / 100;
    state.phase = parseFloat(phaseSlider.value) * Math.PI / 180;

    updateWaveform();
}

// Nastav listenery sliderov.
function setupSlider(slider) {
    const display = document.getElementById(slider.id + "-display");
    if (!display) return;

    slider.addEventListener("input", () => {
        display.textContent = slider.value;
        display.value = slider.value;
        updateFromSliders();
    });

    display.addEventListener("input", () => {
        const value = parseFloat(display.value);
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);

        if (isNaN(value) || value < min || value > max) {
            display.value = slider.value;
            return;
        }

        slider.value = value;
        updateFromSliders();
    });
}

// Prepni stav play/pause.
function togglePlayback() {
    state.isPlaying = !state.isPlaying;

    const icon = playButton.querySelector("i");
    if (icon) {
        icon.className = state.isPlaying ? "fas fa-pause-circle" : "fas fa-play-circle";
    }

    if (state.isPlaying) {
        startAudio();
        startAnimation();
    } else {
        stopAudio();
        stopAnimation();
        // Zachovaj aktualnu fazu animacie.
        updateWaveformDisplay();
    }
}

// Inicializacia.
function init() {
    // Nastav vsetky slidery.
    const sliders = document.querySelectorAll(".oscillator-slider");
    sliders.forEach(setupSlider);

    // Nastav play tlacidlo.
    if (playButton) {
        playButton.addEventListener("click", togglePlayback);
    }

    // Prve vykreslenie.
    updateFromSliders();
}

// Uvolni zdroje pri opusteni stranky.
window.addEventListener("beforeunload", () => {
    stopAnimation();
    stopAudio();
    if (audioContext) {
        audioContext.close();
    }
});

// Spusti po priprave DOM.
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
