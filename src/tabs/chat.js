

// import {modulateStringToWaveform, FSK, encodeStringToBits} from './modulator.js';
// import {decodeBitsToString, getPeakFrequency} from './demodulator.js';
import { TinyTUS } from '../../libs/tinytus/tinytus.js';
import * as CONST from '../constants.js';
import { max, formatDate } from '../utils.js';
import { setMicStatus } from '../indicator.js';

// TODO: Disable the send button when no content is available.
// Provide the send button also on mobile in some minimazed form.

////////////////////

const inputArea = document.getElementById("input-area");
const inputBar = document.getElementById("input-bar");
const messageArea = document.getElementById("message-area");
const sendMessageButton = document.getElementById("send-message-button");

////////////////////

var messagesToSend = [];
var currentlySendingMessage = null;

////////////////////

function sendNextMessage() {
    if (currentlySendingMessage) {
        return // We are already sending something
    }

    const nextMessage = messagesToSend.shift();
    if (nextMessage && nextMessage.waveform) {
        // Check if the data are normalized, if not normalize it
        // since some browsers require them normalized.
        const messageWaveformMax = max(nextMessage.waveform);
        if (messageWaveformMax > 1) {
            nextMessage.waveform = nextMessage.waveform.map(x => x / messageWaveformMax);
        }

        const nextMessageWaveform = nextMessage.waveform;
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const buffer = audioContext.createBuffer(1, nextMessageWaveform.length, nextMessage.modemProfile.sample_rate);
        const channelData = buffer.getChannelData(0); // Get the first (and only) channel
        channelData.set(nextMessageWaveform); // Copy the sine wave data into the buffer

        // 4. Create a source and play the buffer
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);

        // Start playback
        source.startTime = audioContext.currentTime;
        source.start();
        currentlySendingMessage = nextMessage;

        const intervalId = setInterval(() => {
            const progress = (source.context.currentTime - source.startTime) / buffer.duration;
            currentlySendingMessage.progressBar.value = progress * 100;
        }, 50);

        source.onended = () => {
            clearInterval(intervalId); // Vypnime progress aktualizovanie progress baru.

            currentlySendingMessage.dispatchEvent(new Event("sent"));
            currentlySendingMessage = null;
            window.dispatchEvent(new CustomEvent("message-send-completed"));
            if (messagesToSend.length <= 0) {
                window.dispatchEvent(new CustomEvent("last-message-send-completed"));
            }

            sendNextMessage();
        };
    }
}

async function sendMessage(message) {
    messagesToSend.push(message)
    message.progressBar.style.display = "block";
    message.bubble.classList.add("sending");
    message.addEventListener("sent", () => {
        message.bubble.classList.remove("sending");
        message.progressBar.style.display = "none";
    })

    window.dispatchEvent(new CustomEvent("message-send-started", {
        "detail": { message: message }
    }));
    // Ak mame pripojene USB - pockajme chvilku kym sa zopne.
    setTimeout(() => sendNextMessage(), window.port != null ? 500 : 0);
}

// TODO: This is temporary until we decide on the design.
const sendMessageButtonWithIcon = document.getElementById("send-message-button-with-icon");

inputBar.oninput = function () {
    //this.style.height = 'auto'; // Reset height to calculate scrollHeight
    //this.style.height = `${Math.min(this.scrollHeight, 200)}px`; // Adjust 200 to match max-height

    sendMessageButton.disabled = !this.value.trim();
    sendMessageButtonWithIcon.disabled = sendMessageButton.disabled;
}

// Handle submit button being pressed
sendMessageButton.addEventListener("click", () => inputArea.submit());
sendMessageButtonWithIcon.addEventListener("click", () => sendMessageButton.click());

// Handle enter key, when SHIFT is pressed do not send the message.
inputArea.addEventListener("keydown", event => {
    if (sendMessageButtonWithIcon.offsetParent == null && event.keyCode === 13 && !event.shiftKey) {
        event.preventDefault();
        inputArea.submit();
    }
})

inputArea.submit = () => {
    const msgText = inputBar.value.trim();
    if (!msgText) return; // Ignore pressing blank enters

    /// @TODO: Add option to change the username.
    // Display the message first.
    const newMessage = createSelfMessage(msgText);
    clearInputBar();
    displayMessageAtBottom(newMessage);

    // This is for the future when we will want to debug the waves.
    // if (CONST.DEBUG_MODE) {
    //     plotWaveform(newMessage.waveform);
    // }

    sendMessage(newMessage);
}


