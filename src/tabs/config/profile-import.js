// TLV kodovanie/dekodovanie profilov a import modal s QR skenerom.

import { TinyTUS } from '../../../libs/tinytus/tinytus.js';
import { ModemProfile } from '../../../libs/tinytus/modem_profile.js';
import { addProfileToStore, setActiveProfile } from './profile-store.js';
import { wasmValidateProfile } from './profile-validation.js';

// ─── DOM ──────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const importModal            = $('import-profile-modal');
const modalInput             = $('import-profile-modal-input');
const validationText         = $('import-profile-validation-text');
const scanButton             = $('import-profile-scan-button');
const scanUnavailableNote    = $('import-profile-scan-unavailable-note');
const scannerField           = $('import-profile-scanner-field');
const scanVideo              = $('import-profile-video');
const scanStatus             = $('import-profile-scan-status');
const cancelButton           = $('import-profile-cancel-button');
const confirmButton          = $('import-profile-confirm-button');
const triggerButton          = $('import-profile-trigger-button');

let scanStream = null;
let scanTimer  = null;
let barcodeDetector = null;
let scanUnavailableReason = '';

// ─── TLV kódovanie ────────────────────────────────────────────────────────────

function bytesToCode(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function getModemProfileTLVCode(mp) {
    if (!mp?.ptr || !TinyTUS.EXPORTS?.mp_encode_tlv || !TinyTUS.EXPORTS?.malloc || !TinyTUS.EXPORTS?.free) {
        return '';
    }

    const maxSize =
        TinyTUS.CONSTS?.U32_MODEM_PROFILE_TLV_MAX_BYTES ||
        TinyTUS.CONSTS?.U32_MODEM_PROFILE_MAX_TLV_BYTES ||
        512;

    const ptr = TinyTUS.EXPORTS.malloc(maxSize);
    if (!ptr) return '';

    try {
        const outLen = TinyTUS.EXPORTS.mp_encode_tlv(mp.ptr, ptr, maxSize);
        if (!outLen) return '';
        return bytesToCode(new Uint8Array(TinyTUS.EXPORTS.memory.buffer, ptr, outLen).slice());
    } finally {
        TinyTUS.EXPORTS.free(ptr);
    }
}

function codeToBytes(code) {
    const normalized = (code || '').replace(/[\s:-]/g, '');
    if (!normalized) return null;

    if (/^[0-9A-Fa-f]+$/.test(normalized) && normalized.length % 2 === 0) {
        const out = new Uint8Array(normalized.length / 2);
        for (let i = 0; i < out.length; i++) {
            out[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    if (!/^[A-Za-z0-9_-]+$/.test(normalized)) return null;

    try {
        const base64 = normalized.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((normalized.length + 3) % 4);
        const binary = atob(base64);
        return Uint8Array.from(binary, ch => ch.charCodeAt(0));
    } catch {
        return null;
    }
}

export function applyProfileCodeToModemProfile(modemProfile, code) {
    const bytes = codeToBytes(code);
    if (!TinyTUS.EXPORTS?.mp_decode_tlv || !bytes || !TinyTUS.EXPORTS?.malloc || !TinyTUS.EXPORTS?.free) return false;

    const ptr = TinyTUS.EXPORTS.malloc(bytes.length);
    if (!ptr) return false;

    try {
        new Uint8Array(TinyTUS.EXPORTS.memory.buffer, ptr, bytes.length).set(bytes);
        if (TinyTUS.EXPORTS.mp_decode_tlv(modemProfile.ptr, ptr, bytes.length) !== 0) return false;
        // Dekodovanie uspesne - overime ze hodnoty su platne podla WASM.
        return wasmValidateProfile(modemProfile);
    } catch {
        return false;
    } finally {
        TinyTUS.EXPORTS.free(ptr);
    }
}

// ─── Validacia kódu ───────────────────────────────────────────────────────────

export function validateProfileCode(code) {
    const trimmed = (code || '').trim();
    if (!trimmed) return { valid: false, message: '' };

    const bytes = codeToBytes(trimmed);
    if (!bytes) return { valid: false, message: 'Kod nema spravny format.' };
    if (!TinyTUS.EXPORTS?.mp_decode_tlv) return { valid: false, message: 'Kniaznica este nie je nacitana.' };

    const temp = new ModemProfile();
    try {
        return applyProfileCodeToModemProfile(temp, trimmed)
            ? { valid: true, message: 'Kód profilu je platný.' }
            : { valid: false, message: 'Kód profilu je neplatný.' };
    } finally {
        temp.destroy();
    }
}

export function isValidProfileCode(code) {
    return validateProfileCode(code).valid;
}

export function isProfileSameAsDefault(mp) {
    const defaultMp = TinyTUS.DEFAULT_MODEM_PROFILE;
    if (!mp || !defaultMp) return false;
    const a = getModemProfileTLVCode(mp);
    const b = getModemProfileTLVCode(defaultMp);
    if (a && b) return a === b;
    try { return JSON.stringify(mp.toObject()) === JSON.stringify(defaultMp.toObject()); } catch { return false; }
}

// ─── Pridanie profilu z kódu ──────────────────────────────────────────────────

export function addProfileFromCodeAndActivate(code) {
    const trimmed = (code || '').trim();
    if (!validateProfileCode(trimmed).valid) return false;

    const mp = new ModemProfile();
    if (!applyProfileCodeToModemProfile(mp, trimmed)) {
        mp.destroy();
        return false;
    }

    const added = addProfileToStore(mp);
    if (!added?.modemProfile) return false;

    setActiveProfile(added.modemProfile);
    return true;
}

// ─── Validation UI ───────────────────────────────────────────────────────────

function updateValidationUI(validation) {
    if (!validationText) return;
    if (!validation.message) {
        validationText.style.visibility = 'hidden';
        validationText.classList.remove('is-valid', 'is-invalid');
        validationText.textContent = '';
        return;
    }
    validationText.style.visibility = 'visible';
    validationText.classList.toggle('is-valid', validation.valid);
    validationText.classList.toggle('is-invalid', !validation.valid);
    validationText.innerHTML = validation.valid
        ? `<i class="fas fa-circle-check"></i> ${validation.message}`
        : `<i class="fas fa-triangle-exclamation"></i> ${validation.message}`;
}

function refreshModalState() {
    if (!confirmButton || !modalInput) return;
    const validation = validateProfileCode(modalInput.value);
    updateValidationUI(validation);
    confirmButton.disabled = !validation.valid;
}

// ─── QR skener ────────────────────────────────────────────────────────────────

async function stopScanner() {
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (scanVideo) { scanVideo.pause(); scanVideo.srcObject = null; }
    if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
    if (scannerField) scannerField.style.display = 'none';
}

async function scanFrame() {
    if (!barcodeDetector || !scanVideo || scanVideo.readyState < 2) {
        scanTimer = setTimeout(scanFrame, 250);
        return;
    }
    try {
        const barcodes = await barcodeDetector.detect(scanVideo);
        const code = barcodes.find(b => b.rawValue)?.rawValue?.trim();
        if (code) {
            if (modalInput) modalInput.value = code;
            refreshModalState();
            if (scanStatus) scanStatus.textContent = 'QR kod bol nacitany.';
            await stopScanner();
            return;
        }
    } catch (e) {
        if (scanStatus) scanStatus.textContent = 'QR skenovanie sa nepodarilo spustit.';
        console.warn('QR scan failed:', e);
        return;
    }
    scanTimer = setTimeout(scanFrame, 250);
}

async function startScanner() {
    if (!scannerField || !scanVideo || !scanStatus) return;
    if (scanUnavailableReason) return updateScanAvailabilityUI();

    if (!('BarcodeDetector' in window)) {
        scannerField.style.display = 'block';
        scanStatus.textContent = 'QR skenovanie nie je podporovane v tomto prehliadaci.';
        return;
    }

    try {
        if (!barcodeDetector) {
            const formats = BarcodeDetector.getSupportedFormats ? await BarcodeDetector.getSupportedFormats() : ['qr_code'];
            if (!formats.includes('qr_code')) throw new Error('qr_code not supported');
            barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
        }
        await stopScanner();
        scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        scannerField.style.display = 'block';
        scanStatus.textContent = 'Namierte kameru na QR kod profilu.';
        scanVideo.srcObject = scanStream;
        await scanVideo.play();
        scanTimer = setTimeout(scanFrame, 200);
    } catch (e) {
        scannerField.style.display = 'block';
        scanStatus.textContent = 'Kameru sa nepodarilo spustit alebo QR skenovanie nie je podporovane.';
        console.warn('Failed to start QR scanner:', e);
    }
}

function updateScanAvailabilityUI() {
    if (scanButton) scanButton.disabled = !!scanUnavailableReason;
    if (scanUnavailableNote) {
        scanUnavailableNote.textContent = scanUnavailableReason;
        scanUnavailableNote.style.display = scanUnavailableReason ? 'block' : 'none';
    }
}

async function initScanAvailability() {
    scanUnavailableReason = '';
    if (!navigator.mediaDevices?.getUserMedia) {
        scanUnavailableReason = 'QR skenovanie nie je dostupne, pretoze prehliadac nepodporuje pristup ku kamere.';
        return updateScanAvailabilityUI();
    }
    if (!('BarcodeDetector' in window)) {
        scanUnavailableReason = 'QR skenovanie nie je dostupne, pretoze prehliadac nepodporuje detekciu QR kodov.';
        return updateScanAvailabilityUI();
    }
    try {
        const formats = BarcodeDetector.getSupportedFormats ? await BarcodeDetector.getSupportedFormats() : ['qr_code'];
        if (!formats.includes('qr_code')) scanUnavailableReason = 'QR skenovanie nie je dostupne, pretoze v tomto prehliadaci nie je podporovany format qr_code.';
    } catch {
        scanUnavailableReason = 'QR skenovanie nie je dostupne, pretoze sa nepodarilo zistit podporu QR kodov.';
    }
    updateScanAvailabilityUI();
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function resetModal() {
    if (modalInput) modalInput.value = '';
    if (scanStatus) scanStatus.textContent = 'Namierte kameru na QR kod.';
    if (scannerField) scannerField.style.display = 'none';
    updateValidationUI({ valid: false, message: '' });
    refreshModalState();
    updateScanAvailabilityUI();
}

export function openImportModal() {
    if (!importModal) return;
    importModal.style.display = 'flex';
    resetModal();
    modalInput?.focus();
}

export function closeImportModal() {
    stopScanner();
    if (importModal) importModal.style.display = 'none';
}

function doImport() {
    const code = modalInput?.value?.trim() || '';
    if (!code) return;

    const validation = validateProfileCode(code);
    if (!validation.valid) { updateValidationUI(validation); refreshModalState(); return; }

    const mp = new ModemProfile();
    if (!applyProfileCodeToModemProfile(mp, code)) {
        mp.destroy();
        updateValidationUI({ valid: false, message: 'Kod profilu je neplatny.' });
        refreshModalState();
        return;
    }

    addProfileToStore(mp);
    window.dispatchEvent(new CustomEvent('profile-store-changed'));
    closeImportModal();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initImportModal() {
    triggerButton?.addEventListener('click', openImportModal);
    cancelButton?.addEventListener('click', closeImportModal);
    confirmButton?.addEventListener('click', doImport);
    importModal?.addEventListener('click', e => { if (e.target === importModal) closeImportModal(); });
    modalInput?.addEventListener('input', refreshModalState);
    modalInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doImport(); } });
    scanButton?.addEventListener('click', startScanner);

    refreshModalState();
    initScanAvailability();
}
