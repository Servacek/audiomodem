import { TinyTUS } from '../libs/tinytus/tinytus.js';
import { getUsbAutoProfile } from './tabs/config.js';

let port = null;
let keepaliveInterval = null;

const KEEPALIVE_INTERVAL_MS = 300;

if (!navigator.mediaDevices) {
    alert("Neboli detekované žiadne mediálne zariadenia potrebné pre príjimanie a odosielanie údajov alebo pre funkčnosť oscilátora. Možno pomôže opätovne načítať stránku.");
    if (confirm("Načítať stránku znova?")) location.reload();
}

const button = document.getElementById("connect-usb-device-button");
const buttonSpan = button?.querySelector("span");
const infoDiv = document.getElementById("usb-device-info");
const statusTextDiv = document.getElementById("usb-device-status-text");
const detailsDiv = document.getElementById("usb-device-details");
const usbCard = document.querySelector(".usb-device-card");

function updateUiConnected(device) {
    if (statusTextDiv) statusTextDiv.textContent = "Pripojené";
    if (infoDiv) infoDiv.textContent = device.productName || "USB Zariadenie";
    if (detailsDiv) {
        detailsDiv.textContent =
            `Vendor ID: 0x${device.vendorId.toString(16).toUpperCase()} | ` +
            `Product ID: 0x${device.productId.toString(16).toUpperCase()}`;
    }
    if (button) {
        button.classList.add("paired");
        if (buttonSpan) buttonSpan.textContent = "Odpojiť";
    }
    if (usbCard) usbCard.classList.add("connected");
}

function updateUiDisconnected() {
    if (statusTextDiv) statusTextDiv.textContent = "Nepripojené";
    if (infoDiv) infoDiv.textContent = "Žiadne zariadenie";
    if (detailsDiv) detailsDiv.textContent = "";
    if (button) {
        button.classList.remove("paired");
        if (buttonSpan) buttonSpan.textContent = "Pripojiť";
    }
    if (usbCard) usbCard.classList.remove("connected");
}

async function ensureInterfaceClaimed(device) {
    if (!device.configuration) await device.selectConfiguration(1);
    await device.claimInterface(0);
}

function startKeepalive() {
    if (keepaliveInterval) return; // Already running.

    console.log("Starting USB relay keepalive...");
    keepaliveInterval = setInterval(async () => {
        if (!port) {
            stopKeepalive();
            return;
        }
        try {
            print("KEEP ALIVE SENDING")
            await port.controlTransferOut({
                requestType: "vendor",
                recipient: "device",
                request: TinyTUS.CONSTS.U8_USB_SWITCH_REQUEST_KEEPALIVE,
                value: 0,
                index: 0
            });
        } catch (err) {
            console.error("USB_RELAY_KEEPALIVE failed:", err);
            stopKeepalive();
        }
    }, KEEPALIVE_INTERVAL_MS);
}

function stopKeepalive() {
    if (keepaliveInterval) {
        clearInterval(keepaliveInterval);
        keepaliveInterval = null;
    }
}

async function turnOnUsbRelay() {
    if (!port) return;
    try {
        await ensureInterfaceClaimed(port);
        await port.controlTransferOut({
            requestType: "vendor",
            recipient: "device",
            request: TinyTUS.CONSTS.U8_USB_SWITCH_REQUEST_ON,
            value: 0,
            index: 0
        });
        startKeepalive();
    } catch (err) {
        console.error("USB_RELAY_ON failed:", err);
    }
}

async function turnOffUsbRelay() {
    if (!port) return;
    setTimeout(async () => {
        if (!port) return;
        try {
            await port.controlTransferOut({
                requestType: "vendor",
                recipient: "device",
                request: TinyTUS.CONSTS.U8_USB_SWITCH_REQUEST_OFF,
                value: 0,
                index: 0
            });
            stopKeepalive();
        } catch (err) {
            console.error("USB_RELAY_OFF failed:", err);
        }
    }, 500);
}

window.addEventListener("message-send-started", async () => {
    await turnOnUsbRelay();
});

window.addEventListener("last-message-send-completed", async () => {
    await turnOffUsbRelay();
});

