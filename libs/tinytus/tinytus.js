/*
 * Sluzi ako most medzi JavaScriptom a WebAssembly buildom TinyTUS kniznice.
 * Reimplementovava navyssiu vrstvu API kniznice vo Web JavaScript s vyuzitim
 * webovych API pre audio vstup/vystup.
*/


// KNOWN ERRORS:
// LinkError: _assert_fail is not a Function
//      - probably caused by -s LINKABLE=1
// wasmExports.<function> is not a function
//      - Missing EMSCRIPTEN_KEEPALIVE macros above C functions.

// Predvolena trasa
let LIBRARY_PATH = "./libs/tinytus/tinytus.wasm";

import { ModemProfile } from "./modem_profile.js";

// MEMORY:
// - Max message length is 512 characters, each one of them can have 4 bytes
//   that means we need to allocate at least 2048 bytes of memory for the input.
// Looks like constants in the memory are stored from 1024.

let EXPORTS = null;
let _LOADED = false;

const TYPE_TO_ARRAY = {
    "i16": Int16Array,
    "i32": Int32Array,
    "f64": Float64Array,
    "i8": Int8Array,
    "u8": Uint8Array,
    "u16": Uint16Array,
    "u32": Uint32Array,
    "f32": Float32Array,
};

///////////////////////////////////////

export function fillInputBuffer(byteArray) {
    TinyTUS.MEMORY.set(byteArray, TinyTUS.INPUT_BUFFER_PTR);
}

export function fillInputBufferWithFloat32(floatArray) {
    TinyTUS.MEMORY_F32.set(floatArray, TinyTUS.INPUT_BUFFER_PTR / 4);
}

export function isWASMLoaded() {
    return _LOADED;
}

export function requiresLoadedWASM(block) {
    if (_LOADED === true) {
        block();
    } else {
        window.addEventListener("wasm-library-loaded", block);
    }
}

////////////////////////////////////
// Privatne funkcie

async function _init(path) {
    const response = await fetch(path);

    const env = {
        _emscripten_memcpy_js: (dest, src, num) => TinyTUS.MEMORY.copyWithin(dest, src, src + num),
        emscripten_notify_memory_growth: (_index) => {
            TinyTUS.BUFFER = EXPORTS.memory.buffer;
            TinyTUS.MEMORY = new Uint8Array(EXPORTS.memory.buffer);
            TinyTUS.MEMORY_U16 = new Uint16Array(EXPORTS.memory.buffer);
            TinyTUS.MEMORY_U32 = new Uint32Array(EXPORTS.memory.buffer);
            TinyTUS.MEMORY_F32 = new Float32Array(EXPORTS.memory.buffer);
        },
    };

    for (let funcName in TinyTUS.MAPPINGS) {
        env[funcName] = TinyTUS.MAPPINGS[funcName];
    }

    const { instance } = await WebAssembly.instantiateStreaming(response, {
        env,
        wasi_snapshot_preview1: {
            fd_write: (fd, iov, iovcnt, pnum) => {
                let num = 0;
                let s = "";
                for (let i = 0; i < iovcnt; i++) {
                    const ptr = TinyTUS.MEMORY_U32[((iov) >> 2)];
                    const len = TinyTUS.MEMORY_U32[(((iov) + 4) >> 2)];
                    iov += 8;
                    for (let j = 0; j < len; j++) {
                        s += String.fromCharCode(TinyTUS.MEMORY[ptr + j]);
                    }
                    num += len;
                }
                TinyTUS.MEMORY_U32[((pnum) >> 2)] = num;
                if (fd === 1) {
                    if (s.startsWith("[TINYTUS][ERROR]")) console.error(s);
                    else if (s.startsWith("[TINYTUS][WARN]")) console.warn(s);
                    else console.log(s);
                } else if (fd === 2) {
                    console.error(s);
                } else {
                    console.warn(`Unknown file descriptor ${fd} in fd_write, message: ${s}`);
                }
                return 0;
            },
            fd_close: () => 0,
            fd_seek: () => 0,
            fd_read: () => 0,
            proc_exit: () => { },
            environ_sizes_get: () => 0,
            environ_get: () => 0,
        },
    });

    EXPORTS = instance.exports;
    TinyTUS.EXPORTS = EXPORTS;

    TinyTUS.BUFFER = EXPORTS.memory.buffer;
    TinyTUS.MEMORY = new Uint8Array(EXPORTS.memory.buffer);
    TinyTUS.MEMORY_U16 = new Uint16Array(EXPORTS.memory.buffer);
    TinyTUS.MEMORY_U32 = new Uint32Array(EXPORTS.memory.buffer);
    TinyTUS.MEMORY_F32 = new Float32Array(EXPORTS.memory.buffer);

    const INPUT_BUFFER_SIZE = 1024 * 4;
    const OUTPUT_BUFFER_SIZE = 1024 * 4;

    TinyTUS.INPUT_BUFFER_PTR = EXPORTS.malloc(INPUT_BUFFER_SIZE);
    TinyTUS.OUTPUT_BUFFER_PTR = EXPORTS.malloc(OUTPUT_BUFFER_SIZE);
    TinyTUS.OUT_LEN_PTR = EXPORTS.malloc(4);

    if (!TinyTUS.OUT_LEN_PTR || !TinyTUS.INPUT_BUFFER_PTR || !TinyTUS.OUTPUT_BUFFER_PTR) {
        throw new Error("Failed to allocate WASM I/O buffers");
    }

    TinyTUS.CONSTS = {};
    for (let exportName in EXPORTS) {
        if (EXPORTS[exportName] instanceof WebAssembly.Global) {
            const ptr = EXPORTS[exportName].value;
            const type = exportName.split("_")[0].toLowerCase();
            if (!TYPE_TO_ARRAY.hasOwnProperty(type)) {
                console.warn(`Skipping export ${exportName} with unsupported type prefix "${type}"`);
                continue;
            }
            TinyTUS.CONSTS[exportName] = TinyTUS.getValueFromPointer(type, ptr);
        }
    }
}

