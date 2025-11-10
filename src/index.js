

// import {modulateStringToWaveform, FSK, encodeStringToBits} from './modulator.js';
// import {decodeBitsToString, getPeakFrequency} from './demodulator.js';
import * as WASM from './bindings.js';
import * as CONST from './constants.js';
import {nextPow2, max, formatDate} from './utils.js';

import { plotWaveform } from './plotter.js';

// TODO: Disable the send button when no content is available.
// Provide the send button also on mobile in some minimazed form.


////////////////////

const inputArea = document.getElementById("input-area");
const inputBar = document.getElementById("input-bar");
const messageArea = document.getElementById("message-area");
const sendMessageButton = document.getElementById("send-message-button");

const bufferSizeInput = document.getElementById("buffer-size-input");

////////////////////

var messagesToSend = [];
var currentlySendingMessage = null;

const textEndcoder = new TextEncoder("utf-8");

////////////////////

let rxRecording = false; // DEBUGGING
// let receivedBytes = new Uint8Array(512);
let bitsReceivedStr = "";
let prevByte = null;
let choosing = "left";
let noDataCounter = 0;
// let currentByte = -1;
// let currentBit = 0;

let port;
let writer;

function onTransmissionEnded(buffer) {
    console.log("Transmission ended!");
    noDataCounter = 0;
    rxRecording = false;

    if (bitsReceivedStr.trim().length == 0) {
        console.log("NO BITS RECEIVED\n");
        bitsReceivedStr = "";
        return;
    }


    // print(bitsReceivedStr);
    // Convert the bits received string to an actual string
    let receivedString = new TextDecoder("utf-8").decode(
        new Uint8Array(bitsReceivedStr.match(/.{1,8}/g).map(byte => parseInt(byte, 2)).filter(byte => !isNaN(byte)))
    );
    console.log("Received String:", receivedString);
    bitsReceivedStr = "";

    if (receivedString && receivedString.trim().length > 0) {
        const authorId = buffer[1];
        const MAX_USERS = WASM.MEMORY[WASM.EXPORTS.MAX_USERS.value];
        // if (authorId < 0 || authorId >= MAX_USERS) {
        //     console.log("Invalid author ID:", authorId);
        //     return;
        // }

        // TODO: Add option to assign names to IDs in the config tab.
        const nameInput = document.getElementById("channel-name-" + authorId);
        //const authorName = nameInput ? nameInput.value.trim() : String(authorId);
        const authorName = "Starý Medvěd";

        const msg = createUserMessage(authorName, CONST.ALIGMENT_LEFT, receivedString.trim())
        const COLORS = ["#ffc107", "#ff6e6e", "#8bc34a", "#45a2ff", "grey"];
        msg.icon.style.color = msg.username.style.color = COLORS[authorId || (COLORS.length - 1)];
        displayMessageAtBottom(msg);
    }
}

