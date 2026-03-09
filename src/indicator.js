/**
 * Stavova bodka mikrofonu pri nazve AudioModem.
 * Stavy: idle, waiting, listening, active, blocked.
 * Reaguje na eventy z window: microphone-*, audioprocess, mic-blocked.
 */

const dot = document.getElementById("mic-status-dot");

// Cas po poslednej hlasnej vzorke na navrat do "listening".
const SILENCE_TIMEOUT_MS = 800;
// RMS prah pre detekciu prijmu audia.
const AUDIO_THRESHOLD = 0.004;

let silenceTimer = null;

function setState(state) {
    if (!dot) return;
    // Zmaz stare stavove classy a nastav novy stav.
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

// Eventy.

window.addEventListener("microphone-waiting-for-gesture", () => {
    setState("waiting");
});

window.addEventListener("microphone-started", () => {
    setState("listening");
});

// Event z chat.js pri kazdom callbacku audio spracovania.
window.addEventListener("audioprocess", (event) => {
    const inputBuffer = event.detail?.inputBuffer;
    if (!inputBuffer) return;

    const data = inputBuffer.getChannelData(0);

    // Vypocitaj RMS nad bufferom.
    let sumSq = 0;
    for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
    const rms = Math.sqrt(sumSq / data.length);

    if (rms > AUDIO_THRESHOLD) {
        // Pri audio signale prepni na active a obnov timer.
        setState("active");
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => setState("listening"), SILENCE_TIMEOUT_MS);
    }
    // Pri tichu stav meni az timer po SILENCE_TIMEOUT_MS.
});

// Pri tvrdej chybe ma chat.js poslat mic-blocked.
// Pocuvame aj wasm-library-failed.
window.addEventListener("mic-blocked", () => setState("blocked"));
window.addEventListener("wasm-library-failed", () => setState("blocked"));

// Pomocna funkcia pre priame nastavenie stavu z chat.js.
export function setMicStatus(state) {
    setState(state);
}
