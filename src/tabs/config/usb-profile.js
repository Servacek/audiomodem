// USB auto-profil: prepnutie profilu pri pripojeni USB zariadenia.

import { TinyTUS } from '../../../libs/tinytus/tinytus.js';
import { getProfiles, setActiveProfile } from './profile-store.js';

function getUsbProfileSetting() {
    try { return localStorage.getItem('usbDeviceProfile') || ''; } catch { return ''; }
}

export function saveUsbProfileSetting(profileId) {
    try { localStorage.setItem('usbDeviceProfile', profileId || ''); } catch (e) {
        console.error('Failed to save USB profile setting:', e);
    }
}

export function getUsbAutoProfile() {
    const setting = getUsbProfileSetting();
    if (!setting) return null;
    if (setting === 'default') return TinyTUS.DEFAULT_MODEM_PROFILE;
    const profile = getProfiles().find(p => p.id === parseInt(setting));
    return profile ? profile.modemProfile : null;
}

let lastProfileBeforeAutoSet = null;

export function syncAutoProfileWithUSBState() {
    try {
        const autoProfile = getUsbAutoProfile();
        if (autoProfile && TinyTUS.currentlyUsedModemProfile !== autoProfile) {
            lastProfileBeforeAutoSet = TinyTUS.currentlyUsedModemProfile;
            setActiveProfile(autoProfile, 'usb-auto');
        }
    } catch (e) {
        console.warn('Failed to apply USB auto-profile:', e);
    }
}

export function restoreProfileAfterUSBDisconnect() {
    if (lastProfileBeforeAutoSet) {
        setActiveProfile(lastProfileBeforeAutoSet, 'usb-auto');
        lastProfileBeforeAutoSet = null;
    }
}

export function clearAutoProfileOnManualChange() {
    lastProfileBeforeAutoSet = null;
}

export { getUsbProfileSetting };