async function openDevice(device) {
    if (!device) return;
    try {
        await device.open();
        await ensureInterfaceClaimed(device);

        port = device;
        window.port = port;

        updateUiConnected(device);


        window.dispatchEvent(new CustomEvent("usb-device-connected", {
            detail: { device }
        }));
    } catch (error) {
        console.error("Error connecting to USB device:", error);
        port = null;
        window.port = null;
        updateUiDisconnected();

        window.dispatchEvent(new CustomEvent("usb-device-connection-failed", {
            detail: { error }
        }));
    }
}

async function tryDisconnectUSB() {
    if (!port) return;

    try {
        try {
            await port.releaseInterface(0);
        } catch {
            // Ignoruj, ak interface nebol claimnuty.
        }
        await port.close();
    } catch {
        // Ignoruj chyby pri zatvarani.
    }

    port = null;
    window.port = null;
    updateUiDisconnected();

    window.dispatchEvent(new CustomEvent("usb-device-disconnected"));
}

async function requestUSBDevice(vendorId, productId) {
    try {
        return await navigator.usb.requestDevice({
            filters: [{ vendorId, productId }]
        });
    } catch (error) {
        console.error("Error requesting USB device:", error);
        return null;
    }
}

if (button) {
    button.addEventListener("click", async () => {
        if (!port) {
            const dev = await requestUSBDevice(
                TinyTUS.CONSTS.U16_USB_SWITCH_VENDOR_ID,
                TinyTUS.CONSTS.U16_USB_SWITCH_PRODUCT_ID
            );
            await openDevice(dev);
        } else {
            await tryDisconnectUSB();
        }
    });
}

if (navigator.usb) {
    if (button) button.disabled = false;

    navigator.usb.addEventListener("connect", async (event) => {
        const d = event.device;
        if (
            d.vendorId === TinyTUS.CONSTS.U16_USB_SWITCH_VENDOR_ID &&
            d.productId === TinyTUS.CONSTS.U16_USB_SWITCH_PRODUCT_ID
        ) {
            await openDevice(d);
        }
    });

    navigator.usb.addEventListener("disconnect", async (event) => {
        console.log("USB device disconnected:", event.device);
        if (
            port &&
            port.vendorId === event.device.vendorId &&
            port.productId === event.device.productId
        ) {
            await tryDisconnectUSB();
        }
    });

    document.addEventListener("DOMContentLoaded", () => {
        TinyTUS.afterLoad(() => {
            navigator.usb.getDevices().then(async (devices) => {
                for (const d of devices) {
                    if (
                        d.vendorId === TinyTUS.CONSTS.U16_USB_SWITCH_VENDOR_ID &&
                        d.productId === TinyTUS.CONSTS.U16_USB_SWITCH_PRODUCT_ID
                    ) {
                        await openDevice(d);
                        break;
                    }
                }
            });
        });
    });
} else {
    if (statusTextDiv) statusTextDiv.textContent = "Nepodporované";
    if (infoDiv) {
        infoDiv.style.color = "#ff6666";
        infoDiv.textContent = "Nepodporované";
    }
    if (detailsDiv) {
        detailsDiv.textContent = "Táto funkcionalita je podporovaná len v prehliadačoch založených na Chromiume.";
    }
    const usbProfileSelector = document.getElementById("usb-profile-selector");
    if (usbProfileSelector) usbProfileSelector.disabled = true;
}

TinyTUS.MAPPINGS.on_frame_received = (frame_ptr, frame_len) => {
    TinyTUS._frameReceivedDuringDemodPass = true;
    const bytes = TinyTUS.getDynamicBufferFromPointer("u8", frame_ptr, frame_len);
    const profile = TinyTUS._activeDemodProfileForCallback || null;
    console.log("Received frame of length", frame_len, "data:", bytes, "profile:", profile);

    if (frame_len == 255) {
        // IMAGE FRAME
        window.dispatchEvent(new CustomEvent("image-frame-received", { detail: { bytes, profile } }));
    } else {
        // REGULAR FRAME
        window.dispatchEvent(new CustomEvent("message-received", { detail: { bytes, profile } }));
    }
};

TinyTUS.loadLibrary();
