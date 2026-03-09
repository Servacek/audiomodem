// Bezi v AudioWorkletGlobalScope bez DOM a window.
class TinyTUSProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0]?.[0]; // Prvy kanal prveho vstupu.
        if (input?.length) {
            // Posli surove vzorky do hlavneho vlakna.
            this.port.postMessage(input, [input.buffer]); // Prenes buffer bez kopie.
        }
        return true; // Udrz worklet aktivny.
    }
}

registerProcessor("tinytus-processor", TinyTUSProcessor);
