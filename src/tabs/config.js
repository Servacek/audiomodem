/**
 * @file config.js
 * @description Sprava modemovych profilov a ich konfiguracie.
 */

import { TinyTUS } from '../../libs/tinytus/tinytus.js';
import { ModemProfile } from '../../libs/tinytus/modem_profile.js';
import { renderFreqPicker, initFreqPickers, updateFreqPickerRange, clearAttenuationData } from '../freq_picker.js';

/* Konstanty */

const MAX_PROFILES = 10;
const MAX_PROFILE_NAME = 24;

const PARAM_LABELS = {
    min_tx_freq: "Frekvenčný offset vysielača",
    sample_rate: "Vzorkovacia frekvencia (Hz)",
    channel_size: "Šírka kanála (Hz)",
    bits_per_tone: "Počet bitov na jeden tón",
    symbols_per_marker: "Počet symbolov na marker",
    bits_in_marker: "Počet tón v markeri",
    tones_per_symbol: "Počet tónov v symbole",
    ecc_percent: "Podiel samoopravných bajtov",
    dss_enabled: "DSS (rozptyl spektra)",
    squelch_thresh: "Squelch prah",
    cphase: "Spojitá fáza",
    max_tx_amp: "Max TX amplitúda (hlasitosť)",
    samples_per_symbol: "Počet vzorkov na jeden symbol",
};

/* Stav a DOM referencie */

let profiles = [];
let profileToDelete = null;
let _stickyObservers = [];

const $ = id => document.getElementById(id);
const container = $('profiles-container');
const addButton = $('add-profile-button');
const confirmationModal = $('confirmation-modal');
const confirmButton = $('confirmation-confirm-button');
const cancelButton = $('confirmation-cancel-button');
const configTabContent = $('tab-config');
const usbProfileSelector = $('usb-profile-selector');
const importProfileTriggerButton = $('import-profile-trigger-button');
const importProfileModal = $('import-profile-modal');
const importProfileModalInput = $('import-profile-modal-input');
const importProfileValidationText = $('import-profile-validation-text');
const importProfileScanButton = $('import-profile-scan-button');
const importProfileScanUnavailableNote = $('import-profile-scan-unavailable-note');
const importProfileScannerField = $('import-profile-scanner-field');
const importProfileVideo = $('import-profile-video');
const importProfileScanStatus = $('import-profile-scan-status');
const importProfileCancelButton = $('import-profile-cancel-button');
const importProfileConfirmButton = $('import-profile-confirm-button');

let importProfileScanStream = null;
let importProfileScanTimer = null;
let importProfileBarcodeDetector = null;
let importProfileScanUnavailableReason = '';
let profileCopyTooltip = null;
let profileCopyTooltipTimer = null;

/* Nastavenia USB zariadenia */

function getUsbProfileSetting() {
    try {
        const setting = localStorage.getItem('usbDeviceProfile');
        return setting || '';
    } catch {
        return '';
    }
}

function saveUsbProfileSetting(profileId) {
    try {
        localStorage.setItem('usbDeviceProfile', profileId || '');
    } catch (e) {
        console.error('Failed to save USB profile setting:', e);
    }
}

function populateUsbProfileSelector() {
    if (!usbProfileSelector) return;

    const currentSelection = getUsbProfileSetting();

    // Zmaz existujuce moznosti okrem prvej predvolenej.
    usbProfileSelector.innerHTML = '<option value="">Ponechať aktuálny profil</option>';

    // Pridaj moznost predvoleneho profilu.
    const defaultOption = document.createElement('option');
    defaultOption.value = 'default';
    defaultOption.textContent = 'Predvolený profil';
    usbProfileSelector.appendChild(defaultOption);

    // Pridaj vlastne profily.
    profiles.forEach(profile => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        usbProfileSelector.appendChild(option);
    });

    // Obnov predchadzajuci vyber.
    usbProfileSelector.value = currentSelection;
}

export function getUsbAutoProfile() {
    const setting = getUsbProfileSetting();
    if (!setting) return null;
    if (setting === 'default') return TinyTUS.DEFAULT_MODEM_PROFILE;

    const profile = profiles.find(p => p.id === parseInt(setting));
    return profile ? profile.modemProfile : null;
}

export function getAllModemProfilesForDemodulation() {
    const allProfiles = [
        TinyTUS.currentlyUsedModemProfile,
        ...profiles.map(profile => profile.modemProfile),
        TinyTUS.DEFAULT_MODEM_PROFILE,
    ];

    return allProfiles.filter((profile, index, arr) => profile && arr.indexOf(profile) === index);
}

export function getModemProfileIdLabel(modemProfile) {
    if (!modemProfile) return '?';
    if (modemProfile === TinyTUS.DEFAULT_MODEM_PROFILE) return '#';

    const profile = profiles.find(p => p.modemProfile === modemProfile);
    if (profile) return String(profile.id);

    return '?';
}

export function getModemProfileMeta(modemProfile) {
    if (!modemProfile) {
        return { idLabel: '?', name: 'Neznamy profil', id: null };
    }

    if (modemProfile === TinyTUS.DEFAULT_MODEM_PROFILE) {
        return { idLabel: 'default', name: 'Predvoleny profil', id: 'default' };
    }

    const profile = profiles.find(p => p.modemProfile === modemProfile);
    if (!profile) {
        return { idLabel: '?', name: 'Neznamy profil', id: null };
    }

    return {
        idLabel: String(profile.id),
        name: profile.name || `Profil ${profile.id}`,
        id: profile.id,
    };
}

function focusProfileForReview(modemProfile) {
    const profileMeta = getModemProfileMeta(modemProfile);
    if (profileMeta.id == null) return;

    document.getElementById('config-button')?.click();

    const focusAndReveal = () => {
        const targetId = profileMeta.id;
        const content = $(`profile-content-${targetId}`);
        if (!content) return false;

        if (!content.classList.contains('expanded')) {
            toggleProfile(targetId);
        }

        const profileItem = content.closest('.profile-item');
        profileItem?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
    };

    if (!focusAndReveal()) {
        setTimeout(focusAndReveal, 80);
        setTimeout(focusAndReveal, 220);
    }
}

/* Persistencia */

function loadProfiles() {
    try {
        const parsed = JSON.parse(localStorage.getItem('modemProfiles') || 'null');
        if (parsed) profiles = parsed.map(p => ({ id: p.id, name: p.name, modemProfile: new ModemProfile(p) }));
    } catch { profiles = []; }
}

function saveProfiles() {
    localStorage.setItem('modemProfiles', JSON.stringify(
        profiles.map(p => ({ id: p.id, name: p.name, ...p.modemProfile.toObject() }))
    ));
}

function saveConfigState() {
    const expanded = ['default', ...profiles.map(p => p.id)]
        .filter(id => $(`profile-content-${id}`)?.classList.contains('expanded'));
    localStorage.setItem('configTabState', JSON.stringify({
        activeProfileId: isDefaultActive() ? 'default' : profiles.find(p => isProfileActive(p))?.id ?? 'default',
        expandedProfiles: expanded,
        scrollPosition: configTabContent?.scrollTop || 0,
    }));
}

