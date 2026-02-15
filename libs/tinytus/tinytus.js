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

// export let
//     EXPORTS = null, MEMORY = null, MEMORY_F32 = null, MEMORY_U16 = null, MEMORY_U32 = null,
//     MEMORY_STACK_START = null, INPUT_BUFFER_PTR = null, OUTPUT_BUFFER_PTR = null,
//     BUFFER = null, LOADED = false, CONFIG = {};
let EXPORTS = null;
let _LOADED = false;

///////////////////////////////////////

// Fills the input memory buffer with the provided bytes from the byte array
export function fillInputBuffer(byteArray) {
    TinyTUS.MEMORY.set(byteArray, TinyTUS.INPUT_BUFFER_PTR);
}

export function fillInputBufferWithFloat32(floatArray) {
    TinyTUS.MEMORY_F32.set(floatArray, TinyTUS.INPUT_BUFFER_PTR / 4);
}

// Returns the bytearray of the output buffer
// export function getOutputBuffer(length) {
//     return new Float32Array(TINYTUS.EXPORTS.memory.buffer, TINYTUS.OUTPUT_BUFFER_PTR, length).slice();
// }

export function requiresLoadedWASM(block) {
    if (_LOADED == true) {
        block();
    } else {
        window.addEventListener("wasm-library-loaded", block);
    }
}

////////////////////////////////////
// Privatne funkcie