//startRecording();

function clearInputBar() {
    inputBar.value = "";
    inputBar.oninput();
}

function createMessageBase() {
    const date = new Date();
    const msg = document.createElement("div");
    msg.classList.add("message");
    msg.date = date;

    return msg;
}

function createUserMessage(author, alignment, content) {
    const msg = createMessageBase();
    msg.classList.add("user-msg", `${alignment}-user-msg`);

    const bubble = document.createElement("div");
    bubble.classList.add("msg-bubble");
    bubble.addEventListener("dblclick", (e) => {
        // Double clicking the text bubble will copy the message.
        navigator.clipboard.writeText(msg.content);
    });

    const iconElement = document.createElement("i");
    iconElement.className = alignment === "left" ? "fa-regular fa-circle-right" : "fa-regular fa-circle-left";
    msg.icon = iconElement;
    msg.appendChild(iconElement)

    const info = document.createElement("div");
    info.classList.add("msg-info");

    const name = document.createElement("div");
    msg.username = name;
    name.classList.add("msg-info-name");
    name.textContent = author;

    const time = document.createElement("div");
    time.classList.add("msg-info-time");
    time.textContent = formatDate(msg.date);

    info.append(name, time);

    const text = document.createElement("pre");
    text.classList.add("msg-text");
    text.textContent = content;

    // TODO: Maybe rather a dialog for right click?
    // const downloadButton = document.createElement("button");
    // downloadButton.classList.add("message-button");
    // downloadButton.classList.add("download-waveform-button");
    // downloadButton.innerHTML = `<i class="fa-solid fa-file-waveform"></i>`;
    // downloadButton.addEventListener("click", () => {
    //     // TODO: Implement this properly.
    //     const blob = new Blob([new Int16Array(msg.waveform).buffer], {type: "audio/wav"});
    //     const url = URL.createObjectURL(blob);
    //     const a = document.createElement("a");
    //     a.href = url;
    //     a.download = `AudioModem-${msg.date.toISOString()}.wav`;
    //     a.click();
    // });
    // bubble.appendChild(downloadButton);

    // const deleteButton = document.createElement("button");
    // deleteButton.classList.add("message-button");
    // deleteButton.classList.add("delete-button");
    // deleteButton.innerHTML = `<i class="fa-solid fa-trash"></i>`;
    // deleteButton.addEventListener("click", (e) => {
    //     // Double clicking the text bubble will copy the message.
    //     const confirm = window.confirm("Are you sure you want to delete this message?");
    //     if (confirm) {
    //         displayMessageAtBottom(null);
    //         sendMessage(null);
    //     }
    // });
    // bubble.appendChild(deleteButton);

    // const copyButton = document.createElement("button");
    // copyButton.classList.add("message-button");
    // copyButton.classList.add("copy-button");
    // copyButton.innerHTML = `<i class="fa-solid fa-clipboard"></i>`;
    // copyButton.addEventListener("click", (e) => {
    //     // Double clicking the text bubble will copy the message.
    //     navigator.clipboard.writeText(msg.content);
    // });
    // bubble.appendChild(copyButton);

    msg.bubble = bubble;
    msg.content = content;

    bubble.text = text
    bubble.append(info, text);
    msg.append(bubble);

    return msg;
}