function restoreConfigState() {
    try {
        const state = JSON.parse(localStorage.getItem('configTabState') || 'null');
        if (!state) return;

        const profileToActivate = state.activeProfileId === 'default'
            ? TinyTUS.DEFAULT_MODEM_PROFILE
            : profiles.find(p => p.id === state.activeProfileId)?.modemProfile;
        if (profileToActivate) {
            TinyTUS.currentlyUsedModemProfile = profileToActivate;
            window.dispatchEvent(new CustomEvent("active-modem-profile-changed", { detail: { profile: profileToActivate } }));
        }

        state.expandedProfiles?.forEach(id => {
            const content = $(`profile-content-${id}`);
            const toggle = $(`profile-toggle-${id}`);
            if (!content || !toggle) return;
            content.classList.add('expanded');
            toggle.classList.add('expanded');
            setTimeout(() => drawWaveVisualization(id), 50);
            const mp = id === 'default' ? TinyTUS.DEFAULT_MODEM_PROFILE : getProfileById(id)?.modemProfile;
            if (mp) setTimeout(() => updateProfileSpectrogram(id, mp), 60);
        });

        if (state.scrollPosition && configTabContent)
            setTimeout(() => { configTabContent.scrollTop = state.scrollPosition; }, 100);
    } catch { /* Ignoruj poskodeny stav. */ }
}

/* Sprava profilov */

const isProfileActive = profile => TinyTUS.currentlyUsedModemProfile === profile.modemProfile;
const isDefaultActive = () => TinyTUS.currentlyUsedModemProfile === TinyTUS.DEFAULT_MODEM_PROFILE;

function updateActiveProfileUI(modemProfile) {
    // Zrus active class zo vsetkych profilov.
    document.querySelectorAll('.profile-item--active').forEach(el => el.classList.remove('profile-item--active'));

    // Zisti, ktory profil je aktivny.
    const isDefault = modemProfile === TinyTUS.DEFAULT_MODEM_PROFILE;
    const activeId = isDefault ? 'default' : profiles.find(p => p.modemProfile === modemProfile)?.id;

    if (!activeId) return;

    // Nastav active class pre aktivny profil.
    const activeProfileItem = document.querySelector(`#profile-content-${activeId}`)?.parentElement;
    if (activeProfileItem) activeProfileItem.classList.add('profile-item--active');

    // Aktualizuj vsetky tlacidla "Pouzit".
    document.querySelectorAll('[data-action="use-profile"], [data-action="use-default"]').forEach(btn => {
        const btnProfileId = btn.dataset.profileId ? parseInt(btn.dataset.profileId) : 'default';
        const isThisActive = btnProfileId === activeId;

        btn.disabled = isThisActive;
        btn.classList.toggle('use-profile-button--active', isThisActive);
        btn.innerHTML = isThisActive ? '<i class="fas fa-check"></i> Používa sa' : 'Použiť';
    });
}

function setActiveProfile(modemProfile, source = 'manual') {
    TinyTUS.currentlyUsedModemProfile = modemProfile;
    window.dispatchEvent(new CustomEvent("active-modem-profile-changed", { detail: { profile: modemProfile, source: source } }));
    updateActiveProfileUI(modemProfile);
    saveConfigState();
}

function findFreeProfileID() {
    const ids = new Set(profiles.map(p => p.id));
    let id = 1;
    while (ids.has(id)) id++;
    return id;
}

function addProfileFromModemProfile(modemProfile, event = null) {
    if (!ensureCanAddProfile()) {
        modemProfile?.destroy?.();
        return;
    }

    const id = findFreeProfileID();
    const newProfile = { id, name: `Profil ${id}`, modemProfile };
    profiles.unshift(newProfile);
    saveProfiles();
    renderProfiles();

    setTimeout(() => {
        const content = $(`profile-content-${id}`);
        const nameInput = $(`profile-name-input-${id}`);
        content?.classList.add('expanded');
        $(`profile-toggle-${id}`)?.classList.add('expanded');
        updateProfileSpectrogram(id, modemProfile);
        if (nameInput && !event?.shiftKey) {
            nameInput.focus();
            nameInput.select();
            drawWaveVisualization(id);
        }
    }, 100);
}

function addProfile(event = null) {
    addProfileFromModemProfile(new ModemProfile(), event);
}

function getProfileById(profileId) {
    return profiles.find(profile => profile.id === profileId) || null;
}

function syncProfileCodeInput(profileId, profileCode) {
    const codeInput = document.querySelector(`[data-profile-code-for="${profileId}"]`);
    if (codeInput) codeInput.value = profileCode;
}

function getProfileCodeById(profileId) {
    const profile = getProfileById(profileId);
    return profile ? getModemProfileTLVCode(profile.modemProfile) : '';
}

function ensureProfileCopyTooltip() {
    if (profileCopyTooltip && document.body.contains(profileCopyTooltip)) return profileCopyTooltip;

    profileCopyTooltip = document.createElement('div');
    profileCopyTooltip.className = 'profile-copy-tooltip';
    profileCopyTooltip.innerHTML = '<i class="fas fa-circle-check"></i><span>Skopirovane!</span>';
    document.body.appendChild(profileCopyTooltip);
    return profileCopyTooltip;
}

function showProfileCopyTooltip(anchorEl) {
    if (!anchorEl) return;

    const tooltip = ensureProfileCopyTooltip();
    const rect = anchorEl.getBoundingClientRect();
    const top = Math.max(10, rect.top - 12);
    const left = Math.max(12, Math.min(window.innerWidth - 12, rect.left + (rect.width / 2)));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.classList.remove('is-visible');

    requestAnimationFrame(() => tooltip.classList.add('is-visible'));

    if (profileCopyTooltipTimer) clearTimeout(profileCopyTooltipTimer);
    profileCopyTooltipTimer = setTimeout(() => {
        tooltip.classList.remove('is-visible');
    }, 1300);
}

async function copyTextToClipboard(text, fallbackInput) {
    if (!text) return false;

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fallback je nizsie.
        }
    }

    if (!fallbackInput) return false;

    try {
        fallbackInput.focus({ preventScroll: true });
        fallbackInput.select();
        return document.execCommand('copy');
    } catch {
        return false;
    }
}

async function copyProfileCode(profileId, anchorEl) {
    const profileCode = getProfileCodeById(profileId);
    if (!profileCode) return;

    syncProfileCodeInput(profileId, profileCode);
    const codeInput = document.querySelector(`[data-profile-code-for="${profileId}"]`);
    const copied = await copyTextToClipboard(profileCode, codeInput);
    if (!copied) return;

    if (codeInput) {
        codeInput.focus({ preventScroll: true });
        codeInput.select();
    }

    showProfileCopyTooltip(anchorEl || codeInput);
}

