

import { TinyTUS } from '../../libs/tinytus/tinytus.js';
import { addProfileFromCodeAndActivate, getAllModemProfilesForDemodulation, getModemProfileMeta, isValidProfileCode } from './config.js';
import * as CONST from '../constants.js';
import { max, formatDate } from '../utils.js';
import { setMicStatus } from '../indicator.js';

////////////////////

const inputArea = document.getElementById("input-area");
const inputBar = document.getElementById("input-bar");
const messageArea = document.getElementById("message-area");
const sendMessageButton = document.getElementById("send-message-button");

////////////////////

let messagesToSend = [];
let currentlySendingMessage = null;
let currentIncomingStreamedMessage = null;

////////////////////

function sendNextMessage() {
    if (currentlySendingMessage) {
        return // Uz sa odosiela ina sprava.
    }

    const nextMessage = messagesToSend.shift();
    if (nextMessage && nextMessage.waveform) {
        // Uisti sa, ze waveform je normalizovany.
        const messageWaveformMax = max(nextMessage.waveform);
        if (messageWaveformMax > 1) {
            nextMessage.waveform = nextMessage.waveform.map(x => x / messageWaveformMax);
        }

        const nextMessageWaveform = nextMessage.waveform;
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const buffer = audioContext.createBuffer(1, nextMessageWaveform.length, nextMessage.sampleRate);
        const channelData = buffer.getChannelData(0); // Prvy a jediny kanal.
        channelData.set(nextMessageWaveform); // Skopiruj data do buffera.

        // Vytvor source a prehraj buffer.
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);

        // Spusti prehravanie.
        source.startTime = audioContext.currentTime;
        source.start();
        currentlySendingMessage = nextMessage;

        const intervalId = setInterval(() => {
            const progress = (source.context.currentTime - source.startTime) / buffer.duration;
            if (currentlySendingMessage?.progressBar) {
                currentlySendingMessage.progressBar.value = progress * 100;
            }
        }, 50);

        source.onended = () => {
            clearInterval(intervalId); // Zastav aktualizaciu progress baru.

            if (typeof currentlySendingMessage?.dispatchEvent === 'function') {
                currentlySendingMessage.dispatchEvent(new Event("sent"));
            }
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
    if (message.groupedWith) {
        const prev = messagesToSend.find(m => m === message.groupedWith);
        if (prev) {
            // Predchadzajuca sprava este nehraje - zretaz waveformy.
            const joined = new Float32Array(prev.waveform.length + message.waveform.length);
            joined.set(prev.waveform);
            joined.set(message.waveform, prev.waveform.length);
            prev.waveform = joined;
            return;
        }
        // Predchadzajuca sprava uz hraje - presmeruj na viditelnu bublinu.
        message.groupedWith.bubble.appendChild(message.progressBar);
        message.bubble = message.groupedWith.bubble;
    }

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
    // Pri pripojenom USB kratko pockaj na zopnutie.
    setTimeout(() => sendNextMessage(), window.port != null ? 500 : 0);
}

inputBar.oninput = function () {
    this.style.height = 'auto'; // Reset vysky pre vypocet scrollHeight.
    this.style.height = `${Math.min(this.scrollHeight, 200)}px`; // 200 musi sediet s max-height.

    sendMessageButton.disabled = !this.value.trim();
}

// Obsluha kliknutia na odoslanie.
sendMessageButton.addEventListener("click", () => inputArea.submit());

// Na pocitaci Enter odosle spravu, Shift+Enter vlozi novy riadok.
inputArea.addEventListener("keydown", event => {
    if (window.innerWidth >= 600 && event.keyCode === 13 && !event.shiftKey) {
        event.preventDefault();
        inputArea.submit();
    }
})

inputArea.submit = () => {
    const msgText = inputBar.value.trim();
    if (!msgText) return; // Ignoruj prazdnu spravu.

    /// @ULOHA: Pridaj moznost menit username.
    // Najprv zobraz spravu.
    const newMessage = createSelfMessage(msgText);
    if (!newMessage) return; // Modulacia zlyhala, chyba je uz zobrazena.

    clearInputBar();
    displayMessageAtBottom(newMessage);
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

function createUserMessage(author, alignment, content, profileMeta = null) {
    const msg = createMessageBase();
    msg.classList.add("user-msg", `${alignment}-user-msg`);
    msg.author = author;
    msg.modemProfile = profileMeta?.profile ?? null;

    const bubble = document.createElement("div");
    bubble.classList.add("msg-bubble");
    bubble.addEventListener("dblclick", (e) => {
        // Dvojklik na bublinu skopiruje spravu.
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

    if (profileMeta?.idLabel != null) {
        const profileId = document.createElement("span");
        profileId.classList.add("msg-info-profile-id");
        profileId.textContent = `#${profileMeta.idLabel}`;

        if (profileMeta.name) {
            profileId.title = profileMeta.name;
        }

        if (profileMeta.profile) {
            profileId.setAttribute("role", "button");
            profileId.setAttribute("tabindex", "0");
            profileId.addEventListener("click", () => {
                window.dispatchEvent(new CustomEvent("chat-focus-profile", {
                    detail: { profile: profileMeta.profile }
                }));
            });
            profileId.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    profileId.click();
                }
            });
        }

        name.appendChild(profileId);
    }

    const time = document.createElement("div");
    time.classList.add("msg-info-time");
    time.textContent = formatDate(msg.date);

    info.append(name, time);

    const text = document.createElement("pre");
    text.classList.add("msg-text");
    text.textContent = content;

    msg.bubble = bubble;
    msg.content = content;

    bubble.text = text
    bubble.append(info, text);
    msg.append(bubble);

    return msg;
}

// Meno musi byt bezpecne pre innerHTML.
function getUsername() {
    const usernameConfigInput = document.getElementById("username-config-input");
    const username = usernameConfigInput.value || localStorage.getItem("username");
    return (username || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const IMAGE_DIMENSIONS = { width: 128, height: 128 };

function encodeImageForTransmission(imgElement) {
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE_DIMENSIONS.width;
    canvas.height = IMAGE_DIMENSIONS.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(imgElement, 0, 0, IMAGE_DIMENSIONS.width, IMAGE_DIMENSIONS.height);

    const imageData = ctx.getImageData(0, 0, IMAGE_DIMENSIONS.width, IMAGE_DIMENSIONS.height);
    const pixels = imageData.data; // RGBA, 4 bytes per pixel

    // Zabal pixely do bitov: 1 bit na pixel, 8 pixelov na bajt.
    // Prah: priemer RGB > 127 je biela (1), inak cierna (0).
    const packed = new Uint8Array(Math.ceil(IMAGE_DIMENSIONS.width * IMAGE_DIMENSIONS.height / 8)); // Variable bytes
    for (let i = 0; i < IMAGE_DIMENSIONS.width * IMAGE_DIMENSIONS.height; i++) {
        const r = pixels[i * 4];
        const g = pixels[i * 4 + 1];
        const b = pixels[i * 4 + 2];
        const color_average = (r + g + b) / 3;
        const white = color_average > 127 ? 1 : 0;
        packed[i >> 3] |= (white << (i & 7));
    }

    return packed;
}

function createSelfMessage(text, image = null, profile = null) {
    const username = getUsername();
    const selectedProfile = profile || TinyTUS.currentlyUsedModemProfile;
    const profileMeta = {
        ...getModemProfileMeta(selectedProfile),
        profile: selectedProfile,
    };
    const message = createUserMessage(username, CONST.ALIGMENT_RIGHT, text, profileMeta);

    if (image != null) {
        addImageToMessage(message, image);
        message.imageData = encodeImageForTransmission(image);
        print("Encoded image data length (bytes):", message.imageData.length);
    }

    const progressBar = document.createElement("progress");
    progressBar.value = 0;
    progressBar.max = 100;
    progressBar.style.display = "none";
    message.progressBar = progressBar;
    message.bubble.appendChild(progressBar)

    message.modemProfile = selectedProfile;
    console.log("Modulating message with profile:", message.modemProfile);
    message.waveform = TinyTUS.modulateMessage(text, message.modemProfile);
    // Uloz sample_rate v case modulacie, aby sa prehravanie nespoliehalo
    // na aktualnu hodnotu profilu (moze sa zmenit pred prehranim).
    message.sampleRate = message.modemProfile.sample_rate;

    if (!message.waveform?.length) {
        displaySystemMessage('Modulacia zlyhala. Skontroluj nastavenia profilu (frekvencne rozsahy).', 'error');
        return null;
    }

    return message;
}

function waitForNextTick() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

async function enqueueImageChunksInBackground(imageData, modemProfile, chunkSize = 128) {
    if (!imageData?.length) return;

    let remaining = imageData;
    let chunkIndex = 0;

    while (remaining.length > 0) {
        const chunk = remaining.slice(0, chunkSize);
        remaining = remaining.slice(chunkSize);

        const chunkMessage = {
            waveform: TinyTUS.modulatePayload(chunk, modemProfile),
            sampleRate: modemProfile.sample_rate,
        };
        messagesToSend.push(chunkMessage);

        // Ak sa fronta medzitym vyprazdnila, znova ju rozbehni.
        if (!currentlySendingMessage) {
            setTimeout(() => sendNextMessage(), 0);
        }

        // Uvolni hlavne vlakno, nech UI neprimrzne.
        chunkIndex += 1;
        if (chunkIndex % 2 === 0) {
            await waitForNextTick();
        }
    }
}

function attachAddProfileActionIfCode(message, rawText) {
    const profileCode = (rawText || '').trim();
    if (!profileCode) return;
    if (!isValidProfileCode(profileCode)) return;

    const actionWrap = document.createElement('div');
    actionWrap.classList.add('chat-profile-code-actions');

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.classList.add('chat-profile-code-add-button');
    addButton.textContent = 'Pridať a použiť';

    addButton.addEventListener('click', () => {
        addButton.disabled = true;
        const added = addProfileFromCodeAndActivate(profileCode);
        if (added) {
            addButton.textContent = 'Profil pridaný';
            displaySystemMessage('Profil bol pridaný a nastavený ako aktívny.', 'info');
        } else {
            addButton.disabled = false;
            displaySystemMessage('Profil sa nepodarilo pridať z kódu.', 'error');
        }
    });

    actionWrap.appendChild(addButton);
    message.bubble.appendChild(actionWrap);
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

// Casovy limit pre zdruzovanie sprav (v milisekundach).
const GROUP_TIMEOUT_MS = 60_000;

// Vrati true ak mozno novu spravu vizualne zlucit s predchadzajucou.
function canGroupWith(prev, next) {
    if (!prev?.classList.contains('user-msg') || !next?.classList.contains('user-msg')) return false;
    if (prev.author !== next.author) return false;
    if (prev.modemProfile !== next.modemProfile) return false;
    const prevRight = prev.classList.contains('right-user-msg');
    const nextRight = next.classList.contains('right-user-msg');
    if (prevRight !== nextRight) return false;
    const dt = next.date - prev.date;
    return dt >= 0 && dt <= GROUP_TIMEOUT_MS;
}

function displayMessageAtBottom(msg) {
    let lastMessage = messageArea.lastElementChild;
    while (lastMessage && !(lastMessage.date instanceof Date)) {
        lastMessage = lastMessage.previousElementSibling;
    }

    const currentDateObject = msg?.date instanceof Date ? msg.date : new Date();
    const lastMessageDate = lastMessage?.date instanceof Date ? lastMessage.date : null;
    const dayDiffers = lastMessageDate
        ? lastMessageDate.toDateString() !== currentDateObject.toDateString()
        : false;

    if (!lastMessage || dayDiffers) {
        const separator = document.createElement('div');
        separator.className = 'separator unselectable';
        const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
        const formattedDate = currentDateObject.toLocaleDateString(document.documentElement.lang, dateOptions);
        separator.textContent = formattedDate;
        messageArea.appendChild(separator);
    }

    // Pridaj text priamo do predchadzajucej bubliny ak mozno zlucit.
    if (!dayDiffers && !msg.imageData && canGroupWith(lastMessage, msg)) {
        const extra = document.createElement('pre');
        extra.className = 'msg-text';
        extra.textContent = msg.content;
        lastMessage.bubble.appendChild(extra);
        lastMessage.date = msg.date;
        msg.groupedWith = lastMessage;
        scrollToBottom();
        return;
    }

    messageArea.appendChild(msg);
    scrollToBottom();

    if (messageArea.offsetParent === null && msg?.system !== true) {
        // Cet je zatvoreny a prisla nova sprava.
        document.getElementById('chat-button').classList.add('new-message');
    }
}


function scrollToBottom() {
    // Posun na koniec chatu.
    messageArea.scrollTop = messageArea.scrollHeight;
}


// Modaly.


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

// Obsluha odoslania obrazka.
sendButton.addEventListener('click', async () => {
    const labelText = imageLabel.value || "";

    // Tu sa mozu spracovat data obrazka a popisu.
    console.log('Image sent with label:', labelText);

    // Pridaj obrazok do chatu.
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

    const imageData = message.imageData;
    message.imageData = null;
    enqueueImageChunksInBackground(imageData, message.modemProfile, 32);

    // Zavri modal.
    closeImageUploadModal();

    setTimeout(() => {
        // Vycisti vstup po pouziti v modale.
        clearInputBar();
    }, 0);
});

imageLabel.addEventListener('input', () => {
    sendButton.disabled = !imageLabel.value.trim();
})

export function systemMessage(text, type, icon = null) {
    const msg = createMessageBase();
    msg.classList.add("system-message", "system-message-" + type);
    msg.style.color = CONST.SYSTEM_MESSAGE_COLORS[type];
    msg.system = true;

    const iconElement = document.createElement("i");
    iconElement.className = icon || CONST.SYSTEM_MESSAGE_ICONS[type];
    msg.appendChild(iconElement)

    const content = document.createElement("span");
    // Tu je innerHTML pouzite zamerne.
    content.innerHTML = text;
    msg.appendChild(content);

    return msg;
}

export function displaySystemMessage(text, type, icon = null) {
    const msg = systemMessage(text, type, icon);
    displayMessageAtBottom(msg);
}

function openSettingsTab() {
    const configButton = document.getElementById("config-button");
    if (configButton) {
        configButton.click();
    }
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Zavri modal pri kliknuti mimo obsahu.
imageModal.addEventListener('click', (event) => {
    if (event.target === imageModal) { // Zavri len pri kliku na overlay.
        closeImageUploadModal();
    }
})

// Obsluha vyberu suboru.
attachmentInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;

            // Nastav zdroj obrazka v modale.
            modalImage.src = imageUrl;

            imageLabel.value = inputBar.value;

            // Zobraz modal.
            imageModal.style.display = 'flex';
            imageLabel.style.display = "flex";
            sendButton.style.display = "flex";
            // Nastav focus na vstup popisu.
            imageLabel.focus();
        };
        reader.readAsDataURL(file);
    } else {
        alert('Zadaný formát súbor zatiaľ nie je podporovaný.');
    }
});

// Enter v modale odosle.
imageModal.addEventListener("keydown", (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendButton.click();
    }
});