function onChunkReceived(chunk) {
    // TODO: Replace this with a dedicated CONFIG object.
    const BITS_PER_FRAME = WASM.MEMORY[WASM.EXPORTS.BITS_PER_FRAME.value];

    // print("CHUNK", chunk.length);

    const N = nextPow2(chunk.length);
    const startPtr = WASM.MEMORY_STACK_START;
    const realPtr = startPtr;
    const imagPtr = realPtr + N*4;
    const bytesPtr = imagPtr + N*4;

    WASM.MEMORY_F32.set(chunk, realPtr>>2);

    // Make sure the imginary array is filled with zeros.
    // Also fill the rest of the real array padded to the nearest power of 2.
    WASM.MEMORY_F32.fill(0, (imagPtr - (N - chunk.length) * 4)>>2, bytesPtr>>2);

    // Assert that the real array is filled with the input chunk
    for (let i = 0; i < chunk.length; i++) {
        console.assert(WASM.MEMORY_F32[realPtr / 4 + i] === chunk[i], "Real memory incorrectly filled at index", i);
    }

    // Assert that the imaginary array is filled with zeros
    for (let i = imagPtr >> 2; i < bytesPtr >> 2; i++) {
        console.assert(WASM.MEMORY_F32[i] === 0, "Imaginary memory incorrectly filled at index", i);
    }

    let lastBytePtr = null;

    let leftByteBuffer = null;
    lastBytePtr = WASM.EXPORTS.demodulate(startPtr, Math.floor(N/2), bytesPtr);
    leftByteBuffer = WASM.MEMORY.slice(bytesPtr, lastBytePtr+1);

    WASM.MEMORY_F32.set(chunk, realPtr>>2);

    // Make sure the imginary array is filled with zeros.
    // Also fill the rest of the real array padded to the nearest power of 2.
    WASM.MEMORY_F32.fill(0, (imagPtr - (N - chunk.length) * 4)>>2, bytesPtr>>2);

    let rightByteBuffer = null;
    lastBytePtr = WASM.EXPORTS.demodulate(startPtr + ((Math.floor(N/2) + (N % 2)) * 4), Math.floor(N/2) + (N % 2), bytesPtr);
    rightByteBuffer = WASM.MEMORY.slice(bytesPtr, lastBytePtr+1);

    const buffers = {left: leftByteBuffer, right: rightByteBuffer};
    if (buffers[choosing][0] == CONST.CBYTE.NDA ||
        (buffers[choosing][0] == CONST.CBYTE.SXT && rxRecording) ||
        (buffers[choosing][0] == CONST.CBYTE.EXT && !rxRecording)
    ) {
        // The chosen buffer has no data so choose the other one.
        choosing = choosing == "right" ? "left" : "right";
    }

    const buffer = buffers[choosing];

    // print("LEFT", leftByteBuffer);
    // print("RIGHT", rightByteBuffer);

    const controlByte = buffer[0];
    if (controlByte == CONST.CBYTE.NDA) {
        if (rxRecording) {
            // This should not happen, it means that both buffers are empty.
            // Add at least some zeros to the result so we do not mess up the bits.
            bitsReceivedStr += "0" * BITS_PER_FRAME;
            noDataCounter += 1;
            if (noDataCounter >= 3) {
                console.log("No data for three consecutive chunks. Ending transmission.");
                onTransmissionEnded(buffer)
                // rxRecording = false;
                // noDataCounter = 0;
                // bitsReceivedStr = "";
                //return;
            }
        }
        return; // No data available
    } else if (controlByte == CONST.CBYTE.SXT) {
        if (!rxRecording) {
            console.log("Transmission started!");
            noDataCounter = 0;
            rxRecording = true;
            // receivedBytes.fill(0);
        }
    } else if (controlByte == CONST.CBYTE.EXT) {
        if (rxRecording) {
            onTransmissionEnded(buffer);
        }
    } else if (controlByte == CONST.CBYTE.DXA) {
        noDataCounter = 0;
        if (rxRecording) {
            // let bitsLeft = BITS_PER_FRAME;
            for (let ptr = 1; ptr <= lastBytePtr - bytesPtr; ptr++) {
                // print("PTR", ptr);
                // if (receivedBytes.length == 0 || currentBit > 7) {
                //     currentBit = 0;
                //     currentByte += 1;
                // }

                // const freeBitsInCurByte = 8 - currentBit;
                // const nBitsToAdd = Math.min(8, bitsLeft)
                // const nBitsActuallyAdded = Math.min(nBitsToAdd, freeBitsInCurByte);
                // const nBitsLeftOut = nBitsToAdd - nBitsActuallyAdded;
                const bitsToAdd = buffer[ptr];
                const bitsToAddStr = bitsToAdd.toString(2).padStart(BITS_PER_FRAME, '0');
                bitsReceivedStr += bitsToAddStr;
                print("RECEIVED BITS: ", bitsToAddStr)

                // receivedBytes[currentByte] |= bitsToAdd >> nBitsLeftOut;
                // currentBit += nBitsActuallyAdded
                // bitsLeft -= nBitsActuallyAdded

                // if (nBitsLeftOut > 0) {
                //     const mask = (1 << nBitsLeftOut) - 1;
                //     receivedBytes[currentByte++] |= (bitsToAdd & mask) << currentBit;
                // }
            }
            // const fullBytes = ((bytesPtr + 1) - lastBytePtr) - 1
            // for (let i = 0; i < fullBytes; i++) { // Handle the full bytes first.
            //     receivedBytes.push(WASM.MEMORY[(bytesPtr + 1) + i])
            // }

            // const BITS_LEFT = BITS_PER_FRAME - (fullBytes * 8);

            // console.log("Received bytes:", receivedBytes);
        }
    } else {
        console.warn("Unknown control byte:", controlByte);
    }
}