function ensureCanAddProfile() {
    if (profiles.length < MAX_PROFILES) return true;
    alert(`Maximálny počet profilov je ${MAX_PROFILES}. Odstráňte niektorý z existujúcich profilov.`);
    return false;
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

function applyProfileCodeToModemProfile(modemProfile, code) {
    const bytes = codeToBytes(code);
    if (!TinyTUS.EXPORTS?.mp_decode_tlv || !bytes || !TinyTUS.EXPORTS?.malloc || !TinyTUS.EXPORTS?.free) return false;

    const bufferPtr = TinyTUS.EXPORTS.malloc(bytes.length);
    if (!bufferPtr) return false;

    try {
        new Uint8Array(TinyTUS.EXPORTS.memory.buffer, bufferPtr, bytes.length).set(bytes);
        const result = TinyTUS.EXPORTS.mp_decode_tlv(modemProfile.ptr, bufferPtr, bytes.length);
        return result === 0;
    } catch {
        return false;
    } finally {
        TinyTUS.EXPORTS.free(bufferPtr);
    }
}

function importProfileFromCode() {
    const code = importProfileModalInput?.value?.trim() || '';
    if (!code) return;

    const validation = validateImportProfileCode(code);
    if (!validation.valid) {
        updateImportProfileValidationUI(validation);
        updateImportProfileModalState();
        return;
    }

    const modemProfile = new ModemProfile();
    const ok = applyProfileCodeToModemProfile(modemProfile, code);
    if (!ok) {
        modemProfile.destroy();
        updateImportProfileValidationUI({
            valid: false,
            message: 'Kod profilu je neplatny.',
        });
        updateImportProfileModalState();
        return;
    }

    addProfileFromModemProfile(modemProfile);
    closeImportProfileModal();
}

function validateImportProfileCode(code) {
    const trimmedCode = (code || '').trim();
    if (!trimmedCode) return { valid: false, message: '' };

    const bytes = codeToBytes(trimmedCode);
    if (!bytes) return { valid: false, message: 'Kod nema spravny format.' };
    if (!TinyTUS.EXPORTS?.mp_decode_tlv) {
        return { valid: false, message: 'Knižnica este nie je nacitana.' };
    }

    const tempProfile = new ModemProfile();
    try {
        const valid = applyProfileCodeToModemProfile(tempProfile, trimmedCode);
        return valid
            ? { valid: true, message: 'Kod je platny.' }
            : { valid: false, message: 'Kod profilu je neplatny.' };
    } finally {
        tempProfile.destroy();
    }
}

function updateImportProfileValidationUI(validation) {
    if (!importProfileValidationText) return;

    if (!validation.message) {
        importProfileValidationText.style.visibility = 'hidden';
        importProfileValidationText.classList.remove('is-valid', 'is-invalid');
        importProfileValidationText.innerHTML = '';
        return;
    }

    importProfileValidationText.style.visibility = 'visible';
    importProfileValidationText.classList.toggle('is-valid', validation.valid);
    importProfileValidationText.classList.toggle('is-invalid', !validation.valid);
    importProfileValidationText.innerHTML = validation.valid
        ? `<i class="fas fa-circle-check"></i> ${validation.message}`
        : `<i class="fas fa-triangle-exclamation"></i> ${validation.message}`;
}

function updateImportProfileModalState() {
    if (!importProfileConfirmButton || !importProfileModalInput) return;
    const validation = validateImportProfileCode(importProfileModalInput.value);
    updateImportProfileValidationUI(validation);
    importProfileConfirmButton.disabled = !validation.valid;
}

function resetImportProfileModal() {
    if (importProfileModalInput) importProfileModalInput.value = '';
    if (importProfileScanStatus) importProfileScanStatus.textContent = 'Namierte kameru na QR kod.';
    if (importProfileScannerField) importProfileScannerField.style.display = 'none';
    updateImportProfileValidationUI({ valid: false, message: '' });
    updateImportProfileModalState();
    updateImportProfileScanAvailabilityUI();
}

function updateImportProfileScanAvailabilityUI() {
    if (importProfileScanButton) importProfileScanButton.disabled = !!importProfileScanUnavailableReason;
    if (!importProfileScanUnavailableNote) return;

    importProfileScanUnavailableNote.textContent = importProfileScanUnavailableReason;
    importProfileScanUnavailableNote.style.display = importProfileScanUnavailableReason ? 'block' : 'none';
}

async function initImportProfileScanAvailability() {
    importProfileScanUnavailableReason = '';

    if (!navigator.mediaDevices?.getUserMedia) {
        importProfileScanUnavailableReason = 'QR skenovanie nie je dostupne, pretoze prehliadac nepodporuje pristup ku kamere.';
        return updateImportProfileScanAvailabilityUI();
    }

    if (!("BarcodeDetector" in window)) {
        importProfileScanUnavailableReason = 'QR skenovanie nie je dostupne, pretoze prehliadac nepodporuje detekciu QR kodov.';
        return updateImportProfileScanAvailabilityUI();
    }

    try {
        const formats = BarcodeDetector.getSupportedFormats
            ? await BarcodeDetector.getSupportedFormats()
            : ['qr_code'];
        if (!formats.includes('qr_code')) {
            importProfileScanUnavailableReason = 'QR skenovanie nie je dostupne, pretoze v tomto prehliadaci nie je podporovany format qr_code.';
        }
    } catch {
        importProfileScanUnavailableReason = 'QR skenovanie nie je dostupne, pretoze sa nepodarilo zistit podporu QR kodov.';
    }

    updateImportProfileScanAvailabilityUI();
}

async function stopImportProfileScanner() {
    if (importProfileScanTimer) {
        clearTimeout(importProfileScanTimer);
        importProfileScanTimer = null;
    }

    if (importProfileVideo) {
        importProfileVideo.pause();
        importProfileVideo.srcObject = null;
    }

    if (importProfileScanStream) {
        importProfileScanStream.getTracks().forEach(track => track.stop());
        importProfileScanStream = null;
    }

    if (importProfileScannerField) importProfileScannerField.style.display = 'none';
}

async function scanImportProfileQrFrame() {
    if (!importProfileBarcodeDetector || !importProfileVideo || importProfileVideo.readyState < 2) {
        importProfileScanTimer = setTimeout(scanImportProfileQrFrame, 250);
        return;
    }

    try {
        const barcodes = await importProfileBarcodeDetector.detect(importProfileVideo);
        const code = barcodes.find(barcode => barcode.rawValue)?.rawValue?.trim();
        if (code) {
            importProfileModalInput.value = code;
            updateImportProfileModalState();
            if (importProfileScanStatus) importProfileScanStatus.textContent = 'QR kod bol nacitany.';
            await stopImportProfileScanner();
            return;
        }
    } catch (e) {
        if (importProfileScanStatus) importProfileScanStatus.textContent = 'QR skenovanie sa nepodarilo spustit.';
        console.warn('QR scan failed:', e);
        return;
    }

    importProfileScanTimer = setTimeout(scanImportProfileQrFrame, 250);
}

async function startImportProfileScanner() {
    if (!importProfileScannerField || !importProfileVideo || !importProfileScanStatus) return;

    if (importProfileScanUnavailableReason) {
        updateImportProfileScanAvailabilityUI();
        return;
    }

    if (!('BarcodeDetector' in window)) {
        importProfileScannerField.style.display = 'block';
        importProfileScanStatus.textContent = 'QR skenovanie nie je podporovane v tomto prehliadaci.';
        return;
    }

    try {
        if (!importProfileBarcodeDetector) {
            const formats = BarcodeDetector.getSupportedFormats
                ? await BarcodeDetector.getSupportedFormats()
                : ['qr_code'];
            if (!formats.includes('qr_code')) throw new Error('qr_code format not supported');
            importProfileBarcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
        }

        await stopImportProfileScanner();
        importProfileScanStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
        });

        importProfileScannerField.style.display = 'block';
        importProfileScanStatus.textContent = 'Namierte kameru na QR kod profilu.';
        importProfileVideo.srcObject = importProfileScanStream;
        await importProfileVideo.play();
        importProfileScanTimer = setTimeout(scanImportProfileQrFrame, 200);
    } catch (e) {
        importProfileScannerField.style.display = 'block';
        importProfileScanStatus.textContent = 'Kameru sa nepodarilo spustit alebo QR skenovanie nie je podporovane.';
        console.warn('Failed to start QR scanner:', e);
    }
}

