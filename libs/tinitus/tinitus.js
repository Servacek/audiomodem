/*
 * Sluzi ako most medzi JavaScriptom a WebAssembly buildom Tinitus kniznice.
 * Reimplementovava navyssiu vrstvu API kniznice vo Web JavaScript s vyuzitim
 * webovych API pre audio vstup/vystup.
*/


// KNOWN ERRORS:
// LinkError: _assert_fail is not a Function
//      - probably caused by -s LINKABLE=1
// wasmExports.<function> is not a function
//      - Missing EMSCRIPTEN_KEEPALIVE macros above C functions.

// Predvolena trasa
let LIBRARY_PATH = "./libs/tinitus/tinitus.wasm";

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
    Tinitus.MEMORY.set(byteArray, Tinitus.INPUT_BUFFER_PTR);
}

// Returns the bytearray of the output buffer
// export function getOutputBuffer(length) {
//     return new Float32Array(TINITUS.EXPORTS.memory.buffer, TINITUS.OUTPUT_BUFFER_PTR, length).slice();
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
        _emscripten_memcpy_js: (dest, src, num) => Tinitus.MEMORY.copyWithin(dest, src, src + num),
        emscripten_notify_memory_growth: (index) => { },
    };

    // Mapping functions
    for (let funcName in Tinitus.MAPPINGS) {
        env[funcName] = Tinitus.MAPPINGS[funcName];
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
                        var ptr = Tinitus.MEMORY_U32[((iov) >> 2)];
                        var len = Tinitus.MEMORY_U32[(((iov) + (4)) >> 2)];
                        iov += 8;
                        for (var j = 0; j < len; j++) {
                            s += String.fromCharCode(Tinitus.MEMORY[ptr + j]);
                        }
                        num += len;
                    }
                    Tinitus.MEMORY_U32[((pnum) >> 2)] = num;
                    console.log(s);
                    return 0;
                }
            },
        } // Pass the memory object to the module
    );

    EXPORTS = instance.exports;
    Tinitus.EXPORTS = EXPORTS;

    Tinitus.BUFFER = EXPORTS.memory.buffer;
    Tinitus.MEMORY = new Uint8Array(EXPORTS.memory.buffer);
    Tinitus.MEMORY_U16 = new Uint16Array(EXPORTS.memory.buffer);
    Tinitus.MEMORY_U32 = new Uint32Array(EXPORTS.memory.buffer);
    Tinitus.MEMORY_F32 = new Float32Array(EXPORTS.memory.buffer);
    Tinitus.MEMORY_STACK_START = Tinitus.MEMORY.length - EXPORTS.emscripten_stack_get_free();

    Tinitus.INPUT_BUFFER_PTR = Tinitus.MEMORY_STACK_START + 4096;
    Tinitus.OUTPUT_BUFFER_PTR = Tinitus.INPUT_BUFFER_PTR + 1024;
}

function _load(path = LIBRARY_PATH) {
    console.log("Loading tinitus library from path:", path);
    _init(path).then(() => {
        _LOADED = true;
        console.info("Successfully initialized WASM!");
        Tinitus.onLoaded();

        window.dispatchEvent(new CustomEvent("wasm-library-loaded"));
    }).catch((error) => {
        _LOADED = false;
        console.error("Failed to initialize WASM:", error);
        window.dispatchEvent(new CustomEvent("wasm-library-failed"));
    });
}