async function _init(path) {


    //
    /// TODO: Figure out how to change the size of the memory.
    // Increase the memory size by updating the `memory` property with a larger initial value and/or maximum value.
    // const memory = new WebAssembly.Memory({
    //     initial: 8096, // 256 pages (each page is 64KiB)
    //     maximum: 8096,  // optional, can set a limit (512 pages in this case)
    // });

    // Use instatiateStreaming instead of instantiate because it is more efficient
    // since it doesn't require converting the WASM module to ByteArray.
    const response = await fetch(path);
    // const wasmBuffer = await response.arrayBuffer();
    // const module = await WebAssembly.compile(wasmBuffer);
    // const exports = WebAssembly.Module.exports(module);
    // print(exports);
    const env = {
        _emscripten_memcpy_js: (dest, src, num) => TinyTUS.MEMORY.copyWithin(dest, src, src + num),
        emscripten_notify_memory_growth: (index) => { },
    };

    // Mapping functions
    for (let funcName in TinyTUS.MAPPINGS) {
        env[funcName] = TinyTUS.MAPPINGS[funcName];
    }

    const { instance } = await WebAssembly.instantiateStreaming(
        response,
        {
            env: env,
            // Support for printf
            wasi_snapshot_preview1: {
                fd_write: (fd, iov, iovcnt, pnum) => {
                    var num = 0;
                    let s = "";
                    for (var i = 0; i < iovcnt; i++) {
                        var ptr = TinyTUS.MEMORY_U32[((iov) >> 2)];
                        var len = TinyTUS.MEMORY_U32[(((iov) + (4)) >> 2)];
                        iov += 8;
                        for (var j = 0; j < len; j++) {
                            s += String.fromCharCode(TinyTUS.MEMORY[ptr + j]);
                        }
                        num += len;
                    }
                    TinyTUS.MEMORY_U32[((pnum) >> 2)] = num;
                    console.log(s);
                    return 0;
                },
                fd_close: () => 0,
                fd_seek: () => 0,
                fd_read: () => 0,
                proc_exit: () => {},
                environ_sizes_get: () => 0,
                environ_get: () => 0
            },
        } // Pass the memory object to the module
    );

    EXPORTS = instance.exports;
    TinyTUS.EXPORTS = EXPORTS;

    TinyTUS.BUFFER = EXPORTS.memory.buffer;
    TinyTUS.MEMORY = new Uint8Array(EXPORTS.memory.buffer);
    TinyTUS.MEMORY_U16 = new Uint16Array(EXPORTS.memory.buffer);
    TinyTUS.MEMORY_U32 = new Uint32Array(EXPORTS.memory.buffer);
    TinyTUS.MEMORY_F32 = new Float32Array(EXPORTS.memory.buffer);
    TinyTUS.MEMORY_STACK_START = TinyTUS.MEMORY.length - EXPORTS.emscripten_stack_get_free();

    TinyTUS.INPUT_BUFFER_PTR = TinyTUS.MEMORY_STACK_START + 4096;
    TinyTUS.OUTPUT_BUFFER_PTR = TinyTUS.INPUT_BUFFER_PTR + 1024;
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
// Exporty

const TYPE_TO_ARRAY = {
    "i16": Int16Array,
    "i32": Int32Array,
    "f64": Float64Array,
    "i8": Int8Array,
    "u8": Uint8Array,
    "u16": Uint16Array,
    "u32": Uint32Array,
    "f32": Float32Array,
}

let currentStream = null;
let currentContext = null;
let currentRecorder = null;
let currentDemodState = null;

export let TinyTUS = {
    MAPPINGS: {
        play_waveform: function (modem_profile_ptr, ptr, length, sample_rate) { return 0; },
        on_byte_received: function (byte) { return 0; },
        on_frame_received: function (ptr, length) { return 0; },
        on_bytes_received: function (ptr, length) { return 0; },
    },
    EXPORTS: {},
    afterLoad: requiresLoadedWASM,
    loadLibrary: _load,
    getValueFromPointer(type, ptr) {
        return TinyTUS.getReturnValue(type, ptr, 1)[0];
    },
    getReturnValue(type, ptr, length) {
        try {
            // Validate type parameter
            if (typeof type !== 'string') {
                throw new TypeError(`Type must be a string, got ${typeof type}`);
            }

            if (!TYPE_TO_ARRAY.hasOwnProperty(type)) {
                throw new Error(`Invalid type "${type}". Must be one of: ${Object.keys(TYPE_TO_ARRAY).join(', ')}`);
            }

            // Validate ptr parameter
            if (typeof ptr !== 'number' || !Number.isInteger(ptr)) {
                throw new TypeError(`Pointer must be an integer, got ${typeof ptr}`);
            }

            if (ptr < 0) {
                throw new RangeError(`Pointer must be non-negative, got ${ptr}`);
            }

            // Validate length parameter
            if (typeof length !== 'number' || !Number.isInteger(length)) {
                throw new TypeError(`Length must be an integer, got ${typeof length}`);
            }

            if (length < 0) {
                throw new RangeError(`Length must be non-negative, got ${length}`);
            }

            // Check buffer bounds
            const bytesPerElement = TYPE_TO_ARRAY[type].BYTES_PER_ELEMENT;
            const requiredBytes = length * bytesPerElement;

            if (ptr + requiredBytes > TYPE_TO_ARRAY[type].byteLength) {
                throw new RangeError(
                    `Memory access out of bounds: trying to read ${requiredBytes} bytes ` +
                    `at offset ${ptr}, but buffer size is ${buffer.byteLength}`
                );
            }

            // Check alignment
            if (ptr % bytesPerElement !== 0) {
                console.warn(
                    `Warning: Pointer ${ptr} is not properly aligned for ${type} ` +
                    `(requires ${bytesPerElement}-byte alignment)`
                );
            }

            // Create and return the typed array view
            const typedArray = new TYPE_TO_ARRAY[type](EXPORTS.memory.buffer, ptr, length);
            EXPORTS.fsk_free_wave(ptr);

            // Return a copy to prevent issues with buffer detachment
            return typedArray.slice();

        } catch (error) {
            console.error('Error in getReturnValue:', error.message);
            console.error('Parameters:', { type, ptr, length });

            // Re-throw with additional context
            throw new Error(`getReturnValue failed: ${error.message}`);
        }
    },

    sendMessage(modem_profile, message) {
        const modem_profile_ptr = _modemProfileOrPtrToPtr(modem_profile);
        console.log("PROFILE:", modem_profile_ptr);
        const messageBytes = new TextEncoder().encode(message);
        fillInputBuffer(messageBytes);

        // Riesi si pamat samostatne
        TinyTUS.EXPORTS.send_payload(
            modem_profile_ptr, TinyTUS.INPUT_BUFFER_PTR, messageBytes.length
        );
    },

    onLoaded(block) {
        // Nedovolme uzivatelovy prepisovat predvoleny profil?
        TinyTUS.DEFAULT_MODEM_PROFILE = new ModemProfile();
        TinyTUS.DEFAULT_MODEM_PROFILE.readonly = true;
        Object.freeze(TinyTUS.DEFAULT_MODEM_PROFILE);
        TinyTUS.registerProfile(TinyTUS.DEFAULT_MODEM_PROFILE);

        this.currentlyUsedModemProfile = TinyTUS.DEFAULT_MODEM_PROFILE;
    },

    /** @param {ModemProfile} */
    registerProfile(modem_profile) {
        TinyTUS.MODEM_PROFILES[modem_profile.ptr] = modem_profile;

        return modem_profile;
    },

    /** @returns {ModemProfile}  */
    getModemProfileFromPointer(modem_profile_ptr) {
        return TinyTUS.MODEM_PROFILES[modem_profile_ptr];
    },

    /**
     * Modulate a message into a waveform
     * @param {ModemProfile|number} modem_profile - ModemProfile object or pointer
     * @param {string} message - Message to modulate
     * @returns {Float32Array} The modulated waveform
     */
    modulateMessage(message, modem_profile = null) {
        modem_profile = modem_profile || TinyTUS.DEFAULT_MODEM_PROFILE;
        const messageBytes = new TextEncoder().encode(message);
        fillInputBuffer(messageBytes);

        const outLenPtr = TinyTUS.MEMORY_STACK_START + 2048;
        const modulatedPtr = TinyTUS.EXPORTS.modulate_payload(
            _modemProfileOrPtrToPtr(modem_profile),
            TinyTUS.INPUT_BUFFER_PTR,
            messageBytes.length,
            outLenPtr
        );

        return TinyTUS.getReturnValue(
            "f32", modulatedPtr, TinyTUS.getValueFromPointer("i32", outLenPtr)
        );
    },

    stopListening() {
        // Stop audio input
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
            currentStream = null;
        }

        // Disconnect and close AudioContext
        if (currentRecorder && currentContext) {
            currentRecorder.disconnect();
            currentContext.close();
            currentRecorder = null;
            currentContext = null;
        }

        // Destroy GFSK demodulator state
        if (currentDemodState !== null) {
            TinyTUS.EXPORTS.gfsk_demod_destroy(currentDemodState);
            currentDemodState = null;
        }
    },

    // TODO: Put this part handling audio here as well?
    tryStartListeningForIncomingMessages: async (modemProfile, onAudioProcess = null) => {
        if (!navigator.mediaDevices) {
            return new Error("Neboli detekované žiadne mediálne zariadenia potrebné pre príjimanie a odosielanie údajov alebo pre funkčnosť oscilátora. Možno pomôže opätovne načítať stránku.")
        }

        // Stop any previous listening session
        TinyTUS.stopListening();

        // Create new demodulator
        const modemProfilePtr = _modemProfileOrPtrToPtr(modemProfile);
        currentDemodState = TinyTUS.EXPORTS.gfsk_demod_create(modemProfilePtr, 256);
        if (currentDemodState === -1) {
            throw new Error("Failed to create GFSK demodulator state.");
        }

        try {
            currentStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    googEchoCancellation: false,
                    googNoiseSuppression: false,
                    googAutoGainControl: false,
                },
                video: false,
            });

            currentContext = new AudioContext({
                latencyHint: "balanced",
                sampleRate: 48000,
            });

            const mediaStreamSource = currentContext.createMediaStreamSource(currentStream);
            const bufferSize = 1024;
            currentRecorder = currentContext.createScriptProcessor(bufferSize, 1, 1);

            currentRecorder.onaudioprocess = function (event) {
                const input = event.inputBuffer.getChannelData(0);
                fillInputBufferWithFloat32(input);

                TinyTUS.EXPORTS.handle_input_samples(
                    currentDemodState,
                    TinyTUS.INPUT_BUFFER_PTR,
                    input.length
                );

                if (onAudioProcess) {
                    onAudioProcess(event);
                }
            };

            mediaStreamSource.connect(currentRecorder);
            currentRecorder.connect(currentContext.destination);

            return null;
        } catch (e) {
            TinyTUS.stopListening(); // Clean up on failure
            return e;
        }
    },

    // This is a map of profilePtr and Profile object
    MODEM_PROFILES: {},
    MODEM_PROFILES_REVERSED: {},
    currentlyUsedModemProfile: null,
};