function openImportProfileModal() {
    if (!importProfileModal) return;
    importProfileModal.style.display = 'flex';
    resetImportProfileModal();
    importProfileModalInput?.focus();
}

function closeImportProfileModal() {
    stopImportProfileScanner();
    if (importProfileModal) importProfileModal.style.display = 'none';
}

function doDeleteProfile(id) {
    const profile = profiles.find(p => p.id === id);
    if (profile?.modemProfile) {
        if (isProfileActive(profile)) setActiveProfile(TinyTUS.DEFAULT_MODEM_PROFILE);
        profile.modemProfile.destroy();
    }
    clearAttenuationData(id);
    profiles = profiles.filter(p => p.id !== id);
    saveProfiles();
    renderProfiles();
}

function deleteProfile(id) {
    profileToDelete = id;
    confirmationModal.style.display = 'flex';
}

function confirmDelete() {
    if (profileToDelete !== null) doDeleteProfile(profileToDelete);
    profileToDelete = null;
    closeModal();
}

function closeModal() {
    confirmationModal.style.display = 'none';
    profileToDelete = null;
}

/* UI akcie */

function toggleProfile(id) {
    const content = $(`profile-content-${id}`);
    const toggle = $(`profile-toggle-${id}`);
    const opening = !content.classList.contains('expanded');
    content.classList.toggle('expanded');
    toggle?.classList.toggle('expanded');
    if (opening) {
        setTimeout(() => drawWaveVisualization(id), 50);
        const mp = id === 'default' ? TinyTUS.DEFAULT_MODEM_PROFILE : getProfileById(id)?.modemProfile;
        if (mp) setTimeout(() => updateProfileSpectrogram(id, mp), 60);
    }
    saveConfigState();
}

function updateProfile(id, field, value) {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;

    if (field === 'name') {
        profile.name = (value || `Profil ${id}`).substring(0, MAX_PROFILE_NAME).trim();
    } else {
        // Tieto polia su odvodene alebo fixne, UI ich nema menit.
        profile.modemProfile[field] = parseFloat(value) || 0;
        window.dispatchEvent(new CustomEvent("modem-profile-updated", { detail: { profile: profile.modemProfile } }));
        // Pri zmene sample_rate alebo samples_per_symbol
        // treba aktualizovat binsize.
        if (field === 'sample_rate' || field === 'samples_per_symbol')
            updateFreqPickerRange(id, profile.modemProfile);
        if ($(`profile-content-${id}`)?.classList.contains('expanded')) {
            updateWaveInfo(id, profile.modemProfile);
            drawWaveVisualization(id);
        }
    }
    updateProfileCodeUI(id, profile.modemProfile);
    updateProfileSpectrogram(id, profile.modemProfile);
    saveProfiles();
}

function updateProfileCodeUI(profileId, mp) {
    const profileCode = getModemProfileTLVCode(mp);
    syncProfileCodeInput(profileId, profileCode);

    const shareWrap = document.querySelector(`[data-profile-share-for="${profileId}"]`);
    if (!shareWrap) return;

    const unchanged = isProfileSameAsDefault(mp);
    const row = shareWrap.closest('.profile-share-row');
    const shareBtn = row?.querySelector('[data-action="share-profile"]');
    const codeWrap = shareWrap.querySelector('.profile-share-code-wrap');
    const unchangedNote = shareWrap.querySelector('.profile-share-nochanges');

    if (shareBtn) shareBtn.disabled = unchanged;
    if (codeWrap) codeWrap.classList.toggle('is-hidden', unchanged);
    if (unchangedNote) unchangedNote.classList.toggle('is-hidden', !unchanged);
}

/* Info o vlne */

const waveInfoKeys = [
    ['Symbolová rýchlosť:', 'symbol-rate', mp => mp.symbol_rate?.toFixed(3) ?? '-'],
    ['Perióda symbolu:', 'period', mp => `${(mp.sample_duration * mp.samples_per_symbol * 1000).toFixed(3)} ms`],
    ['Nyquist frekvencia:', 'nyquist', mp => `${mp.sample_rate / 2} Hz`],
];

function waveInfoHtml(mp, idSuffix) {
    return `<div class="wave-info">${waveInfoKeys.map(([label, key, fn]) => `
            <div class="wave-info-item">
                <span class="wave-info-label">${label}</span><br>
                <span data-wave-info="${key}-${idSuffix}">${fn(mp)}</span>
            </div>`).join('')
        }</div>`;
}

function updateWaveInfo(profileId, mp) {
    const suffix = profileId === 'default' ? '-default' : `-${profileId}`;
    waveInfoKeys.forEach(([, key, fn]) => {
        const el = document.querySelector(`[data-wave-info="${key}${suffix}"]`);
        if (el) el.textContent = fn(mp);
    });
}

/* Vizualizacia */

function drawWaveVisualization(profileId) {
    return;
    const mp = profileId === 'default'
        ? TinyTUS.DEFAULT_MODEM_PROFILE
        : profiles.find(p => p.id === profileId)?.modemProfile;
    if (!mp) return;

    const canvas = $(`wave-canvas-${profileId}`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = 260;
    canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const dark = document.documentElement.classList.contains('dark-scheme');
    const C = {
        grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        axis: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)',
        wave: dark ? '#579ffb' : '#007bff',
        marker: dark ? 'rgb(88,128,101)' : '#28a745',
        label: dark ? 'rgba(255,255,255,0.45)' : '#6c757d',
        tagBg: dark ? 'rgba(87,159,251,0.12)' : 'rgba(0,123,255,0.08)',
        tagFg: dark ? '#579ffb' : '#007bff',
        center: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    };

    const pad = { top: 32, right: 16, bottom: 56, left: 48 };
    const gw = w - pad.left - pad.right;
    const gh = h - pad.top - pad.bottom;
    const cy = pad.top + gh / 2;
    const L = pad.left;

    // Mriezka.
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
        const y = pad.top + gh * i / 4;
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + gw, y); ctx.stroke();
    }

    // Osi.
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(L, pad.top); ctx.lineTo(L, pad.top + gh); ctx.lineTo(L + gw, pad.top + gh); ctx.stroke();

    // Stredova ciara.
    ctx.strokeStyle = C.center; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(L, cy); ctx.lineTo(L + gw, cy); ctx.stroke();
    ctx.setLineDash([]);

    // Popisy osi Y.
    ctx.fillStyle = C.label; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    ctx.fillText('+1', L - 6, pad.top + 4);
    ctx.fillText(' 0', L - 6, cy + 4);
    ctx.fillText('\u22121', L - 6, pad.top + gh + 4);

    // Waveform.
    const NUM_CYCLES = 4;
    const TOTAL_PTS = NUM_CYCLES * 200;
    let phase = 0;
    ctx.strokeStyle = C.wave; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= TOTAL_PTS; i++) {
        const t = (i / TOTAL_PTS) * NUM_CYCLES;
        const freq = Math.floor(t) % 2 === 0 ? mp.min_tx_freq : mp.max_tx_freq;
        let y;
        if (mp.cphase) { phase += 2 * Math.PI * (freq / 1000) * (NUM_CYCLES / TOTAL_PTS); y = Math.sin(phase); }
        else { y = Math.sin(t * Math.PI * 2 * freq / 1000); }
        const x = L + (i / TOTAL_PTS) * gw;
        i === 0 ? ctx.moveTo(x, cy - y * gh * 0.42) : ctx.lineTo(x, cy - y * gh * 0.42);
    }
    ctx.stroke();

    // Hranice symbolov.
    ctx.strokeStyle = C.marker; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    for (let i = 1; i < NUM_CYCLES; i++) {
        const x = L + (i / NUM_CYCLES) * gw;
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + gh); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Tagy bitov.
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    for (let i = 0; i < NUM_CYCLES; i++) {
        const mx = L + ((i + 0.5) / NUM_CYCLES) * gw;
        const bit = i % 2;
        const label = `bit ${bit}  ${bit === 0 ? mp.min_tx_freq : mp.max_tx_freq} Hz`;
        ctx.textAlign = 'center';
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = C.tagBg;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(mx - tw / 2, pad.top - 16, tw, 16, 4);
        else ctx.rect(mx - tw / 2, pad.top - 16, tw, 16);
        ctx.fill();
        ctx.fillStyle = C.tagFg; ctx.fillText(label, mx, pad.top - 3);
    }

    // Sipka a popis periody.
    const period = mp.sample_duration * mp.samples_per_symbol;
    const ay = pad.top + gh + 28;
    const ax1 = L + gw / NUM_CYCLES;
    const asz = 5;
    ctx.strokeStyle = C.marker; ctx.fillStyle = C.marker; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(L, ay); ctx.lineTo(ax1, ay); ctx.stroke();
    for (const [x, d] of [[L, 1], [ax1, -1]]) {
        ctx.beginPath(); ctx.moveTo(x, ay);
        ctx.lineTo(x + d * asz, ay - asz / 2); ctx.lineTo(x + d * asz, ay + asz / 2);
        ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = C.label; ctx.font = '11px JetBrains Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillText(`T = ${(period * 1000).toFixed(3)} ms`, (L + ax1) / 2, ay + 14);
}

