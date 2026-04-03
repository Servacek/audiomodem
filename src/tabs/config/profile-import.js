// QR skener a import modal pre profily.

import { validateProfileCode, applyProfileCodeToModemProfile } from './profile-tlv.js';
import { addProfileToStore } from './profile-store.js';
import { ModemProfile } from '../../../libs/tinytus/modem_profile.js';

// --- DOM ---

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

// --- Validacne UI ---

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

// --- QR skener ---

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
            if (scanStatus) scanStatus.textContent = 'QR kód bol načítaný.';
            await stopScanner();
            return;
        }
    } catch (e) {
        if (scanStatus) scanStatus.textContent = 'QR skenovanie sa nepodarilo spustiť.';
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
        scanStatus.textContent = 'QR skenovanie nie je podporované v tomto prehliadači.';
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
        scanStatus.textContent = 'Namierte kameru na QR kód profilu.';
        scanVideo.srcObject = scanStream;
        await scanVideo.play();
        scanTimer = setTimeout(scanFrame, 200);
    } catch (e) {
        scannerField.style.display = 'block';
        scanStatus.textContent = 'Kameru sa nepodarilo spustiť alebo QR skenovanie nie je podporované.';
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
        scanUnavailableReason = 'QR skenovanie nie je dostupné, pretože prehliadač nepodporuje prístup ku kamere.';
        return updateScanAvailabilityUI();
    }
    if (!('BarcodeDetector' in window)) {
        scanUnavailableReason = 'QR skenovanie nie je dostupné, pretože prehliadač nepodporuje detekciu QR kódov.';
        return updateScanAvailabilityUI();
    }
    try {
        const formats = BarcodeDetector.getSupportedFormats ? await BarcodeDetector.getSupportedFormats() : ['qr_code'];
        if (!formats.includes('qr_code')) scanUnavailableReason = 'QR skenovanie nie je dostupné, pretože v tomto prehliadači nie je podporovaný formát qr_code.';
    } catch {
        scanUnavailableReason = 'QR skenovanie nie je dostupné, pretože sa nepodarilo zistiť podporu QR kódov.';
    }
    updateScanAvailabilityUI();
}

// --- Modal ---

function resetModal() {
    if (modalInput) modalInput.value = '';
    if (scanStatus) scanStatus.textContent = 'Namierte kameru na QR kód.';
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
        updateValidationUI({ valid: false, message: 'Kód profilu je neplatný.' });
        refreshModalState();
        return;
    }

    const added = addProfileToStore(mp);
    if (!added) {
        updateValidationUI({ valid: false, message: 'Profil sa nepodarilo pridat.' });
        refreshModalState();
        return;
    }

    window.dispatchEvent(new CustomEvent('profile-store-changed', {
        detail: { profileId: added.id }
    }));
    closeImportModal();
}

// --- Init ---

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
