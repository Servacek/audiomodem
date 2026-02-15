
import { TinyTUS } from '../libs/tinytus/tinytus.js';

////////////////////

let port = null;

////////////////////

if (!navigator.mediaDevices) {
    // There are no mediaDevices, PANIC!!
    alert("Neboli detekované žiadne mediálne zariadenia potrebné pre príjimanie a odosielanie údajov alebo pre funkčnosť oscilátora. Možno pomôže opätovne načítať stránku.");
    if (confirm("Načítať stránku znova?")) {
        location.reload();
    }
}

const button = document.getElementById("connect-usb-device-button");
const infoDiv = document.getElementById("usb-device-info");

// TODO: TOTO TREBA NAHRADIT KONSTANTAMI Z KNIZNICE
const VENDOR_ID = 0x16c0;
const PRODUCT_ID = 0x05dc;

async function openDevice(device) {
    if (!device) {
        return; // Ziadne zariadenie vybrane, uzivatel pravdepodobne odignoroval vyzvu.
    }

    try {
        await device.open();
        if (device.configuration === null) {
            await device.selectConfiguration(1);
        }
        await device.claimInterface(0);

        infoDiv.textContent = `Pripojené: ${device.productName} (Vendor ID: 0x${device.vendorId.toString(16)})`;
        displayMessageAtBottom(systemMessage(infoDiv.textContent, "info"));
        button.classList.add("paired");
        port = device
    } catch (error) {
        console.error("Error connecting to USB device:", error);
        displayMessageAtBottom(systemMessage("USB zariadenie sa neporadilo spárovať.", "error"));
        port = null;
    }
}

async function tryDisconnectUSB() {
    try {
        await port.close();
    } catch (err) {
        // console.warn("Error closing device:", err);
        // Already disconnected, quite common
    }
    port = null;
    infoDiv.textContent = "";
    button.classList.remove("paired");

    displayMessageAtBottom(systemMessage("USB zariadenie odpojené...", "info"));
}

async function requestUSBDevice(vendorId, productId) {
    try {
        const device = await navigator.usb.requestDevice({
            filters: [{ vendorId: vendorId, productId: productId }]
        });
        return device;
    } catch (error) {
        console.error("Error requesting USB device:", error);
        return null;
    }
}

button.addEventListener("click", async () => {
    if (!port) {
        openDevice(await requestUSBDevice(VENDOR_ID, PRODUCT_ID)); }
    else { tryDisconnectUSB(); }
});

// Zobrazime tlacidlo pre pripojenie USB zariadenia len ak
// prehliadac podporuje WebUSB
if (navigator.usb) {
    button.disabled = false;
    navigator.usb.addEventListener('connect', (event) => {
        if (event.device.vendorId === VENDOR_ID && event.device.productId === PRODUCT_ID) {
            openDevice(event.device);
        }
    });
    navigator.usb.addEventListener("disconnect", (event) => {
        print("USB device disconnected:", event.device);
        if (port && port.vendorId === event.device.vendorId && port.productId === event.device.productId) {
            tryDisconnectUSB();
        }
    });

    document.addEventListener("DOMContentLoaded", () => {
        navigator.usb.getDevices().then(devices => {
            for (const device of devices) {
                if (device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID) {
                    openDevice(device);
                }
            }
        })
    });
} else {
    infoDiv.style.color = "#ff6666";
    infoDiv.textContent = "Táto funkcionalita je podporovaná len v prehliadačoch založených na Chromiume."
}

////////// WASM

window.addEventListener("wasm-library-loaded", () => {
    print("ON LOADED");
});

// Toto kniznica zavola ked uspesne prijme ramec.
TinyTUS.MAPPINGS.on_frame_received = (frame_ptr, frame_len) => {
    const bytes = TinyTUS.getReturnValue("u8", frame_ptr, frame_len);

    console.log("Received frame of length", frame_len, "data:", bytes);

    window.dispatchEvent(new CustomEvent("message-received", {
        "detail": { bytes: bytes }
    }));
}

TinyTUS.loadLibrary();
