// This runs in the AudioWorkletGlobalScope — no DOM, no window, no imports
class TinyTUSProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0]?.[0]; // first channel of first input
        if (input?.length) {
            // Send the raw samples to the main thread
            this.port.postMessage(input, [input.buffer]); // transfer, not copy
        }
        return true; // keep processor alive
    }
}

registerProcessor("tinytus-processor", TinyTUSProcessor);