// Inicializacia

if (!navigator.mediaDevices) {
    alert("Neboli detekované žiadne mediálne zariadenia potrebné pre príjimanie a odosielanie údajov alebo pre funkčnosť oscilátora. Možno pomôže opätovne načítať stránku.");
    if (confirm("Načítať stránku znova?")) location.reload();
}

let wasmLoaded = false;
let hasUserInteracted = false;
let micPermissionDenied = false;

// Detailny init log.

let _initCallCount = 0;

const initStateUpdate = async (reason = "unknown") => {
    const callId = ++_initCallCount;
    console.group(`[INIT #${callId}] initStateUpdate() - reason: "${reason}"`);
    console.log("  wasmLoaded:", wasmLoaded);
    console.log("  hasUserInteracted:", hasUserInteracted);
    console.log("  _initializationInProgress:", TinyTUS._initializationInProgress);
    console.log("  currentlyUsedModemProfile:", TinyTUS.currentlyUsedModemProfile);

    if (!wasmLoaded) {
        console.warn("  Bailing - WASM not loaded yet.");
        console.groupEnd();
        return;
    }

    if (!TinyTUS.currentlyUsedModemProfile) {
        console.warn("  Bailing - currentlyUsedModemProfile is null/undefined.");
        console.groupEnd();
        return;
    }

    if (TinyTUS._initializationInProgress) {
        console.warn("  Bailing - initialization already in progress.");
        console.groupEnd();
        return;
    }

    // Pri zamietnutom mikraku nevolaj stale dokola init.
    if (micPermissionDenied && reason !== "retry-microphone") {
        console.warn("  Bailing - microphone permission is denied; waiting for explicit retry.");
        console.groupEnd();
        return;
    }

    console.log("  All checks passed - calling tryStartListeningForIncomingMessages...");
    console.groupEnd();

    const demodulationProfiles = getAllModemProfilesForDemodulation();
    if (!demodulationProfiles.length && TinyTUS.currentlyUsedModemProfile) {
        demodulationProfiles.push(TinyTUS.currentlyUsedModemProfile);
    }

    const error = await TinyTUS.tryStartListeningForIncomingMessages(
        demodulationProfiles,
        (event) => {
            window.dispatchEvent(new CustomEvent("audioprocess", {
                "detail": { inputBuffer: event.inputBuffer }
            }));
        }
    );

    if (error != null) {
        console.error(`[INIT #${callId}] tryStartListening returned error:`, error.name, error.message, error);
        setMicStatus("blocked");

        let errorMsg = "Nepodarilo sa spustiť prijímanie správ: ";
        if (error.name === 'NotAllowedError') {
            micPermissionDenied = true;
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
        micPermissionDenied = false;
        console.log(`[INIT #${callId}] tryStartListening returned null (success or waiting-for-gesture).`);
    }
};

// Odomknutie po interakcii pouzivatela.

function enableUserInteraction() {
    if (hasUserInteracted) return;
    hasUserInteracted = true;
    console.log("[MIC] First user interaction detected.");

    if (wasmLoaded) {
        console.log("[MIC] WASM already loaded - triggering initStateUpdate from user interaction.");
        initStateUpdate("first-user-interaction");
    } else {
        console.log("[MIC] WASM not yet loaded - initStateUpdate will fire from wasm-library-loaded.");
    }
}

document.addEventListener('click', enableUserInteraction, { once: true });
document.addEventListener('keydown', enableUserInteraction, { once: true });

// Listenery okien.

const handleWasmLibraryLoaded = async () => {
    console.log("[EVENT] wasm-library-loaded fired. Setting wasmLoaded = true.");
    wasmLoaded = true;
    await initStateUpdate("wasm-library-loaded");
};

window.addEventListener("wasm-library-loaded", handleWasmLibraryLoaded);

if (TinyTUS.isLibraryLoaded()) {
    // WASM bol nacitany skor, nez sa registroval listener.
    wasmLoaded = true;
    initStateUpdate("wasm-already-loaded-on-register");
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
    // Reset flagu, aby retry realne prebehol.
    micPermissionDenied = false;
    TinyTUS._initializationInProgress = false;
    await initStateUpdate("retry-microphone");
});