async function tryStartRecording() {
    // TODO:?
    if (!navigator.mediaDevices) {
        // There are no mediaDevices, PANIC!!
        displayMessageAtBottom(systemMessage("Žiadne zvukové médium na príjem správ nebolo nájdené! Správy nebudú príjimané.", "warn"));
        window.dispatchEvent(new Event('recording-start-failed'));
        return;
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
    }).then(function(stream) {
        const context = new AudioContext({
            latencyHint: "balanced",
            sampleRate: 48000,
        });
        const mediaStreamSource = context.createMediaStreamSource(stream);
        // const mediaRecorder = new MediaRecorder(stream, {
        //     //mimeType: "audio",
        // })

        // mediaRecorder.setAudioSamplingRate(48000);
        // console.log(mediaRecorder.getAudioSamplingRate());

        // https://ciiec.buap.mx/FFT.js/
        // rounded to nearest power of 2

        // const sampleRate = context.sampleRate;
        // console.log(`Sample rate set to ${sampleRate} Hz.`);

        // Let the system decide which bufferSize is the best for us,
        // since we are using our own buffer anyways.
        const bufferSize = 0//2048;//Math.pow(2, Math.floor(Math.log2(SAMPLE_CHUNK_SIZE)));
        var recorder = context.createScriptProcessor(bufferSize, CONST.INPUT_CHANNELS, CONST.OUTPUT_CHANNELS)

        let chunkBuffer = []; // Has to be mutable because we are overriding it.
        recorder.onaudioprocess = function (e) {
            // This seems to be already normalized which makes sense.
            // Input buffer seems to be 1024 samples long (ALWAYS).
            const inputBuffer = e.inputBuffer.getChannelData(0);


            // WASM.MEMORY_U32[WASM.EXPORTS.SAMPLE_CHUNK_SIZE/4];
            const SAMPLE_CHUNK_SIZE = bufferSizeInput.value;
            const BITS_PER_FRAME = WASM.MEMORY_U32[WASM.EXPORTS.BITS_PER_FRAME/4];

            if (chunkBuffer.length < SAMPLE_CHUNK_SIZE) {
                chunkBuffer.push(...inputBuffer);
            } else {
                for (let i = 0; i < Math.floor(chunkBuffer.length / SAMPLE_CHUNK_SIZE); i++) {
                    let chunk = chunkBuffer.slice(0, SAMPLE_CHUNK_SIZE)
                    chunkBuffer = chunkBuffer.slice(SAMPLE_CHUNK_SIZE);

                    // Ensure we are not listening to ourselves!!!
                    if (currentlySendingMessage == null) {
                        onChunkReceived(chunk);
                    }
                }
            }

            window.dispatchEvent(new CustomEvent("audioprocess", {
                "detail": {inputBuffer: inputBuffer}
            }));
        }

        mediaStreamSource.connect(recorder);
        recorder.connect(context.destination);

        window.dispatchEvent(new Event('recording-started'));
    }).catch(function (e) { // This should handle even the revokes and everything.
        // TODO: Handle not being allowed to record audio.
        // console.error(e);
        // console.error("WE CANNOT RECORD AUDIO, WHAT CAN WE DO???!!");
        // console.error("IMPLEMENT WRITE ONLY MODE FOR ONE DIRECTIONAL COMMUNICATION!!!");

        if (e.name === "NotAllowedError" || e.name === "SecurityError") {
            displayMessageAtBottom(systemMessage("Chýba oprávnenia na používanie mikrofónu, bez tohto oprávnenia nebudete môcť príjimať správy!", "warn"));
        } else {
            displayMessageAtBottom(systemMessage("Chyba pri nahrávaní: " + e.message, "error"))
        }

        window.dispatchEvent(new Event('recording-start-failed'));
    });
}

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
        const buffer = audioContext.createBuffer(1, nextMessageWaveform.length, CONST.SAMPLING_FREQUENCY);
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
            clearInterval(intervalId);
            currentlySendingMessage.dispatchEvent(new Event("sent"));
            currentlySendingMessage = null;
            if (messagesToSend.length <= 0 && writer) {
                setTimeout(() => {
                    const encoder = new TextEncoder();
                    writer.write(encoder.encode("0"));
                }, 700)
            }

            sendNextMessage();
        };
    }
}

function sendMessage(message) {
    messagesToSend.push(message)
    message.progressBar.style.display = "block";
    message.bubble.classList.add("sending");
    message.addEventListener("sent", () => {
        message.bubble.classList.remove("sending");
        message.progressBar.style.display = "none";
    })

    if (!currentlySendingMessage && writer) {
        const encoder = new TextEncoder();
        writer.write(encoder.encode("1"));
        setTimeout(() => sendNextMessage(), 700);
    } else {
        sendNextMessage();
    }
}