/* Buildery poli */

function fieldWrap(name, inputHtml, help = '') {
    return `<div class="profile-field">
        <label>${PARAM_LABELS[name] ?? name}</label>
        ${inputHtml}
        ${help ? `<div class="help-text">${help}</div>` : ''}
    </div>`;
}

function numField(name, mp, id, readonly, { min, max, step = 1, help = '' } = {}) {
    const val = mp[name] ?? 0;
    if (readonly) return fieldWrap(name, `<input type="number" value="${val}" disabled>`, help);
    return fieldWrap(name, `<input type="number" value="${val}" data-profile-id="${id}" data-field="${name}"
        ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} step="${step}">`, help);
}

function toggleField(name, mp, id, readonly, help = '') {
    const checked = mp[name] ? 'checked' : '';
    if (readonly) return fieldWrap(name, `<input type="checkbox" ${checked} disabled>`, help);
    return fieldWrap(name, `<input type="checkbox" ${checked}
        data-profile-id="${id}" data-field="${name}" data-type="checkbox">`, help);
}

function sliderField(name, mp, id, readonly, { min = 0, max = 1, step = 0.01, help = '', icon = '', format } = {}) {
    const val = mp[name] ?? 0;
    const display = format ? format(val) : parseFloat(val).toFixed(2);
    const expr = name === 'ecc_percent' ? "Math.round(parseFloat(this.value)*100)+'%'"
        : name === 'max_tx_amp' ? "parseFloat(this.value).toFixed(2)"
            : name === 'min_tx_freq' ? `Math.round(this.value) + ' Hz (Bin #' + Math.round(this.value / ${step}) + ')'`
                : "parseFloat(this.value).toFixed(3)";
    return fieldWrap(name, `<div class="slider-row">
        ${icon ? `<i class="${icon} slider-icon"></i>` : ''}
        <input type="range" min="${min}" max="${max}" step="${step}" value="${val}"
            ${readonly ? 'disabled' : `data-profile-id="${id}" data-field="${name}" oninput="this.nextElementSibling.textContent=${expr}"`}>
        <span class="slider-label">${display}</span>
    </div>`, help);
}

function selectField(name, mp, id, readonly, { options = [], help = '' } = {}) {
    const val = mp[name] ?? options[0];
    if (readonly) {
        return fieldWrap(name, `<select disabled><option>${val}</option></select>`, help);
    }
    const optionsHtml = options.map(opt =>
        `<option value="${opt}" ${opt == val ? 'selected' : ''}>${opt}</option>`
    ).join('');
    return fieldWrap(name, `<select data-profile-id="${id}" data-field="${name}">${optionsHtml}</select>`, help);
}

function bytesToCode(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getModemProfileTLVCode(mp) {
    if (!mp?.ptr || !TinyTUS.EXPORTS?.mp_encode_tlv || !TinyTUS.EXPORTS?.malloc || !TinyTUS.EXPORTS?.free) {
        return '';
    }

    const maxSize =
        TinyTUS.CONSTS?.U32_MODEM_PROFILE_TLV_MAX_BYTES ||
        TinyTUS.CONSTS?.U32_MODEM_PROFILE_MAX_TLV_BYTES ||
        TinyTUS.CONSTS?.U32_MODEM_PROFILE_SERIALIZED_MAX_BYTES ||
        512;

    const bufferPtr = TinyTUS.EXPORTS.malloc(maxSize);
    if (!bufferPtr) return '';

    try {
        const outLen = TinyTUS.EXPORTS.mp_encode_tlv(mp.ptr, bufferPtr, maxSize);
        if (!outLen) return '';

        const tlvBytes = new Uint8Array(TinyTUS.EXPORTS.memory.buffer, bufferPtr, outLen).slice();
        return bytesToCode(tlvBytes);
    } finally {
        TinyTUS.EXPORTS.free(bufferPtr);
    }

}

function isProfileSameAsDefault(mp) {
    const defaultMp = TinyTUS.DEFAULT_MODEM_PROFILE;
    if (!mp || !defaultMp) return false;

    const profileCode = getModemProfileTLVCode(mp);
    const defaultCode = getModemProfileTLVCode(defaultMp);
    if (profileCode && defaultCode) {
        return profileCode === defaultCode;
    }

    // Fallback, ak TLV serializacia nie je dostupna.
    try {
        return JSON.stringify(mp.toObject()) === JSON.stringify(defaultMp.toObject());
    } catch {
        return false;
    }
}

function renderShareProfileRow(mp, idSuffix, readonly) {
    if (readonly) return '';

    const profileCode = getModemProfileTLVCode(mp);
    const unchanged = isProfileSameAsDefault(mp);
    return `<div class="profile-share-row">
        <button class="share-profile-button" data-action="share-profile" data-profile-id="${idSuffix}" ${unchanged ? 'disabled' : ''}>
            <i class="fas fa-share-nodes"></i> Zdieľať profil
        </button>
        <div class="profile-share-content" data-profile-share-for="${idSuffix}">
            <div class="profile-share-code-wrap${unchanged ? ' is-hidden' : ''}">
                <input type="text" class="profile-code-input" data-profile-code-for="${idSuffix}" value="${profileCode}"
                    readonly title="Kliknite pre skopirovanie kodu profilu">
                <button class="copy-profile-code-button" data-action="copy-profile-code" data-profile-id="${idSuffix}"
                    title="Skopirovat kod profilu">
                    <i class="fas fa-copy"></i>
                </button>
            </div>
            <div class="profile-share-nochanges${unchanged ? '' : ' is-hidden'}">
                Profil nema zmeny oproti predvolenemu profilu.
            </div>
        </div>
    </div>`;
}

function renderReadonlyProfileProperties(mp, idSuffix) {
    const nyquist = Math.round((Number(mp.sample_rate) || 0) / 2);
    const items = [
        { label: PARAM_LABELS.sample_rate, value: `${mp.sample_rate} Hz (Nyquist ${nyquist} Hz)` },
        { label: PARAM_LABELS.channel_size, value: getProfileChannelSizeText(mp) },
        { label: 'Rychlost', value: `<span data-profile-speed-for="${idSuffix}">${getProfileSpectrogramSpeedText(mp)}</span>` },
    ];

    const rows = items
        .map(item => `<div class="profile-readonly-prop-row">
            <span class="profile-readonly-prop-label">${item.label}</span>
            <span class="profile-readonly-prop-value">${item.value}</span>
        </div>`)
        .join('');

    return `<div class="profile-readonly-properties">
        ${rows}
    </div>`;
}

function getProfileChannelSizeText(mp) {
    const value = Number(mp.channel_size);
    if (!Number.isFinite(value) || value <= 0) return '-';
    return `${value} Hz (${mp.min_tx_freq} - ${mp.min_tx_freq + value} Hz)`;
}

function getProfileSpectrogramSpeedText(mp) {
    const symbolRate = Number(mp.symbol_rate) || 0;
    const bitsPerSecond = symbolRate * (Number(mp.bits_per_tone) || 0);
    if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return 'Rychlost: -';
    return `Rychlost: ${bitsPerSecond.toFixed(2)} b/s`;
}

function renderProfileSpectrogramPreview(mp, idSuffix) {
    return `<div class="profile-spectrogram-preview">
        <div class="profile-spectrogram-head">
            <div class="profile-spectrogram-title">FFT waterfall nahlad (sprava: \"test\")</div>
        </div>
        <canvas class="profile-spectrogram-canvas" id="profile-spectrogram-${idSuffix}" width="560" height="140"></canvas>
    </div>`;
}

const spectrogramFftCache = new Map();

function nextPow2(v) {
    let n = 1;
    while (n < v) n <<= 1;
    return n;
}

function getSpectrogramFftPlan(fftSize) {
    const cached = spectrogramFftCache.get(fftSize);
    if (cached) return cached;

    const bitRev = new Uint32Array(fftSize);
    const bits = Math.log2(fftSize);
    for (let i = 0; i < fftSize; i++) {
        let x = i;
        let y = 0;
        for (let b = 0; b < bits; b++) {
            y = (y << 1) | (x & 1);
            x >>= 1;
        }
        bitRev[i] = y;
    }

    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
        window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
    }

    const plan = { bitRev, window };
    spectrogramFftCache.set(fftSize, plan);
    return plan;
}