// The name should be safe to use in innerHTML
function getUsername() {
    const usernameConfigInput = document.getElementById("username-config-input");
    const username = usernameConfigInput.value || localStorage.getItem("username");
    return username.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

window.addEventListener("microphone-waiting-for-gesture", () => {
    displayMessageAtBottom(systemMessage(
        "Kliknite kdekoľvek na stránku pre aktiváciu mikrofónu.", "info"
    ));
});

// window.addEventListener("microphone-started", () => {
//     displayMessageAtBottom(systemMessage(
//         "Mikrofón bol aktivovaný.", "success"
//     ));
// });

function createSelfMessage(text, image = null) {
    const username = getUsername();
    const message = createUserMessage(username, CONST.ALIGMENT_RIGHT, text);

    if (image != null) {
        addImageToMessage(message, image);
    }

    const progressBar = document.createElement("progress");
    progressBar.value = 0;
    progressBar.max = 100;
    progressBar.style.display = "none";
    message.progressBar = progressBar;
    message.bubble.appendChild(progressBar)

    // TODO: Add option to choose which profile to use.
    message.modemProfile = TinyTUS.currentlyUsedModemProfile;
    print("Modulating message with profile:", message.modemProfile);
    message.waveform = TinyTUS.modulateMessage(text, message.modemProfile);

    return message;
}

function addImageToMessage(message, image) {
    const imgModal = document.createElement('div');
    imgModal.classList.add('img-modal');

    const imgModalImg = document.createElement('img');
    imgModalImg.src = image.src;
    imageLabel.style.display = 'none';
    sendButton.style.display = 'none';
    image.addEventListener('click', (e) => {
        e.stopPropagation();
        imageModal.style.display = 'flex';
        modalImage.src = image.src;
    });

    message.bubble.text.style.paddingBottom = "10px";
    message.bubble.append(image);
    imgModal.append(imgModalImg);
}

function displayMessageAtBottom(msg) {
    const lastMessage = messageArea.lastElementChild;
    const currentDate = new Date().toISOString().split('T')[0];
    const lastMessageDate = lastMessage ? new Date(lastMessage.date) : null;
    const currentDateObject = new Date(currentDate);
    const dayDiffers = lastMessageDate ? (
        lastMessageDate.getDate() !== currentDateObject.getDate() &&
        lastMessageDate.getMonth() !== currentDateObject.getMonth() &&
        lastMessageDate.getFullYear() !== currentDateObject.getFullYear()
    ) : null;

    if (!lastMessage || dayDiffers) {
        const separator = document.createElement('div');
        separator.className = 'separator unselectable';
        const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
        const formattedDate = currentDateObject.toLocaleDateString(document.documentElement.lang, dateOptions);
        separator.textContent = formattedDate;
        messageArea.appendChild(separator);
    }

    messageArea.appendChild(msg);
    scrollToBottom();

    if (messageArea.offsetParent === null && msg?.system !== true) {
        // Nemame otvoreny cet a prisla nam sprava.
        document.getElementById('chat-button').classList.add('new-message');
    }
}


function scrollToBottom() {
    // Probably fine, but it could scroll a bit more...
    messageArea.scrollTop = messageArea.scrollHeight;
}


//// MODALS


const attachmentInput = document.getElementById('attachment-input');
const imageModal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');
const imageLabel = document.getElementById('image-label');
const sendButton = document.getElementById('send-image-button');

function closeImageUploadModal() {
    imageModal.style.display = "none";
    imageLabel.value = "";
    inputBar.focus();
}

// Handle Send Button Click
sendButton.addEventListener('click', () => {
    const labelText = imageLabel.value || "";

    // Log data or process the image and label
    console.log('Image sent with label:', labelText);

    // Optionally append the image to the chat area
    const imgElement = document.createElement('img');
    imgElement.src = modalImage.src;
    imgElement.alt = labelText;
    imgElement.style.maxHeight = '200px';
    imgElement.style.marginRight = '10px';
    imgElement.style.borderRadius = '8px';

    const labelElement = document.createElement('span');
    labelElement.textContent = labelText;
    labelElement.style.marginLeft = '5px';

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.appendChild(imgElement);
    container.appendChild(labelElement);

    const message = createSelfMessage(labelText, imgElement);
    displayMessageAtBottom(message);
    sendMessage(message);

    // Close the modal
    closeImageUploadModal();

    setTimeout(() => {
        // Clear the input since we have used it for the modal
        clearInputBar();
    }, 0);
});

imageLabel.addEventListener('input', () => {
    sendButton.disabled = !imageLabel.value.trim();
})

function systemMessage(text, type, icon = null) {
    const msg = createMessageBase();
    msg.classList.add("system-message", "system-message-" + type);
    msg.style.color = CONST.SYSTEM_MESSAGE_COLORS[type];
    msg.system = true;

    const iconElement = document.createElement("i");
    iconElement.className = icon || CONST.SYSTEM_MESSAGE_ICONS[type];
    msg.appendChild(iconElement)

    const content = document.createElement("span");
    // Using innerHTML here since
    content.innerHTML = text;
    msg.appendChild(content);

    return msg;
}

// Close the modal when clicking outside the content
imageModal.addEventListener('click', (event) => {
    if (event.target === imageModal) { // This has to be here!!!
        closeImageUploadModal();
    }
})

// Handle file selection
attachmentInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;

            // Set the modal image source
            modalImage.src = imageUrl;

            imageLabel.value = inputBar.value;

            // Show the modal
            imageModal.style.display = 'flex';
            imageLabel.style.display = "flex";
            sendButton.style.display = "absolute";
            // Focus the label input
            imageLabel.focus();
        };
        reader.readAsDataURL(file);
    } else {
        alert('Zadaný formát súbor zatiaľ nie je podporovaný.');
    }
});

