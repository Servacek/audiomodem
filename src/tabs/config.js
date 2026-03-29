/**
 * @file config.js
 * @description Orchestrator konfiguracneho tabu. Inicializuje submoduly a spaja eventy.
 */

import { TinyTUS } from '../../libs/tinytus/tinytus.js';
import { ModemProfile } from '../../libs/tinytus/modem_profile.js';
import * as VersionTracker from '../wasmVersionTracker.js';

import { loadProfiles, saveProfiles, addProfileToStore, removeProfileFromStore, getProfileById, getProfiles, setActiveProfile, getAllModemProfilesForDemodulation, getModemProfileMeta } from './config/profile-store.js';
import { isValidProfileCode, addProfileFromCodeAndActivate, initImportModal } from './config/profile-import.js';
import { updateProfileSpectrogram } from './config/profile-spectrogram.js';
import { renderProfiles, updateActiveProfileUI, toggleProfile, updateReadonlyProps, updateProfileCodeUI, updateWaveInfo, initContainerEvents } from './config/profile-render.js';
import { saveUsbProfileSetting, getUsbAutoProfile, syncAutoProfileWithUSBState, restoreProfileAfterUSBDisconnect, clearAutoProfileOnManualChange } from './config/usb-profile.js';
import { updateFreqPickerRange } from '../freq_picker.js';

// Re-exporty pre ostatne moduly (chat.js, index.js).
export { getAllModemProfilesForDemodulation, getModemProfileMeta, isValidProfileCode, addProfileFromCodeAndActivate, getUsbAutoProfile };

// ─── DOM ──────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const container          = $('profiles-container');
const addButton          = $('add-profile-button');
const confirmationModal  = $('confirmation-modal');
const confirmButton      = $('confirmation-confirm-button');
const cancelButton       = $('confirmation-cancel-button');
const configTabContent   = $('tab-config');
const usbProfileSelector = $('usb-profile-selector');

// ─── Mazanie profilu (modal potvrdenia) ───────────────────────────────────────

let profileToDelete = null;

function doDelete(id) {
    removeProfileFromStore(id);
    rerender();
}

function confirmDelete(id) {
    profileToDelete = id;
    confirmationModal.style.display = 'flex';
}

function closeModal() {
    confirmationModal.style.display = 'none';
    profileToDelete = null;
}

confirmButton?.addEventListener('click', () => {
    if (profileToDelete !== null) doDelete(profileToDelete);
    profileToDelete = null;
    closeModal();
});
cancelButton?.addEventListener('click', closeModal);
confirmationModal?.addEventListener('click', e => { if (e.target === confirmationModal) closeModal(); });

// ─── Zmena pola profilu ───────────────────────────────────────────────────────

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

function onProfileOpened(id) {
    const mp = id === 'default' ? TinyTUS.DEFAULT_MODEM_PROFILE : getProfileById(id)?.modemProfile;
    if (mp) updateProfileSpectrogram(TinyTUS, id, mp);
}

// ─── Vykreslenie ──────────────────────────────────────────────────────────────

function rerender() {
    renderProfiles(container, configTabContent, usbProfileSelector);
    initContainerEvents(container, { doDelete, confirmDelete, onProfileChanged: saveAndUpdateUI, onFieldChanged, onProfileOpened });
}

function saveAndUpdateUI() {
    saveProfiles();
    rerender();
}

// ─── Pridanie noveho profilu ──────────────────────────────────────────────────

function addProfile(event = null) {
    const mp = new ModemProfile();
    const newProfile = addProfileToStore(mp);
    if (!newProfile) return;

    rerender();

    setTimeout(() => {
        const content = $(`profile-content-${newProfile.id}`);
        const nameInput = $(`profile-name-input-${newProfile.id}`);
        content?.classList.add('expanded');
        $(`profile-toggle-${newProfile.id}`)?.classList.add('expanded');
        onProfileOpened(newProfile.id);
        if (nameInput && !event?.shiftKey) { nameInput.focus(); nameInput.select(); }
    }, 100);
}

addButton?.addEventListener('click', addProfile);

// ─── USB profil selector ──────────────────────────────────────────────────────

usbProfileSelector?.addEventListener('change', e => {
    saveUsbProfileSetting(e.target.value);
    if (window.port != null) syncAutoProfileWithUSBState();
});

// ─── Persistencia stavu tabu ──────────────────────────────────────────────────

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
            const toggle  = $(`profile-toggle-${id}`);
            if (!content || !toggle) return;
            content.classList.add('expanded');
            toggle.classList.add('expanded');
            onProfileOpened(id);
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

// ─── Globalne eventy ──────────────────────────────────────────────────────────

window.addEventListener('refresh-local-storage', saveProfiles);

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

// ─── Init po nacitani WASM ────────────────────────────────────────────────────

TinyTUS.afterLoad(() => {
    loadProfiles();
    rerender();
    restoreConfigState();
    initImportModal();

    // Zobraz verziu kniaznice.
    const versionEl = $('lib-version-display');
    if (versionEl && TinyTUS.EXPORTS.get_lib_version) {
        const ptr = TinyTUS.EXPORTS.get_lib_version();
        const currentVersion = TinyTUS.getStringFromPointer(ptr) || '-';

        const versionChangeInfo = VersionTracker.checkVersionChanged(currentVersion);
        if (versionChangeInfo.changed) {
            VersionTracker.recordVersionChange(versionChangeInfo);
            VersionTracker.saveLastUpdatedDate();
            const message = VersionTracker.getVersionChangeMessage(versionChangeInfo);
            (async () => {
                const { displaySystemMessage } = await import('./chat.js');
                displaySystemMessage(message, 'info');
            })();
        } else if (!VersionTracker.getLastSavedVersion()) {
            VersionTracker.saveLastUpdatedDate();
        }

        VersionTracker.saveCurrentVersion(currentVersion);
        versionEl.textContent = `v${currentVersion}`;
        const lastUpdated = VersionTracker.getLastUpdatedDate();
        if (lastUpdated) versionEl.textContent += ` (${VersionTracker.formatLastUpdatedDate(lastUpdated)})`;
    }
});