function fftRealMagnitudeInPlace(re, im) {
    const n = re.length;
    for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1;
        const ang = (-2 * Math.PI) / len;
        const wLenRe = Math.cos(ang);
        const wLenIm = Math.sin(ang);

        for (let i = 0; i < n; i += len) {
            let wRe = 1;
            let wIm = 0;
            for (let j = 0; j < half; j++) {
                const a = i + j;
                const b = a + half;

                const uRe = re[a];
                const uIm = im[a];
                const vRe = re[b] * wRe - im[b] * wIm;
                const vIm = re[b] * wIm + im[b] * wRe;

                re[a] = uRe + vRe;
                im[a] = uIm + vIm;
                re[b] = uRe - vRe;
                im[b] = uIm - vIm;

                const nwRe = wRe * wLenRe - wIm * wLenIm;
                wIm = wRe * wLenIm + wIm * wLenRe;
                wRe = nwRe;
            }
        }
    }
}

function getSpectrogramParams(sampleRate, mp) {
    const sr = Math.max(8000, Number(sampleRate) || 48000);
    const minTx = Number(mp?.min_tx_freq) || 800;
    const maxTx = Number(mp?.max_tx_freq) || Math.min(sr / 2 - 1, minTx + 1200);
    const span = Math.max(200, maxTx - minTx);
    const targetBinHz = Math.max(4, Math.min(14, span / 120));
    let fftSize = nextPow2(Math.round(sr / targetBinHz));
    fftSize = Math.max(2048, Math.min(8192, fftSize));
    const hopSize = Math.max(64, fftSize >> 4);
    return { fftSize, hopSize };
}

function computeSpectrogramFrames(signal, sampleRate, mp = null) {
    const { fftSize, hopSize } = getSpectrogramParams(sampleRate, mp);
    if (!signal || signal.length < fftSize) return null;

    const bins = fftSize >> 1;
    const frameCountRaw = Math.max(1, Math.floor((signal.length - fftSize) / hopSize) + 1);
    const maxFrames = 220;
    const frameStep = Math.max(1, Math.ceil(frameCountRaw / maxFrames));
    const frameCount = Math.ceil(frameCountRaw / frameStep);
    const frames = new Array(frameCount);

    const { bitRev, window } = getSpectrogramFftPlan(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);

    for (let outIdx = 0, f = 0; f < frameCountRaw; f += frameStep, outIdx++) {
        const start = f * hopSize;

        for (let i = 0; i < fftSize; i++) {
            const src = start + i;
            const val = src < signal.length ? signal[src] : 0;
            const br = bitRev[i];
            re[br] = val * window[i];
            im[br] = 0;
        }

        fftRealMagnitudeInPlace(re, im);

        const mags = new Float32Array(bins);
        for (let k = 0; k < bins; k++) {
            mags[k] = Math.hypot(re[k], im[k]);
        }
        frames[outIdx] = mags;
    }

    return { frames, sampleRate, fftSize };
}

function drawProfileSpectrogram(canvas, spec, mp) {
    if (!canvas || !spec?.frames?.length) return;

    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(240, Math.floor(rect.width || 560));
    const cssH = Math.max(96, Math.floor(rect.height || 140));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const { frames, sampleRate, fftSize } = spec;
    const nyquist = sampleRate / 2;
    const minFreq = Math.max(0, Number(mp.min_tx_freq || 0) - 120);
    const maxFreq = Math.min(nyquist, Number(mp.max_tx_freq || 0) + 120);
    const minBin = Math.max(0, Math.floor((minFreq / nyquist) * (fftSize / 2)));
    const maxBin = Math.max(minBin + 1, Math.min((fftSize / 2) - 1, Math.ceil((maxFreq / nyquist) * (fftSize / 2))));
    const binCount = maxBin - minBin + 1;

    const dbValues = [];
    for (let r = 0; r < frames.length; r++) {
        for (let b = minBin; b <= maxBin; b++) {
            dbValues.push(20 * Math.log10(frames[r][b] + 1e-12));
        }
    }
    dbValues.sort((a, b) => a - b);
    const p10 = dbValues[Math.floor(dbValues.length * 0.10)] ?? -120;
    const p995 = dbValues[Math.floor(dbValues.length * 0.995)] ?? -10;
    const lowDb = p10;
    const highDb = Math.max(lowDb + 1, p995);

    ctx.fillStyle = 'rgba(14, 20, 28, 0.92)';
    ctx.fillRect(0, 0, cssW, cssH);

    const xScale = cssW / binCount;
    const yScale = cssH / frames.length;
    for (let r = 0; r < frames.length; r++) {
        for (let b = 0; b < binCount; b++) {
            const db = 20 * Math.log10(frames[r][minBin + b] + 1e-12);
            const norm = Math.min(1, Math.max(0, (db - lowDb) / (highDb - lowDb)));
            if (norm >= 0.9) {
                ctx.fillStyle = `hsl(40 78% 77%)`;
            } else {
                ctx.fillStyle = `hsl(215 78% 10%)`;
            }
            ctx.fillRect(b * xScale, r * yScale, Math.ceil(xScale), Math.ceil(yScale));
        }
    }

    if (Number(mp.min_tx_freq) > 0 && Number(mp.max_tx_freq) > Number(mp.min_tx_freq)) {
        const minX = ((Number(mp.min_tx_freq) - minFreq) / (maxFreq - minFreq)) * cssW;
        const maxX = ((Number(mp.max_tx_freq) - minFreq) / (maxFreq - minFreq)) * cssW;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(minX + 0.5, 0);
        ctx.lineTo(minX + 0.5, cssH);
        ctx.moveTo(maxX + 0.5, 0);
        ctx.lineTo(maxX + 0.5, cssH);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, cssW - 1, cssH - 1);
}

