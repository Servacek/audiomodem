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

// Generate waveform using pure JavaScript
function generateWaveform(frequency, amplitude, phase, samples) {
    const waveform = new Float32Array(samples);
    const angularFrequency = 2 * Math.PI * frequency;

    for (let i = 0; i < samples; i++) {
        const time = i / SAMPLING_RATE;
        waveform[i] = amplitude * Math.sin(angularFrequency * time + phase);
    }

    return waveform;
}

// Initialize or resume audio context
function ensureAudioContext() {
    if (!audioContext) {
        audioContext = new AudioContext();
    }

    // Resume context if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    return audioContext;
}

// Stop current audio playback
function stopAudio() {
    if (oscillatorNode) {
        try {
            oscillatorNode.stop();
            oscillatorNode.disconnect();
        } catch (e) {
            // Already stopped
        }
        oscillatorNode = null;
    }

    if (gainNode) {
        gainNode.disconnect();
        gainNode = null;
    }
}

// Start audio playback using Web Audio oscillator
function startAudio() {
    stopAudio();

    const ctx = ensureAudioContext();
    const { frequency, amplitude, phase } = state;

    // Create oscillator and gain nodes
    oscillatorNode = ctx.createOscillator();
    gainNode = ctx.createGain();

    oscillatorNode.type = 'sine';
    oscillatorNode.frequency.setValueAtTime(frequency, ctx.currentTime);

    // Set phase by using a delay (phase shift in time domain)
    const phaseDelay = phase / (2 * Math.PI * frequency);

    gainNode.gain.setValueAtTime(amplitude, ctx.currentTime);

    oscillatorNode.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillatorNode.start(ctx.currentTime + phaseDelay);
}

// Update audio parameters smoothly without stopping
function updateAudioParams() {
    if (!oscillatorNode || !state.isPlaying) return;

    const ctx = audioContext;
    const { frequency, amplitude } = state;
    const now = ctx.currentTime;
    const rampTime = 0.01; // 10ms ramp to avoid clicks

    // Smoothly ramp to new values
    oscillatorNode.frequency.setTargetAtTime(frequency, now, rampTime);
    gainNode.gain.setTargetAtTime(amplitude, now, rampTime);
}

// Update waveform visualization
function updateWaveformDisplay() {
    const { frequency, amplitude, phase, animationPhase } = state;
    const period = 1 / frequency;
    const samples = SAMPLING_RATE;

    // Use animated phase for display
    const displayPhase = phase + animationPhase;
    const waveform = generateWaveform(frequency, amplitude, displayPhase, samples);

    // Show 2-3 periods for better visualization
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

// Animation loop for smooth waveform movement
function animate() {
    // Increment phase proportional to frequency for realistic wave motion
    state.animationPhase += 0.05 * (state.frequency / 440);

    updateWaveformDisplay();

    animationFrameId = requestAnimationFrame(animate);
}

// Start animation
function startAnimation() {
    if (!animationFrameId) {
        animate();
    }
}

// Stop animation
function stopAnimation() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

// Update waveform parameters
function updateWaveform() {
    // Update display
    updateWaveformDisplay();

    // Update audio if playing (smoothly without restarting)
    if (state.isPlaying) {
        updateAudioParams();
    }
}

// Update slider values
function updateFromSliders() {
    state.frequency = parseFloat(frequencySlider.value);
    state.amplitude = parseFloat(amplitudeSlider.value) / 100;
    state.phase = parseFloat(phaseSlider.value) * Math.PI / 180;

    updateWaveform();
}

// Setup slider event listeners
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

// Toggle play/pause state
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
        // Keep the current animation phase to maintain position
        updateWaveformDisplay();
    }
}

// Initialize
function init() {
    // Setup all sliders
    const sliders = document.querySelectorAll(".oscillator-slider");
    sliders.forEach(setupSlider);

    // Setup play button
    if (playButton) {
        playButton.addEventListener("click", togglePlayback);
    }

    // Initial render
    updateFromSliders();
}

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
    stopAnimation();
    stopAudio();
    if (audioContext) {
        audioContext.close();
    }
});

// Start when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
