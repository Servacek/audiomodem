/**
 * @file config.js
 * @description Riadiaci modul konfiguracneho tabu. Inicializuje submoduly a spaja eventy.
 */

import { TinyTUS } from '../../libs/tinytus/tinytus.js';
import { ModemProfile } from '../../libs/tinytus/modem_profile.js';

import { loadProfiles, saveProfiles, addProfileToStore, removeProfileFromStore, getProfileById, getProfiles, setActiveProfile, getAllModemProfilesForDemodulation, getModemProfileMeta } from './config/profile-store.js';
import { isValidProfileCode, addProfileFromCodeAndActivate, getModemProfileTLVCode } from './config/profile-tlv.js';
import { initImportModal } from './config/profile-import.js';
import { initShareModal, openShareModal } from './config/profile-share-modal.js';
import { updateProfileSpectrogram } from './config/profile-spectrogram.js';
import { renderProfiles, updateActiveProfileUI, toggleProfile, updateReadonlyProps, updateProfileCodeUI, updateWaveInfo, initContainerEvents } from './config/profile-render.js';
import { saveUsbProfileSetting, getUsbAutoProfile, syncAutoProfileWithUSBState, restoreProfileAfterUSBDisconnect, clearAutoProfileOnManualChange } from './config/usb-profile.js';
import { initDeleteConfirmation } from './config/delete-confirmation.js';
import { updateLibraryVersionInfo } from './config/library-version.js';
import { updateFreqPickerRange } from '../freq_picker.js';

// Re-exporty pre ostatne moduly (chat.js, index.js).
export { getAllModemProfilesForDemodulation, getModemProfileMeta, isValidProfileCode, addProfileFromCodeAndActivate, getUsbAutoProfile, getProfiles, setActiveProfile };

// --- DOM ---

const $ = id => document.getElementById(id);

const container          = $('profiles-container');
const addButton          = $('add-profile-button');
const configTabContent   = $('tab-config');
const usbProfileSelector = $('usb-profile-selector');

// --- Mazanie profilu (modal potvrdenia) ---

function doDelete(id) {
    removeProfileFromStore(id);
    rerender();
}

const { confirmDelete } = initDeleteConfirmation(doDelete);

// --- Zmena pola profilu ---

function onFieldChanged(id, field) {
    const profile = getProfileById(id);
    if (!profile) return;

    const mp = profile.modemProfile;

    if (field === 'channel_count' || field === 'sample_rate' || field === 'samples_per_symbol') {
        updateFreqPickerRange(id, {
            ...mp.toObject(),
            sample_rate: mp.sample_rate,
            freq_bin_hz: mp.freq_bin_hz,
            channel_count: profile.channelCount,
        });
    }

    if (field !== 'name' && field !== 'channel_count') {
        window.dispatchEvent(new CustomEvent('modem-profile-updated', { detail: { profile: mp } }));
    }

    updateReadonlyProps(id, mp, profile.channelCount);
    updateProfileCodeUI(id, mp);
    updateProfileSpectrogram(TinyTUS, id, mp);
    updateWaveInfo(id, mp);
}

function shareProfile(id) {
    const profile = getProfileById(id);
    if (!profile) return;
    const code = getModemProfileTLVCode(profile.modemProfile);
    openShareModal(profile.name || `Profil ${id}`, code);
}

function onProfileOpened(id) {
    const mp = id === 'default' ? TinyTUS.DEFAULT_MODEM_PROFILE : getProfileById(id)?.modemProfile;
    if (mp) updateProfileSpectrogram(TinyTUS, id, mp);
}

// --- Vykreslenie ---

function rerender() {
    renderProfiles(container, configTabContent, usbProfileSelector);
}

function saveAndUpdateUI() {
    saveProfiles();
    rerender();
}

// --- Pridanie noveho profilu ---

function addProfile(event = null) {
    const mp = new ModemProfile();
    const newProfile = addProfileToStore(mp);
    if (!newProfile) return;

    rerender();

    setTimeout(() => {
        const nameInput = $(`profile-name-input-${newProfile.id}`);
        toggleProfile(newProfile.id, onProfileOpened);
        if (nameInput && !event?.shiftKey) { nameInput.focus(); nameInput.select(); }
    }, 100);
}

addButton?.addEventListener('click', addProfile);

// --- USB profil selector ---

usbProfileSelector?.addEventListener('change', e => {
    saveUsbProfileSetting(e.target.value);
    if (window.port != null) syncAutoProfileWithUSBState();
});

// --- Persistencia stavu tabu ---

function saveConfigState() {
    const expanded = ['default', ...getProfiles().map(p => p.id)]
        .filter(id => $(`profile-content-${id}`)?.classList.contains('expanded'));
    localStorage.setItem('configTabState', JSON.stringify({
        activeProfileId: TinyTUS.currentlyUsedModemProfile === TinyTUS.DEFAULT_MODEM_PROFILE
            ? 'default'
            : getProfiles().find(p => p.modemProfile === TinyTUS.currentlyUsedModemProfile)?.id ?? 'default',
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
            : getProfiles().find(p => p.id === state.activeProfileId)?.modemProfile;
        if (profileToActivate) setActiveProfile(profileToActivate);

        state.expandedProfiles?.forEach(id => {
            const content = $(`profile-content-${id}`);
            if (!content || content.classList.contains('expanded')) return;
            toggleProfile(id, onProfileOpened);
        });

        if (state.scrollPosition && configTabContent) {
            setTimeout(() => { configTabContent.scrollTop = state.scrollPosition; }, 100);
        }
    } catch { /* Ignoruj poskodeny stav. */ }
}

let scrollTimeout;
configTabContent?.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(saveConfigState, 150);
});

// --- Globalne eventy ---

window.addEventListener('refresh-local-storage', saveProfiles);

window.addEventListener('profile-store-changed', () => {
    rerender();
    updateActiveProfileUI(TinyTUS.currentlyUsedModemProfile);
    saveConfigState();
});

window.addEventListener('active-modem-profile-changed', e => {
    const profile = e.detail?.profile;
    if (!profile) return;
    if (e.detail?.source !== 'usb-auto') clearAutoProfileOnManualChange();
    updateActiveProfileUI(profile);
    saveConfigState();
});

window.addEventListener('usb-device-connected', syncAutoProfileWithUSBState);
window.addEventListener('usb-device-disconnected', restoreProfileAfterUSBDisconnect);

window.addEventListener('chat-focus-profile', e => {
    const modemProfile = e.detail?.profile;
    if (!modemProfile) return;

    const meta = getModemProfileMeta(modemProfile);
    if (meta.id == null) return;

    document.getElementById('config-button')?.click();

    const focusAndReveal = () => {
        const content = $(`profile-content-${meta.id}`);
        if (!content) return false;
        if (!content.classList.contains('expanded')) toggleProfile(meta.id, onProfileOpened);
        content.closest('.profile-item')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
    };

    if (!focusAndReveal()) {
        setTimeout(focusAndReveal, 80);
        setTimeout(focusAndReveal, 220);
    }
});

// --- Init po nacitani WASM ---

TinyTUS.afterLoad(() => {
    loadProfiles();
    rerender();
    initContainerEvents(container, { doDelete, confirmDelete, onProfileChanged: saveAndUpdateUI, onFieldChanged, onProfileOpened, shareProfile });
    restoreConfigState();
    initImportModal();
    initShareModal(code => window.dispatchEvent(new CustomEvent('chat-share-profile', { detail: { profileCode: code } })));

    updateLibraryVersionInfo();
});