// TODO: This is temporary until we decide on the design.
const sendMessageButtonWithIcon = document.getElementById("send-message-button-with-icon");

inputBar.oninput = function() {
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

function createSelfMessage(text, image=null) {
    const username = getUsername();
    const message = createUserMessage(username, CONST.ALIGMENT_RIGHT, text);

    if (image != null) {
        addImageToMessage(message, image);
    }

    // TODO: So the javascript version is quite slow,
    // the C version is much faster but still javascript's garbage
    // collector is killing it.

    // OLD WAY
    // msg.waveform = modulateStringToWaveform(content, FSK);

    const progressBar = document.createElement("progress");
    progressBar.value = 0;
    progressBar.max = 100;
    progressBar.style.display = "none";
    message.progressBar = progressBar;
    message.bubble.appendChild(progressBar)

    // TODO: Possible compression here?
    const textByteArray = textEndcoder.encode(text)
    WASM.fillInputBuffer(textByteArray);
    message.waveform = WASM.getOutputBuffer(WASM.EXPORTS.modulate(
        WASM.INPUT_BUFFER_PTR, textByteArray.length, WASM.OUTPUT_BUFFER_PTR
    ));

    const oscillatorWaveform = document.getElementById("oscillator-waveform");
    const displayWaveform = [];
    for (let i = 0; i < message.waveform.length; i += CONST.SAMPLES_PER_FRAME) {
        for (let j = i; j < i + 100; j++) {
            displayWaveform.push(message.waveform[j]);
        }
    }
    plotWaveform(oscillatorWaveform, displayWaveform);


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

    // A new message was received but
    if (messageArea.offsetParent === null) {
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

function systemMessage(text, type, icon=null) {
    const msg = createMessageBase();
    msg.classList.add("system-message", "system-message-" + type);
    msg.style.color = CONST.SYSTEM_MESSAGE_COLORS[type];

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
    // There are no mediaDevices, PANIC!!
    alert("Neboli detekované žiadne mediálne zariadenia potrebné pre príjimanie a odosielanie údajov alebo pre funkčnosť oscilátora. Možno pomôže opätovne načítať stránku.");
    if (confirm("Načítať stránku znova?")) {
        location.reload();
    }
}

let userLoggedIn = false;
let wasmLoaded = false;

const initStateUpdate = () => {
    if (userLoggedIn && wasmLoaded) {
        tryStartRecording();
    }
}

window.addEventListener("user-logged", () => {
    userLoggedIn = true;
    if (!window.matchMedia("(max-width: 512px)").matches) {
        inputBar.focus(); // Default focus
    };

    const configButtonIcon = document.getElementById("config-button").getElementsByTagName("i")[0]
    const configButtonRef = "<div id='config-button-ref' onclick='document.getElementById(\"config-button\").click()'>" + configButtonIcon.outerHTML + "</div>";
    const welcomeMessage = systemMessage("Vitaj <span id='username-text'>" + getUsername() + "</span>! Svoju prezývku si môžeš kedykoľvek zmeniť v nastaveniach" + configButtonRef, "welcome");
    displayMessageAtBottom(welcomeMessage);
    initStateUpdate();
});

document.getElementById("connect-usb-device-button").addEventListener("click", async () => {
    try {
        port = await navigator.serial.requestPort(); // Request serial port
        await port.open({ baudRate: 9600 }); // Open port at 9600 baud
        writer = port.writable.getWriter();
    } catch (error) {
        console.error("Error connecting to serial port:", error);
    }
});

////////// WASM

WASM.load();

WASM.requiresLoadedWASM(() => {
    wasmLoaded = true;
    initStateUpdate();
})

window.addEventListener("wasm-library-failed", () => {
    wasmLoaded = false;
    displayMessageAtBottom(systemMessage("Načítavanie externých knižníc zlyhalo. Pokúste sa reštartovať stránku, alebo ak chyba pretrváva, kontaktujte správcu.", "error"));
});

// TODO: Add some DB and save/load the messages sent and received.
// displayMessageAtBottom(createUserMessage("SOMEONE", CONST.ALIGMENT_LEFT, "TITIIIDJOIWNDJNWJNDNWODNWNDONWODNOWNODOWDN"))