window.addEventListener("microphone-waiting-for-gesture", () => {
    console.log("[MIC] microphone-waiting-for-gesture - AudioContext needs a user gesture.");
    displayMessageAtBottom(systemMessage(
        "Kliknite kdekoľvek na stránku pre aktiváciu mikrofónu.", "info"
    ));
});

let _lastMicDeviceLabel = undefined;

window.addEventListener("microphone-started", (event) => {
    console.log("[MIC] microphone-started - audio graph connected and running.");
    const deviceLabel = event.detail?.deviceLabel ?? null;
    if (deviceLabel === _lastMicDeviceLabel) return;
    _lastMicDeviceLabel = deviceLabel;
    const deviceText = deviceLabel ? `<b>${escapeHtml(deviceLabel)}</b>` : "neznáme zariadenie";
    displayMessageAtBottom(systemMessage(`Prijímanie spustené na: ${deviceText}`, "info"));
});

window.addEventListener("mic-blocked", () => {
    console.error("[MIC] mic-blocked event received.");
    setMicStatus("blocked");
});

window.addEventListener("message-received", (event) => {
    console.log("[MSG] message-received, byte length:", event.detail.bytes.length);
    const bytes = event.detail.bytes;
    const profileMeta = {
        ...getModemProfileMeta(event.detail.profile),
        profile: event.detail.profile,
    };
    const textDecoder = new TextDecoder("utf-8");
    const decodedText = textDecoder.decode(new Uint8Array(bytes));
    const newMessage = createUserMessage("Niekto", CONST.ALIGMENT_LEFT, decodedText, profileMeta);
    attachAddProfileActionIfCode(newMessage, decodedText);
    displayMessageAtBottom(newMessage);
});