function _load(path = LIBRARY_PATH) {
    console.log("Loading tinytus library from path:", path);
    _init(path).then(() => {
        _LOADED = true;
        console.info("Successfully initialized WASM!");
        TinyTUS.onLoaded();
        window.dispatchEvent(new CustomEvent("wasm-library-loaded"));
    }).catch((error) => {
        _LOADED = false;
        console.error("Failed to initialize WASM:", error);
        window.dispatchEvent(new CustomEvent("wasm-library-failed"));
    });
}

function _modemProfileOrPtrToPtr(modem_profile_or_ptr) {
    if (modem_profile_or_ptr instanceof ModemProfile) {
        return modem_profile_or_ptr.ptr;
    }
    return modem_profile_or_ptr;
}

////////////////////////////////////
// Audio state

let currentStream = null;
let currentContext = null;
let currentRecorder = null;
let currentDemodState = null;

// Cleans up all audio resources. Returns a Promise that resolves when the
// AudioContext is fully closed so callers can await proper teardown.
async function _stopListeningAsync() {
    // Stop mic tracks first so the browser indicator light turns off promptly
    if (currentStream) {
        try { currentStream.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ }
        currentStream = null;
    }

    if (currentRecorder) {
        try {
            currentRecorder.onaudioprocess = null;
            currentRecorder.disconnect();
        } catch (e) { /* ignore */ }
        currentRecorder = null;
    }

    if (currentContext) {
        try {
            if (currentContext.state !== "closed") {
                await currentContext.close();
            }
        } catch (e) { /* ignore */ }
        currentContext = null;
    }

    if (currentDemodState !== null && currentDemodState !== 0) {
        try { TinyTUS.EXPORTS.gfsk_demod_destroy(currentDemodState); } catch (e) { /* ignore */ }
        currentDemodState = null;
    }
}

////////////////////////////////////
// Exporty