function updateProfileSpectrogram(profileId, mp) {
    return; // Zatial vypnute kym to nebude pouzitelne.
    const idSuffix = profileId === 'default' ? 'default' : String(profileId);
    const speedEl = document.querySelector(`[data-profile-speed-for="${idSuffix}"]`);
    if (speedEl) speedEl.textContent = getProfileSpectrogramSpeedText(mp);

    const canvas = document.getElementById(`profile-spectrogram-${idSuffix}`);
    if (!canvas || !TinyTUS.modulateMessage) return;

    try {
        const waveform = TinyTUS.modulateMessage('test', mp);
        const spec = computeSpectrogramFrames(waveform, Number(mp.sample_rate) || 48000, mp);
        drawProfileSpectrogram(canvas, spec, mp);
    } catch {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(14, 20, 28, 0.92)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.fillText('Nahlad nie je dostupny', 12, 22);
    }
}

function refreshExpandedProfileSpectrograms() {
    const ids = [...profiles.map(p => p.id), 'default'];
    ids.forEach(id => {
        if (!$(`profile-content-${id}`)?.classList.contains('expanded')) return;
        const mp = id === 'default' ? TinyTUS.DEFAULT_MODEM_PROFILE : getProfileById(id)?.modemProfile;
        if (mp) updateProfileSpectrogram(id, mp);
    });
}

/* HTML karty profilu */

function renderProfileFields(mp, idSuffix, readonly) {
    const n = (name, opts) => numField(name, mp, idSuffix, readonly, opts);
    const t = (name, help = '') => toggleField(name, mp, idSuffix, readonly, help);
    const s = (name, opts) => sliderField(name, mp, idSuffix, readonly, opts);
    const sel = (name, opts) => selectField(name, mp, idSuffix, readonly, opts);
    const divider = title => `<div class="section-divider"><div class="section-title">${title}</div></div>`;
    const row = (...fields) => `<div class="profile-field-row">${fields.join('')}</div>`;
    const markerSubsection = `
        <div class="profile-subsection-title">Markery</div>
        <div class="section-description">
            Marker je kratka synchronizacna znacka na zaciatku a konci prenosu. Prijimac ju hlada, aby vedel presne urcit hranice spravy. Dlzka markeru urcuje pocet symbolov a hustota urcuje pocet tonov v markeri.
        </div>`;

    return `
        <!--{renderProfileSpectrogramPreview(mp, idSuffix)}-->
        ${renderShareProfileRow(mp, idSuffix, readonly)}
        ${readonly ? '<div class="profile-readonly-note"><i class="fas fa-lock"></i> Tento profil sa používa na synchronizáciu komunikácie a nedá sa upravovať.</div>' : ''}
        ${renderReadonlyProfileProperties(mp, idSuffix)}
        ${divider('Základné parametre')}
        ${row(sel('samples_per_symbol', { options: [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192], help: 'Počet vzoriek na jeden symbol (mocnina 2)' }),
            n('bits_per_tone', { min: 1, max: 32, help: 'Koľko bitov má jeden tón reprezentovať.' }))}
        ${row(n('tones_per_symbol', { min: 1, max: 255, help: 'Koľko tónov má jeden symbol obsahovať.' }))}
        ${markerSubsection}
        ${row(n('symbols_per_marker', { min: 1, max: 255, help: 'Koľko dĺžok symbolu má jeden marker začiatku alebo konca trvať.' }),
                n('bits_in_marker', { min: 1, max: 255, help: 'Koľko tónov má marker začiatku alebo konca obsahovať.' }))}
        ${divider('TX Parametre (vysielanie)')}
        ${s('max_tx_amp', {
                    min: 0, max: 1, step: 0.01, icon: 'fas fa-volume-high',
                    help: 'Maximálna amplitúda vysielaného signálu',
                    format: v => parseFloat(v).toFixed(2)
                })}
        ${renderFreqPicker(mp, idSuffix, readonly)}

        ${divider('Pokročilé nastavenia')}
        ${s('ecc_percent', {
                    min: 0, max: 1, step: 0.05,
                    help: 'Podiel ECC bajtov (0 % = žiadne, 100 % = maximálna ochrana)',
                    format: v => `${Math.round(v * 100)} %`
                })}
        ${s('squelch_thresh', {
                    min: 0, max: 1, step: 0.005, icon: 'fas fa-filter',
                    help: 'Prahova hodnota squelch - signaly pod touto urovnou su ignorovane',
                    format: v => parseFloat(v).toFixed(3)
                })}
        <div class="profile-field-row" style="gap:24px;align-items:center;">
            ${t('cphase', 'Spojitá fáza (CPM)')} ${t('dss_enabled', 'Vynásobí prenášané bajty pseudonáhodnými číslami, ktoré zaistia rovnomernejšie rozloženie energie v signály.')}
        </div>`;
}

function profileCardHtml({ id, name, mp, active, readonly = false, isDefault = false }) {
    const suffix = isDefault ? 'default' : id;
    const profileAttr = isDefault ? '' : `data-profile-id="${id}"`;

    const headerLeft = isDefault
        ? `<i id="profile-toggle-default" class="fas fa-chevron-right profile-toggle"></i>
              <span class="profile-name-display">Predvolený profil</span>`
        : `<i id="profile-toggle-${id}" class="fas fa-chevron-right profile-toggle"></i>
             <span class="profile-id-label" title="ID profilu">#${id}</span>
           <input type="text" id="profile-name-input-${id}" class="profile-name-input"
                  value="${name}" data-profile-id="${id}" data-field="name"
                  maxlength="${MAX_PROFILE_NAME}" placeholder="Názov profilu"
                  onclick="event.stopPropagation()">`;

    const headerRight = `
        <button class="use-profile-button ${active ? 'use-profile-button--active' : ''}"
                data-action="${isDefault ? 'use-default' : 'use-profile'}" ${profileAttr} ${active ? 'disabled' : ''}>
            ${active ? '<i class="fas fa-check"></i> Používa sa' : 'Použiť'}
        </button>
        ${!isDefault ? `<button class="delete-profile-button" data-profile-id="${id}" data-action="delete">
            <i class="fas fa-times"></i></button>` : ''}`;

    return `
    <div class="profile-item ${isDefault ? 'profile-item--default' : ''} ${active ? 'profile-item--active' : ''}">
        <div class="profile-sticky-sentinel"></div>
        <div class="profile-header" data-action="${isDefault ? 'toggle-default' : 'toggle'}" ${profileAttr}>
            <div class="profile-header-left">${headerLeft}</div>
            <div class="profile-header-right">${headerRight}</div>
        </div>
        <div id="profile-content-${suffix}" class="profile-content">
            ${renderProfileFields(mp, suffix, readonly)}
        </div>
    </div>`;
}