window.addEventListener("bytes-received", (event) => {
    console.log("[BYTES] bytes-received, byte length:", event.detail.bytes.length);
    const bytes = event.detail.bytes;
    const profile = event.detail.profile;
    const textDecoder = new TextDecoder("utf-8");
    const decodedText = textDecoder.decode(new Uint8Array(bytes));

    if (!currentIncomingStreamedMessage) {
        // Vytvor novu spravu pri prvych bajtoch.
        const profileMeta = {
            ...getModemProfileMeta(profile),
            profile: profile,
        };
        currentIncomingStreamedMessage = createUserMessage("Niekto", CONST.ALIGMENT_LEFT, decodedText, profileMeta);
        displayMessageAtBottom(currentIncomingStreamedMessage);
    } else {
        // Pripoj nove znaky k existujucej sprave.
        currentIncomingStreamedMessage.content += decodedText;
        const textElement = currentIncomingStreamedMessage.bubble.querySelector(".msg-text");
        if (textElement) {
            textElement.textContent = currentIncomingStreamedMessage.content;
        }
    }
});

window.addEventListener("message-received-complete", (event) => {
    // Tato udalost sa aktivuje iba v pripade, ze sprava bola uplne prijata.
    // Vynuluj stav streamujucej spravy.
    currentIncomingStreamedMessage = null;
});

