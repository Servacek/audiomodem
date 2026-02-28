/**
 * mic_status_dot.js
 *
 * Drives the small coloured dot next to the "AudioModem" title.
 *
 * States
 * ──────
 *  idle      – mic not yet requested (grey, no animation)
 *  waiting   – mic acquired but AudioContext suspended, needs a gesture (amber pulse)
 *  listening – mic + AudioContext running, but silence (grey/dim, no animation)
 *  active    – mic running AND audio above threshold detected (green pulse)
 *  blocked   – permission denied or any hard error (red, no animation)
 *
 * Events consumed (all on `window`)
 * ──────────────────────────────────
 *  microphone-waiting-for-gesture  → waiting
 *  microphone-started              → listening
 *  audioprocess                    → active while audio flows, back to listening on silence
 *  wasm-library-failed             → blocked  (can't even start)
 *  mic-blocked                     → blocked  (dispatched below on NotAllowedError etc.)
 *
 * The `audioprocess` event is expected to carry `event.detail.inputBuffer`
 * (an AudioBuffer), matching what chat.js already dispatches.
 */

const dot = document.getElementById("mic-status-dot");

// How long after the last loud sample before we drop back to "listening"
const SILENCE_TIMEOUT_MS = 800;
// RMS threshold to count as "receiving audio"
const AUDIO_THRESHOLD = 0.004;

let silenceTimer = null;

function setState(state) {
    if (!dot) return;
    // Strip all state classes then apply the new one
    dot.className = `mic-status-dot mic-status--${state}`;

    const labels = {
        idle:      "Mikrofón: čaká...",
        waiting:   "Mikrofón: kliknite kdekoľvek pre aktiváciu",
        listening: "Mikrofón: aktívny, ticho",
        active:    "Mikrofón: prijíma audio",
        blocked:   "Mikrofón: prístup zamietnutý alebo chyba",
    };
    dot.title = labels[state] ?? "";
}

// ── Event wiring ─────────────────────────────────────────────────────────────

window.addEventListener("microphone-waiting-for-gesture", () => {
    setState("waiting");
});

window.addEventListener("microphone-started", () => {
    setState("listening");
});

// Dispatched by chat.js on every ScriptProcessorNode callback
window.addEventListener("audioprocess", (event) => {
    const inputBuffer = event.detail?.inputBuffer;
    if (!inputBuffer) return;

    const data = inputBuffer.getChannelData(0);

    // Compute RMS over the buffer
    let sumSq = 0;
    for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
    const rms = Math.sqrt(sumSq / data.length);

    if (rms > AUDIO_THRESHOLD) {
        // Audio detected — go active and (re)set the silence timer
        setState("active");
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => setState("listening"), SILENCE_TIMEOUT_MS);
    }
    // If rms ≤ threshold we leave the current state alone; the timer handles
    // the transition back to "listening" after SILENCE_TIMEOUT_MS of quiet.
});

// chat.js / tinytus.js surface errors by returning them; chat.js then shows a
// system message.  We also need the dot to turn red.  The simplest contract is
// to have chat.js dispatch "mic-blocked" on hard errors so this module stays
// decoupled.  Alternatively, we listen for the wasm-library-failed event too.
window.addEventListener("mic-blocked", () => setState("blocked"));
window.addEventListener("wasm-library-failed", () => setState("blocked"));

// Export a helper so chat.js can call setMicStatus("blocked") directly
// without creating a custom event, if preferred.
export function setMicStatus(state) {
    setState(state);
}