/* Vykreslenie */

function setupStickyHeaderObservers() {
    _stickyObservers.forEach(io => io.disconnect());
    _stickyObservers = [];
    if (!configTabContent) return;
    document.querySelectorAll('.profile-sticky-sentinel').forEach(sentinel => {
        const header = sentinel.nextElementSibling;
        if (!header?.classList.contains('profile-header')) return;
        const io = new IntersectionObserver(([entry]) => {
            header.classList.toggle('profile-header--stuck', !entry.isIntersecting);
        }, { root: configTabContent, threshold: 0 });
        io.observe(sentinel);
        _stickyObservers.push(io);
    });
}

function renderProfiles() {
    if (!container) return;
    const defaultMp = TinyTUS.DEFAULT_MODEM_PROFILE;
    container.innerHTML = [
        ...profiles.map(p => profileCardHtml({ id: p.id, name: p.name, mp: p.modemProfile, active: isProfileActive(p) })),
        defaultMp ? profileCardHtml({ mp: defaultMp, active: isDefaultActive(), readonly: true, isDefault: true }) : '',
        profiles.length === 0 ? '<div class="empty-state">Žiadne vlastné profily. Kliknite na "Pridať profil" pre vytvorenie nového.</div>' : '',
    ].join('');
    populateUsbProfileSelector();
    initFreqPickers();
    setupStickyHeaderObservers();
    setTimeout(() => refreshExpandedProfileSpectrograms(), 50);
}

/* Delegacia eventov */

container?.addEventListener('click', async e => {
    const btn = action => e.target.closest(`[data-action="${action}"]`);
    const codeInput = e.target.closest('.profile-code-input');

    if (btn('copy-profile-code')) {
        e.stopPropagation();
        const copyButton = btn('copy-profile-code');
        const profileId = parseInt(copyButton.dataset.profileId, 10);
        if (!Number.isNaN(profileId)) await copyProfileCode(profileId, copyButton);
        return;
    }

    if (codeInput) {
        e.stopPropagation();
        const profileId = parseInt(codeInput.dataset.profileCodeFor, 10);
        if (!Number.isNaN(profileId)) {
            await copyProfileCode(profileId, codeInput);
        }
        return;
    }

    if (btn('share-profile')) {
        e.stopPropagation();
        const profileId = parseInt(btn('share-profile').dataset.profileId);
        if (!Number.isNaN(profileId)) {
            const profileCode = getProfileCodeById(profileId);
            syncProfileCodeInput(profileId, profileCode);
            window.dispatchEvent(new CustomEvent('chat-share-profile', { detail: { profileCode } }));
        }
        return;
    }

    if (btn('delete')) {
        e.stopPropagation();
        const id = parseInt(btn('delete').dataset.profileId);
        return e.shiftKey ? doDeleteProfile(id) : deleteProfile(id);
    }
    if (btn('use-profile')) {
        e.stopPropagation();
        const profile = getProfileById(parseInt(btn('use-profile').dataset.profileId));
        return profile && setActiveProfile(profile.modemProfile);
    }
    if (btn('use-default')) { e.stopPropagation(); return setActiveProfile(TinyTUS.DEFAULT_MODEM_PROFILE); }
    if (btn('toggle-default')) { return toggleProfile('default'); }
    if (btn('toggle')) { return toggleProfile(parseInt(btn('toggle').dataset.profileId)); }
});

container?.addEventListener('change', e => {
    const { profileId, field, type } = e.target.dataset;
    if (!profileId || !field) return;
    // Odmietni hodnoty, ktore nesplnaju HTML validaciu (min, max, step).
    if (e.target.type === 'number' && !e.target.validity.valid) return;
    const id = parseInt(profileId);
    const value = type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value;
    updateProfile(id, field, value);
});

container?.addEventListener('input', e => {
    if (e.target.classList.contains('profile-name-input')) {
        const { profileId, field } = e.target.dataset;
        if (profileId && field === 'name') {
            updateProfile(parseInt(profileId), field, e.target.value);
        }
    }
});

let lastProfileBeforeAutoSet = null;
function syncAutoProfileWithUSBState() {
    try {
        const autoProfile = getUsbAutoProfile();
        if (autoProfile && TinyTUS.currentlyUsedModemProfile !== autoProfile) {
            console.log('Applying USB auto-profile:', autoProfile);
            lastProfileBeforeAutoSet = TinyTUS.currentlyUsedModemProfile;
            setActiveProfile(autoProfile, 'usb-auto');
        }
    } catch (e) {
        console.warn('Failed to apply USB auto-profile:', e);
    }
}

addButton?.addEventListener('click', addProfile);
importProfileTriggerButton?.addEventListener('click', openImportProfileModal);
importProfileScanButton?.addEventListener('click', startImportProfileScanner);
importProfileCancelButton?.addEventListener('click', closeImportProfileModal);
importProfileConfirmButton?.addEventListener('click', importProfileFromCode);
importProfileModal?.addEventListener('click', e => {
    if (e.target === importProfileModal) closeImportProfileModal();
});
importProfileModalInput?.addEventListener('input', updateImportProfileModalState);
importProfileModalInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        importProfileFromCode();
    }
});
updateImportProfileModalState();
initImportProfileScanAvailability();
confirmButton?.addEventListener('click', confirmDelete);
cancelButton?.addEventListener('click', closeModal);
confirmationModal?.addEventListener('click', e => { if (e.target === confirmationModal) closeModal(); });
usbProfileSelector?.addEventListener('change', e => {
    saveUsbProfileSetting(e.target.value);
    console.log('USB auto-profile set to:', e.target.value || 'none');

    if (window.port != null) {
        syncAutoProfileWithUSBState();
    }
});

/********************************/
/****  OBSERVERS & INIT      ****/
/********************************/

let scrollTimeout;
configTabContent?.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(saveConfigState, 150);
});

window.addEventListener('refresh-local-storage', saveProfiles);

window.addEventListener("usb-device-connected", syncAutoProfileWithUSBState);

window.addEventListener("chat-focus-profile", (event) => {
    const modemProfile = event.detail?.profile;
    if (!modemProfile) return;
    focusProfileForReview(modemProfile);
});

window.addEventListener("active-modem-profile-changed", (e) => {
    const profile = e.detail?.profile;
    if (!profile) return;

    if (e.detail?.source === 'usb-auto') {
        console.log('Active modem profile changed due to USB auto-profile:', profile);
    } else {
        console.log('Active modem profile changed manually, clearing lastProfileBeforeAutoSet');
        lastProfileBeforeAutoSet = null; // only clear on manual change, not USB auto
    }

    updateActiveProfileUI(profile);
});

window.addEventListener("usb-device-disconnected", () => {
    if (lastProfileBeforeAutoSet) {
        console.log('Restoring previous profile after USB disconnect:', lastProfileBeforeAutoSet);
        setActiveProfile(lastProfileBeforeAutoSet, 'usb-auto');
    }
});

TinyTUS.afterLoad(() => {
    loadProfiles();
    renderProfiles();
    restoreConfigState();

    // Zobraz verziu kniznice.
    const versionEl = document.getElementById('lib-version-display');
    if (versionEl && TinyTUS.EXPORTS.get_lib_version) {
        const ptr = TinyTUS.EXPORTS.get_lib_version();
        versionEl.textContent = TinyTUS.getStringFromPointer(ptr) || '-';
    }
});