// Handle pressing enter at the modal
imageModal.addEventListener("keydown", (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendButton.click();
    }
});

//////// SETUP

if (!navigator.mediaDevices) {
    alert("Neboli detekované žiadne mediálne zariadenia potrebné pre príjimanie a odosielanie údajov alebo pre funkčnosť oscilátora. Možno pomôže opätovne načítať stránku.");
    if (confirm("Načítať stránku znova?")) location.reload();
}

let wasmLoaded = false;
let hasUserInteracted = false;

// ─── Verbose init ─────────────────────────────────────────────────────────────

let _initCallCount = 0;

const initStateUpdate = async (reason = "unknown") => {
    const callId = ++_initCallCount;
    console.group(`[INIT #${callId}] initStateUpdate() — reason: "${reason}"`);
    console.log("  wasmLoaded:", wasmLoaded);
    console.log("  hasUserInteracted:", hasUserInteracted);
    console.log("  _initializationInProgress:", TinyTUS._initializationInProgress);
    console.log("  currentlyUsedModemProfile:", TinyTUS.currentlyUsedModemProfile);

    if (!wasmLoaded) {
        console.warn("  ⛔ Bailing — WASM not loaded yet.");
        console.groupEnd();
        return;
    }

    if (!TinyTUS.currentlyUsedModemProfile) {
        console.warn("  ⛔ Bailing — currentlyUsedModemProfile is null/undefined.");
        console.groupEnd();
        return;
    }

    if (TinyTUS._initializationInProgress) {
        console.warn("  ⛔ Bailing — initialization already in progress.");
        console.groupEnd();
        return;
    }

    console.log("  ✅ All checks passed — calling tryStartListeningForIncomingMessages...");
    console.groupEnd();

    const error = await TinyTUS.tryStartListeningForIncomingMessages(
        TinyTUS.currentlyUsedModemProfile,
        (event) => {
            window.dispatchEvent(new CustomEvent("audioprocess", {
                "detail": { inputBuffer: event.inputBuffer }
            }));
        }
    );

    if (error != null) {
        console.error(`[INIT #${callId}] ❌ tryStartListening returned error:`, error.name, error.message, error);
        setMicStatus("blocked");

        let errorMsg = "Nepodarilo sa spustiť prijímanie správ: ";
        if (error.name === 'NotAllowedError') {
            errorMsg += "Prístup k mikrofónu bol zamietnutý. Povoľte prístup v nastaveniach prehliadača.";
        } else if (error.name === 'NotFoundError') {
            errorMsg += "Nebol nájdený žiadny mikrofón. Skontrolujte pripojenie mikrofónu.";
        } else if (error.name === 'NotReadableError') {
            errorMsg += "Mikrofón je už používaný inou aplikáciou. Zatvorte ostatné aplikácie používajúce mikrofón.";
        } else {
            errorMsg += error.message;
        }

        displayMessageAtBottom(systemMessage(
            errorMsg + " <a href='#' onclick='event.preventDefault(); window.dispatchEvent(new Event(\"retry-microphone\"));' style='color: var(--msger-send-button-bg); text-decoration: underline;'>Skúsiť znova</a>",
            "error"
        ));
    } else {
        console.log(`[INIT #${callId}] ✅ tryStartListening returned null (success or waiting-for-gesture).`);
    }
};

// ─── User interaction unlock ──────────────────────────────────────────────────

function enableUserInteraction() {
    if (hasUserInteracted) return;
    hasUserInteracted = true;
    console.log("[MIC] First user interaction detected.");

    if (wasmLoaded) {
        console.log("[MIC] WASM already loaded — triggering initStateUpdate from user interaction.");
        initStateUpdate("first-user-interaction");
    } else {
        console.log("[MIC] WASM not yet loaded — initStateUpdate will fire from wasm-library-loaded.");
    }
}

document.addEventListener('click', enableUserInteraction, { once: true });
document.addEventListener('keydown', enableUserInteraction, { once: true });

// ─── Window event listeners ───────────────────────────────────────────────────

window.addEventListener("wasm-library-loaded", async () => {
    console.log("[EVENT] wasm-library-loaded fired. Setting wasmLoaded = true.");
    wasmLoaded = true;
    await initStateUpdate("wasm-library-loaded");
});