window.addEventListener("chat-share-profile", (event) => {
    const profileCode = event.detail?.profileCode;
    if (!profileCode) return;

    // Na zdielanie profilu pouzijeme predvoleny profil,
    // ktory by mal podporovat vacsinu prostredi.
    const message = createSelfMessage(profileCode, null, TinyTUS.DEFAULT_MODEM_PROFILE);
    displayMessageAtBottom(message);
    sendMessage(message);
});

window.addEventListener("wasm-library-failed", () => {
    console.error("[EVENT] wasm-library-failed - WASM could not be loaded.");
    wasmLoaded = false;
    setMicStatus("blocked");
    displayMessageAtBottom(systemMessage("Načítavanie externých knižníc zlyhalo. Pokúste sa reštartovať stránku, alebo ak chyba pretrváva, kontaktujte správcu.", "error"));
});

window.addEventListener("usb-device-connected", (event) => {
    console.log("[USB] Device connected:", event.detail.device.productName);
    const safeName = escapeHtml(event.detail.device.productName || "USB Zariadenie");
    const message = systemMessage(
        `USB zariadenie pripojené: <span class="usb-device-name-ref">${safeName}</span>`,
        "info"
    );

    const deviceNameRef = message.querySelector(".usb-device-name-ref");
    if (deviceNameRef) {
        deviceNameRef.setAttribute("role", "button");
        deviceNameRef.setAttribute("tabindex", "0");
        deviceNameRef.addEventListener("click", openSettingsTab);
        deviceNameRef.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openSettingsTab();
            }
        });
    }

    displayMessageAtBottom(message);
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

// Login.

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
