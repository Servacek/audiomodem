
import {MEMORY, EXPORTS, requiresLoadedWASM} from "../bindings.js";
import * as CONST from "../constants.js";

const bitsPerFrameSlider = document.getElementById("bits-per-frame");
const bitsPerFrameDisplay = document.getElementById("bits-per-frame-display");
const bufferSizeInput = document.getElementById("buffer-size-input");

const channelIdSelect = document.getElementById("channel-id-select");
const channelNameList = document.getElementById("channel-name-list");


function saveConfig() {
    localStorage.setItem("bitsPerFrame", bitsPerFrameSlider.value);
    localStorage.setItem("channelId", channelIdSelect.value);
    localStorage.setItem("bufferSize", bufferSizeInput.value);

    const MAX_USERS = MEMORY[EXPORTS.MAX_USERS.value];
    for (let i = 0; i < MAX_USERS; i++) {
        const name = "channel-name-" + i;
        localStorage.setItem(name, document.getElementById(name).value);
    }
}

function loadConfig() {
    const bits = localStorage.getItem("bitsPerFrame");
    if (bits !== null) {
        bitsPerFrameSlider.value = bits;
        bitsPerFrameDisplay.innerText = bits;
    }

    const savedBufferSize = localStorage.getItem("bufferSize");
    if (savedBufferSize !== null) {
        bufferSizeInput.value = savedBufferSize;
    } else {
        bufferSizeInput.value = (navigator.userAgent.includes("Firefox")) ? 5300 : 7300;
    }
}

loadConfig();


function onConfigurationUpdated() {
    // We always have to recalculate the dynamic configurations.
    EXPORTS.recalc_conf();
}

bufferSizeInput.addEventListener("input", (event) => {
    onConfigurationUpdated();
    saveConfig();
})


bitsPerFrameSlider.addEventListener("input", (event) => {
    const bits = event.target.value;
    bitsPerFrameDisplay.textContent = bits;

    MEMORY[EXPORTS.BITS_PER_FRAME.value] = new Uint8Array([bits])[0];
    MEMORY[EXPORTS.CONTROL_FRAME_DURATION.value] = new Float32Array([1/bits])[0];

    onConfigurationUpdated();
    saveConfig()
});

requiresLoadedWASM(() => {
    const MAX_USERS = MEMORY[EXPORTS.MAX_USERS.value];
    for (let i = 0; i < MAX_USERS; i++) {
        const option = document.createElement("option");
        option.value = i;
        option.textContent = "Kanál #" + i;
        channelIdSelect.appendChild(option);

        const label = document.createElement("label");
        label.textContent = "Názov kanálu #" + i;

        const input = document.createElement("input");
        input.type = "text";
        input.id = "channel-name-" + i;
        input.maxLength = CONST.MAX_CHANNELNAME_LENGTH;
        input.placeholder = "";
        input.style.padding = "5px";
        input.style.marginLeft = "10px";

        const storedValue = localStorage.getItem("channel-name-" + i);
        if (storedValue != null) {
            input.value = storedValue;
        }

        input.addEventListener("input", () => {
            localStorage.setItem("channel-name-" + i, input.value);
            saveConfig();
        });

        label.appendChild(input);
        label.style.display = "block";
        label.style.padding = "5px";
        channelNameList.appendChild(label);
    }

    // Select the default user ID
    const savedUserId = localStorage.getItem("channelId");
    if (savedUserId != null) {
        channelIdSelect.value = savedUserId;
    } else {
        const CURRENT_USER_ID = MEMORY[EXPORTS.USER_ID.value];
        channelIdSelect.value = CURRENT_USER_ID;
    }

    channelIdSelect.addEventListener("change", () => {
        MEMORY[EXPORTS.USER_ID.value] = new Uint8Array([channelIdSelect.value])[0];
        onConfigurationUpdated();
        saveConfig();
    });
})


window.addEventListener("refresh-local-storage", saveConfig);