if (TinyTUS.isLibraryLoaded()) {
    // WASM already loaded before this listener was registered
    wasmLoaded = true;
    initStateUpdate("wasm-already-loaded-on-register");
} else {
    window.addEventListener("wasm-library-loaded", async () => {
        console.log("[EVENT] wasm-library-loaded fired.");
        wasmLoaded = true;
        await initStateUpdate("wasm-library-loaded");
    });
}

window.addEventListener("active-modem-profile-changed", async (e) => {
    console.log("[EVENT] active-modem-profile-changed fired. detail:", e.detail);
    await initStateUpdate("active-modem-profile-changed");
});

window.addEventListener("modem-profile-updated", async (e) => {
    console.log("[EVENT] modem-profile-updated fired. detail:", e.detail);
    await initStateUpdate("modem-profile-updated");
});

window.addEventListener("retry-microphone", async () => {
    console.log("[EVENT] retry-microphone fired.");
    displayMessageAtBottom(systemMessage("Pokúšam sa znova spustiť mikrofón...", "info"));
    // Reset the flag so the retry can actually proceed
    TinyTUS._initializationInProgress = false;
    await initStateUpdate("retry-microphone");
});

window.addEventListener("microphone-waiting-for-gesture", () => {
    console.log("[MIC] microphone-waiting-for-gesture — AudioContext needs a user gesture.");
    displayMessageAtBottom(systemMessage(
        "Kliknite kdekoľvek na stránku pre aktiváciu mikrofónu.", "info"
    ));
});

window.addEventListener("microphone-started", () => {
    console.log("[MIC] microphone-started — audio graph connected and running.");
});

window.addEventListener("mic-blocked", () => {
    console.error("[MIC] mic-blocked event received.");
    setMicStatus("blocked");
});

window.addEventListener("message-received", (event) => {
    console.log("[MSG] message-received, byte length:", event.detail.bytes.length);
    const bytes = event.detail.bytes;
    const textDecoder = new TextDecoder("utf-8");
    const decodedText = textDecoder.decode(new Uint8Array(bytes));
    const newMessage = createUserMessage("Niekto", CONST.ALIGMENT_LEFT, decodedText);
    displayMessageAtBottom(newMessage);
});

window.addEventListener("wasm-library-failed", () => {
    console.error("[EVENT] wasm-library-failed — WASM could not be loaded.");
    wasmLoaded = false;
    setMicStatus("blocked");
    displayMessageAtBottom(systemMessage("Načítavanie externých knižníc zlyhalo. Pokúste sa reštartovať stránku, alebo ak chyba pretrváva, kontaktujte správcu.", "error"));
});

window.addEventListener("usb-device-connected", (event) => {
    console.log("[USB] Device connected:", event.detail.device.productName);
    displayMessageAtBottom(systemMessage(`USB zariadenie pripojené: <span style="color: var(--msger-send-button-bg);">${event.detail.device.productName}</span>`, "info"));
});

window.addEventListener("usb-device-connection-failed", (event) => {
    console.error("[USB] Connection failed:", event.detail.error);
    displayMessageAtBottom(systemMessage("USB zariadenie sa neporadilo spárovať.", "error"));
});

window.addEventListener("usb-device-disconnected", () => {
    console.log("[USB] Device disconnected.");
    displayMessageAtBottom(systemMessage("USB zariadenie odpojené.", "info"));
});

document.getElementById('chat-button').addEventListener('click', () => {
    document.getElementById('chat-button').classList.remove('new-message');
});

// ─── Login ────────────────────────────────────────────────────────────────────

function onUserLoggedIn() {
    console.log("[AUTH] onUserLoggedIn fired. username:", getUsername());
    if (!window.matchMedia("(max-width: 512px)").matches) {
        inputBar.focus();
    }

    const configButtonIcon = document.getElementById("config-button").getElementsByTagName("i")[0];
    const configButtonRef = "<div id='config-button-ref' onclick='document.getElementById(\"config-button\").click()'>" + configButtonIcon.outerHTML + "</div>";
    const welcomeMessage = systemMessage("Vitaj <span id='username-text'>" + getUsername() + "</span>! Svoju prezývku si môžeš kedykoľvek zmeniť v nastaveniach" + configButtonRef, "welcome");
    displayMessageAtBottom(welcomeMessage);
    initStateUpdate("user-logged-in");
}

window.addEventListener("user-logged", onUserLoggedIn);

if (window.userLoggedIn) {
    onUserLoggedIn();
}