function _modemProfileOrPtrToPtr(modem_profile_or_ptr) {
    if (modem_profile_or_ptr instanceof ModemProfile) {
        return Tinitus.MODEM_PROFILES_REVERSED[modem_profile_or_ptr];
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


export let Tinitus = {
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
        return Tinitus.getReturnValue(type, ptr, 1)[0];
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
        Tinitus.EXPORTS.send_payload(
            modem_profile_ptr, Tinitus.INPUT_BUFFER_PTR, messageBytes.length
        );
    },

    onLoaded(block) {
        const defaultModemProfile = new ModemProfile({
            param: 0,      // MODULATED_PARAMETER param
            min_rx_freq: 1200,   // uint16_t min_rx_freq
            max_rx_freq: 2200,   // uint16_t max_rx_freq
            car_freq: 3000,   // uint16_t car_freq
            // Pre web potrebujeme aspon 48000
            sample_rate: 8000,  // uint16_t sample_rate
            bps: 100,    // uint16_t bps
            bits_per_symbol: 1,     // uint8_t bits per symbol
            min_tx_freq: 800,   // uint16_t min_tx_freq
            max_tx_freq: 1600,   // uint16_t max_tx_freq
            min_tx_amp: 100,    // uint8_t min_tx_amp
            max_tx_amp: 255,    // uint8_t max_tx_amp
            min_tx_phs: 0,      // uint8_t min_tx_phs
            max_tx_phs: 180     // uint8_t max_tx_phs (0 - 180)
        })
        Tinitus.registerProfile(defaultModemProfile);
        Tinitus.DEFAULT_MODEM_PROFILE = Tinitus.MODEM_PROFILES_REVERSED[defaultModemProfile];
    },

    registerProfile(modem_profile) {
        const modem_profile_ptr = Tinitus.EXPORTS.create_modem_profile(
            ...modem_profile.getParametersOrderedArray()
        );
        Tinitus.MODEM_PROFILES[modem_profile_ptr] = modem_profile;
        Tinitus.MODEM_PROFILES_REVERSED[modem_profile] = modem_profile_ptr;

        return modem_profile;
    },

    /** @returns {ModemProfile}  */
    getModemProfileFromPointer(modem_profile_ptr) {
        return Tinitus.MODEM_PROFILES[modem_profile_ptr];
    },

    /**
     * Modulate a message into a waveform
     * @param {ModemProfile|number} modem_profile - ModemProfile object or pointer
     * @param {string} message - Message to modulate
     * @returns {Float32Array} The modulated waveform
     */
    modulateMessage(message, modem_profile = null) {
        modem_profile = modem_profile || Tinitus.DEFAULT_MODEM_PROFILE;
        const messageBytes = new TextEncoder().encode(message);
        fillInputBuffer(messageBytes);

        const outLenPtr = Tinitus.MEMORY_STACK_START + 2048;
        const modulatedPtr = Tinitus.EXPORTS.modulate_payload(
            _modemProfileOrPtrToPtr(modem_profile),
            Tinitus.INPUT_BUFFER_PTR,
            messageBytes.length,
            outLenPtr
        );

        return Tinitus.getReturnValue(
            "f32", modulatedPtr, Tinitus.getValueFromPointer("i32", outLenPtr)
        );
    },

    // TODO: Put this part handling audio here as well?
    tryStartListeningForIncomingMessages: async (onAudioProcess, onByteReceived) => {
        if (!navigator.mediaDevices) {
            return Error("Neboli detekované žiadne mediálne zariadenia potrebné pre príjimanie a odosielanie údajov alebo pre funkčnosť oscilátora. Možno pomôže opätovne načítať stránku.")
        }

        // Create modem context
        let modemProfilePtr = Tinitus.DEFAULT_MODEM_PROFILE;
        let modemContextPtr = Tinitus.EXPORTS.modem_context_create();
        if (modemContextPtr == -1) {
            return Error("Failed to create modem context.");
        }
        if (Tinitus.EXPORTS.modem_context_init(modemContextPtr, modemProfilePtr) == -1) {
            return Error("Failed to initialize modem context.");
        }
        let decoderPtr = Tinitus.EXPORTS.modem_context_get_decoder(modemContextPtr);
        if (decoderPtr == -1) {
            return Error("Failed to get decoder from modem context.");
        }

        navigator.mediaDevices.getUserMedia({
            audio: {
                // TODO: Try these out?
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                googEchoCancellation: false,
                googNoiseSuppression: false,
                googAutoGainControl: false,
            },
            video: false,
        }).then(function (stream) {
            const context = new AudioContext({
                latencyHint: "balanced",
                sampleRate: 48000,
            });
            const mediaStreamSource = context.createMediaStreamSource(stream);
            const bufferSize = 1024;
            var recorder = context.createScriptProcessor(bufferSize, 1, 1)

            recorder.onaudioprocess = function (event) {
                const input = event.inputBuffer.getChannelData(0);

                for (let i = 0; i < input.length; i++) {
                    const status = Tinitus.EXPORTS.handle_input_sample(
                        modemContextPtr,
                        input[i]
                    );

                    if (status === 2) {
                        const byte = Tinitus.EXPORTS.frame_decoder_get_last_byte(decoderPtr);
                        onByteReceived(byte);
                    }
                }

                onAudioProcess(event);
            }

            mediaStreamSource.connect(recorder);
            recorder.connect(context.destination);

            return null;
        }).catch(function (e) { // This should handle even the revokes and everything.
            return e;
        });
    },

    // This is a map of profilePtr and Profile object
    MODEM_PROFILES: {},
    MODEM_PROFILES_REVERSED: {},
};