export let TinyTUS = {
    MAPPINGS: {
        play_waveform: (modem_profile_ptr, ptr, length, sample_rate) => 0,
        on_byte_received: (byte) => 0,
        on_frame_received: (ptr, length) => 0,
        on_bytes_received: (ptr, length) => 0,
    },
    EXPORTS: {},
    afterLoad: requiresLoadedWASM,
    loadLibrary: _load,

    getValueFromPointer(type, ptr) {
        if (!TYPE_TO_ARRAY.hasOwnProperty(type))
            throw new Error(`Invalid type "${type}". Must be one of: ${Object.keys(TYPE_TO_ARRAY).join(", ")}`);
        if (typeof ptr !== "number" || !Number.isInteger(ptr) || ptr < 0)
            throw new TypeError(`Pointer must be a non-negative integer, got ${ptr}`);

        const bytesPerElement = TYPE_TO_ARRAY[type].BYTES_PER_ELEMENT;
        if (ptr % bytesPerElement !== 0)
            console.warn(`Pointer ${ptr} is not aligned for ${type} (requires ${bytesPerElement}-byte alignment)`);

        return new TYPE_TO_ARRAY[type](EXPORTS.memory.buffer, ptr, 1)[0];
    },

    getDynamicBufferFromPointer(type, ptr, length) {
        if (!TYPE_TO_ARRAY.hasOwnProperty(type))
            throw new Error(`Invalid type "${type}". Must be one of: ${Object.keys(TYPE_TO_ARRAY).join(", ")}`);
        if (typeof ptr !== "number" || !Number.isInteger(ptr) || ptr < 0)
            throw new RangeError(`Pointer must be a non-negative integer, got ${ptr}`);
        if (typeof length !== "number" || !Number.isInteger(length) || length < 0)
            throw new RangeError(`Length must be a non-negative integer, got ${length}`);

        const typedArray = new TYPE_TO_ARRAY[type](EXPORTS.memory.buffer, ptr, length);
        const copy = typedArray.slice();
        EXPORTS.fsk_free_wave(ptr);
        return copy;
    },

    sendMessage(modem_profile, message) {
        const modem_profile_ptr = _modemProfileOrPtrToPtr(modem_profile);
        const messageBytes = new TextEncoder().encode(message);
        fillInputBuffer(messageBytes);
        TinyTUS.EXPORTS.send_payload(modem_profile_ptr, TinyTUS.INPUT_BUFFER_PTR, messageBytes.length);
    },

    onLoaded() {
        TinyTUS.DEFAULT_MODEM_PROFILE = new ModemProfile();
        TinyTUS.DEFAULT_MODEM_PROFILE.readonly = true;
        Object.freeze(TinyTUS.DEFAULT_MODEM_PROFILE);
        TinyTUS.registerProfile(TinyTUS.DEFAULT_MODEM_PROFILE);
        this.currentlyUsedModemProfile = TinyTUS.DEFAULT_MODEM_PROFILE;
    },

    /** @param {ModemProfile} profile */
    registerProfile(profile) {
        TinyTUS.MODEM_PROFILES[profile.ptr] = profile;
        return profile;
    },

    /** @returns {ModemProfile} */
    getModemProfileFromPointer(ptr) {
        return TinyTUS.MODEM_PROFILES[ptr];
    },

    /**
     * Modulate a message into a waveform.
     * @param {string} message
     * @param {ModemProfile|number|null} modem_profile
     * @returns {Float32Array}
     */
    modulateMessage(message, modem_profile = null) {
        modem_profile = modem_profile || TinyTUS.DEFAULT_MODEM_PROFILE;
        const messageBytes = new TextEncoder().encode(message);
        fillInputBuffer(messageBytes);

        const outLenPtr = TinyTUS.OUT_LEN_PTR;
        const modulatedPtr = TinyTUS.EXPORTS.modulate_payload(
            _modemProfileOrPtrToPtr(modem_profile),
            TinyTUS.INPUT_BUFFER_PTR,
            messageBytes.length,
            outLenPtr,
        );

        return TinyTUS.getDynamicBufferFromPointer(
            "f32", modulatedPtr, TinyTUS.getValueFromPointer("i32", outLenPtr)
        );
    },

    // Public sync wrapper kept for callers that don't need to await cleanup.
    stopListening() {
        _stopListeningAsync().catch(e => console.warn("stopListening error:", e));
    },

    // -------------------------------------------------------------------------
    // Microphone initialisation
    // -------------------------------------------------------------------------

    /** True while an initialisation attempt is in flight. */
    _initializationInProgress: false,

    /**
     * Start microphone capture and hook it into the GFSK demodulator.
     *
     * Returns null on success, or an Error instance on failure.
     * Never throws — all errors are returned so callers can react uniformly.
     *
     * Design notes vs. the previous implementation:
     *  - The queue/retry mechanism has been removed.  It masked failures and
     *    could loop forever.  Callers must debounce themselves if needed.
     *  - getUserMedia is called only once.  Retrying a denied permission in a
     *    tight loop can cause browsers to permanently block the origin.
     *  - AudioContext autoplay policy is handled explicitly: if the context
     *    cannot be resumed without a user gesture the function returns a
     *    recoverable error instead of silently dying after a 1500 ms watchdog.
     *  - stopListening is awaited so previous resources are truly released
     *    before new ones are acquired.
     */
    tryStartListeningForIncomingMessages: async (modemProfile, onAudioProcess = null) => {
        console.group("[TinyTUS] tryStartListeningForIncomingMessages()");
        console.log("  modemProfile:", modemProfile);
        console.log("  _initializationInProgress:", TinyTUS._initializationInProgress);
        console.log("  navigator.mediaDevices:", navigator.mediaDevices);

        if (TinyTUS._initializationInProgress) {
            console.warn("  ⛔ Already in progress — returning null.");
            console.groupEnd();
            return null;
        }
        TinyTUS._initializationInProgress = true;

        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                console.error("  ⛔ navigator.mediaDevices.getUserMedia not available.");
                console.groupEnd();
                return new Error("Neboli detekované žiadne mediálne zariadenia...");
            }

            console.log("  → Stopping any previous session...");
            await _stopListeningAsync();
            console.log("  ✅ Previous session stopped.");

            const modemProfilePtr = _modemProfileOrPtrToPtr(modemProfile);
            console.log("  → Creating GFSK demodulator. modemProfilePtr:", modemProfilePtr);
            currentDemodState = TinyTUS.EXPORTS.gfsk_demod_create(modemProfilePtr, 256);
            console.log("  currentDemodState:", currentDemodState);
            if (!currentDemodState) {
                console.error("  ⛔ gfsk_demod_create returned null/0.");
                console.groupEnd();
                return new Error("Failed to create GFSK demodulator state.");
            }
            console.log("  ✅ GFSK demodulator created.");

            console.log("  → Calling getUserMedia...");
            try {
                currentStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        channelCount: 1,
                        sampleRate: modemProfile.sampleRate,
                        latency: 0,
                    },
                    video: false,
                });
                console.log("  ✅ getUserMedia succeeded. Stream:", currentStream);
            } catch (e) {
                console.error("  ⛔ getUserMedia failed:", e.name, e.message);
                try { TinyTUS.EXPORTS.gfsk_demod_destroy(currentDemodState); } catch (_) { }
                currentDemodState = null;
                console.groupEnd();
                return e;
            }

            const audioTracks = currentStream.getAudioTracks();
            console.log("  Audio tracks:", audioTracks.length, audioTracks[0]?.label, "state:", audioTracks[0]?.readyState);
            if (!audioTracks.length) {
                console.groupEnd();
                return new Error("No audio tracks in stream.");
            }
            if (audioTracks[0].readyState !== "live") {
                console.groupEnd();
                return new Error(`Track not ready: ${audioTracks[0].readyState}`);
            }

            console.log("  → Creating AudioContext. sampleRate:", modemProfile.sampleRate);
            currentContext = new AudioContext({ sampleRate: modemProfile.sampleRate, latencyHint: "interactive" });
            console.log("  AudioContext state after creation:", currentContext.state);

            if (currentContext.state === "suspended") {
                console.warn("  AudioContext suspended — attempting resume...");
                try { await currentContext.resume(); } catch (_) { }
                console.log("  AudioContext state after resume attempt:", currentContext.state);
            }

            if (currentContext.state === "running") {
                console.log("  ✅ AudioContext running — connecting audio graph immediately.");
                _connectAudioGraph(onAudioProcess, modemProfile.samples_per_symbol);
                console.log("  ✅ Fully initialised.");
                console.groupEnd();
                return null;
            }

            // Suspended — defer to gesture
            console.warn("  ⚠️ AudioContext still not running (state:", currentContext.state, ") — closing and deferring to gesture.");
            await currentContext.close();
            currentContext = null;

            window.dispatchEvent(new CustomEvent("microphone-waiting-for-gesture"));

            const GESTURE_EVENTS = ["click", "keydown", "touchstart", "pointerdown"];
            const removeListeners = () =>
                GESTURE_EVENTS.forEach(ev => document.removeEventListener(ev, handler, true));

            const handler = async () => {
                removeListeners();
                console.group("[TinyTUS] Gesture detected — starting AudioContext");
                console.log("  currentStream alive:", !!currentStream);
                console.log("  currentDemodState:", currentDemodState);

                if (!currentStream || !currentDemodState) {
                    console.warn("  ⛔ Stream or demod gone before gesture fired.");
                    console.groupEnd();
                    return;
                }
                try {
                    console.log("  → Creating fresh AudioContext inside gesture handler...");
                    currentContext = new AudioContext({
                        sampleRate: modemProfile.sampleRate,
                        latencyHint: "interactive",
                    });
                    await new Promise(r => setTimeout(r, 0));
                    console.log("  AudioContext state:", currentContext.state);

                    if (currentContext.state === "suspended") {
                        console.log("  → Calling resume()...");
                        await currentContext.resume();
                        console.log("  AudioContext state after resume:", currentContext.state);
                    }

                    if (currentContext.state !== "running") {
                        throw new Error(`AudioContext still not running: ${currentContext.state}`);
                    }

                    console.log("  ✅ Connecting audio graph.");
                    _connectAudioGraph(onAudioProcess, modemProfile.samples_per_symbol);
                    console.groupEnd();
                } catch (e) {
                    console.error("  ⛔ Failed to start AudioContext on gesture:", e);
                    await _stopListeningAsync();
                    window.dispatchEvent(new CustomEvent("mic-blocked"));
                    console.groupEnd();
                }
            };

            GESTURE_EVENTS.forEach(ev => document.addEventListener(ev, handler, { once: true, capture: true }));
            console.log("  ⏳ Waiting for user gesture...");
            console.groupEnd();
            return null;

        } catch (e) {
            console.error("  ⛔ Unexpected error:", e);
            await _stopListeningAsync();
            console.groupEnd();
            return e;
        } finally {
            TinyTUS._initializationInProgress = false;
            console.log("[TinyTUS] _initializationInProgress reset to false.");
        }
    },
    isLibraryLoaded() {
        return _LOADED;
    },

    MODEM_PROFILES: {},
    MODEM_PROFILES_REVERSED: {},
    currentlyUsedModemProfile: null,
};

window.addEventListener("beforeunload", () => {
    // Synchronously stop all tracks so Chrome releases the hardware
    // before the new page starts. _stopListeningAsync is too slow here.
    if (currentStream) {
        try { currentStream.getTracks().forEach(t => t.stop()); } catch (_) { }
    }
    if (currentContext) {
        try { currentContext.close(); } catch (_) { }
    }
    if (currentDemodState) {
        try { TinyTUS.EXPORTS.gfsk_demod_destroy(currentDemodState); } catch (_) { }
        currentDemodState = null;
    }
});

/**
 * Wire up the ScriptProcessorNode between the mic stream and the WASM demod.
 * Called once the AudioContext is confirmed running.
 */
async function _connectAudioGraph(onAudioProcess, bufferSize = 1024) {
    if (!currentContext || !currentStream || !currentDemodState) {
        console.error("[TinyTUS] _connectAudioGraph called with missing state — aborting.");
        return;
    }

    if (currentRecorder) {
        try { currentRecorder.disconnect(); } catch (_) { }
        currentRecorder = null;
    }

    await currentContext.audioWorklet.addModule("./libs/tinytus/tinytus-processor.js");

    const mediaStreamSource = currentContext.createMediaStreamSource(currentStream);
    currentRecorder = new AudioWorkletNode(currentContext, "tinytus-processor");

    // Accumulation buffer — collects 128-sample chunks until we have bufferSize
    let accumulator = new Float32Array(bufferSize);
    let accumulatorFill = 0;

    currentRecorder.port.onmessage = (event) => {
        if (!currentDemodState) return;

        const chunk = event.data; // always 128 samples
        let chunkOffset = 0;

        while (chunkOffset < chunk.length) {
            const space = bufferSize - accumulatorFill;
            const toCopy = Math.min(space, chunk.length - chunkOffset);
            accumulator.set(chunk.subarray(chunkOffset, chunkOffset + toCopy), accumulatorFill);
            accumulatorFill += toCopy;
            chunkOffset += toCopy;

            if (accumulatorFill === bufferSize) {
                // Full buffer ready — send to WASM
                fillInputBufferWithFloat32(accumulator);
                TinyTUS.EXPORTS.handle_input_samples(
                    currentDemodState,
                    TinyTUS.INPUT_BUFFER_PTR,
                    bufferSize,
                );

                if (onAudioProcess) {
                    const snapshot = accumulator.slice(); // copy for caller
                    onAudioProcess({ inputBuffer: { getChannelData: () => snapshot } });
                }

                accumulatorFill = 0;
                // reuse same buffer — no allocation on hot path
            }
        }
    };

    mediaStreamSource.connect(currentRecorder);
    currentRecorder.connect(currentContext.destination);

    window.dispatchEvent(new CustomEvent("microphone-started"));
    console.log(`[TinyTUS] Audio graph connected via AudioWorkletNode. Accumulating 128-sample chunks into ${bufferSize}-sample buffers.`);
}
