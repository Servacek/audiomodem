// Sprava zoznamu profilov, persistencia a aktivny profil.

import { TinyTUS } from '../../../libs/tinytus/tinytus.js';
import { ModemProfile } from '../../../libs/tinytus/modem_profile.js';
import { preValidateFieldValue, wasmValidateProfile } from './profile-validation.js';
import { STORE } from './profile-strings.js';
import { clearAttenuationData } from '../../freq_picker.js';

const MAX_PROFILES = 10;
const MAX_PROFILE_NAME = 24;
const MAX_CHANNEL_COUNT = 8;

let profiles = [];

// --- Pomocne funkcie ---

function clampChannelCount(value) {
    return Math.max(1, Math.min(MAX_CHANNEL_COUNT, value));
}

function getDefaultChannelCount() {
    const mp = TinyTUS.DEFAULT_MODEM_PROFILE;
    if (!mp) return 1;
    const span = Math.max(1, Math.abs(Number(mp.max_tx_freq) - Number(mp.min_tx_freq)));
    const channelSize = Number(mp.channel_size);
    if (!Number.isFinite(channelSize) || channelSize <= 0) return 1;
    return clampChannelCount(Math.round(span / channelSize));
}

export function normalizeChannelCount(value, fallback = null) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback ?? getDefaultChannelCount();
    return clampChannelCount(parsed);
}

export function estimateChannelCountFromModemProfile(mp) {
    const span = Math.max(1, Math.abs(Number(mp?.max_tx_freq) - Number(mp?.min_tx_freq)));
    const channelSize = Number(mp?.channel_size);
    if (Number.isFinite(channelSize) && channelSize > 0) {
        return normalizeChannelCount(Math.round(span / channelSize));
    }
    return getDefaultChannelCount();
}

// --- Persistencia ---

function isProfileIntegrityOk(mp) {
    return wasmValidateProfile(mp);
}

export function loadProfiles() {
    try {
        const parsed = JSON.parse(localStorage.getItem('modemProfiles') || 'null');
        if (parsed) {
            profiles = parsed.flatMap(p => {
                try {
                    const modemProfile = new ModemProfile(p);
                    if (!isProfileIntegrityOk(modemProfile)) {
                        console.warn(`Profil ${p.id} (${p.name}) ma neplatne hodnoty a bol odstraneny.`, modemProfile.toObject());
                        modemProfile.destroy();
                        return [];
                    }
                    return [{
                        id: p.id,
                        name: p.name,
                        channelCount: normalizeChannelCount(p.channelCount, estimateChannelCountFromModemProfile(modemProfile)),
                        modemProfile,
                    }];
                } catch (e) {
                    console.warn(`Profil ${p.id} sa nepodarilo nacitat, bol odstraneny:`, e);
                    return [];
                }
            });
            // Ak boli niektore profily neplatne, uloz ocisteny zoznam.
            if (profiles.length < parsed.length) saveProfiles();
        }
    } catch { profiles = []; }
}

export function saveProfiles() {
    localStorage.setItem('modemProfiles', JSON.stringify(
        profiles.map(p => ({
            id: p.id,
            name: p.name,
            channelCount: normalizeChannelCount(p.channelCount, estimateChannelCountFromModemProfile(p.modemProfile)),
            ...p.modemProfile.toObject(),
        }))
    ));
}

// --- Pristup k profilom ---

export function getProfiles() {
    return profiles;
}

export function getProfileById(id) {
    return profiles.find(p => p.id === id) || null;
}

export function findFreeProfileID() {
    const ids = new Set(profiles.map(p => p.id));
    let id = 1;
    while (ids.has(id)) id++;
    return id;
}

export function ensureCanAddProfile() {
    if (profiles.length < MAX_PROFILES) return true;
    alert(STORE.tooManyProfiles(MAX_PROFILES));
    return false;
}

// --- Zakladne operacie ---

export function addProfileToStore(modemProfile) {
    if (!wasmValidateProfile(modemProfile)) {
        console.warn('Pokus o pridanie neplatneho profilu bol zamietnuty.');
        modemProfile?.destroy?.();
        return null;
    }
    if (!ensureCanAddProfile()) {
        modemProfile?.destroy?.();
        return null;
    }

    const id = findFreeProfileID();
    const profile = {
        id,
        name: `Profil ${id}`,
        channelCount: estimateChannelCountFromModemProfile(modemProfile),
        modemProfile,
    };
    profiles.unshift(profile);
    saveProfiles();
    return profile;
}

export function removeProfileFromStore(id) {
    const profile = profiles.find(p => p.id === id);
    if (profile?.modemProfile) {
        if (isProfileActive(profile)) setActiveProfile(TinyTUS.DEFAULT_MODEM_PROFILE);
        profile.modemProfile.destroy();
    }
    clearAttenuationData(id);
    profiles = profiles.filter(p => p.id !== id);
    saveProfiles();
}

// Aktualizuje pole profilu. Vrati false ak validacia zlyhala.
// Postup: 1. predbezna JS validacia (typ, rozsah)
//         2. zapis do WASM pamate
//         3. mp_validate - ak zlyha, vrat povodnu hodnotu (rollback)
export function updateProfileField(id, field, value) {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return false;

    if (field === 'name') {
        profile.name = (value || `Profil ${id}`).substring(0, MAX_PROFILE_NAME).trim();
        saveProfiles();
        return true;
    }

    if (field === 'channel_count') {
        profile.channelCount = normalizeChannelCount(value, profile.channelCount);
        saveProfiles();
        return true;
    }

    // Faza 1: predbezna JS validacia.
    const pre = preValidateFieldValue(field, value);
    if (!pre.valid) {
        console.warn(`Neplatna hodnota pre pole ${field}:`, pre.error);
        return false;
    }

    // Faza 2: zapis do WASM pamate a ziskaj povodnu hodnotu pre rollback.
    const previousValue = profile.modemProfile[field];
    profile.modemProfile[field] = pre.value;

    // Faza 3: autoritativna validacia cez mp_validate.
    if (!wasmValidateProfile(profile.modemProfile)) {
        console.warn(`mp_validate zlyhalo po nastaveni ${field}=${pre.value}, navrat na ${previousValue}.`);
        profile.modemProfile[field] = previousValue;
        return false;
    }

    saveProfiles();
    return true;
}

// --- Aktivny profil ---

export const isProfileActive = profile => TinyTUS.currentlyUsedModemProfile === profile.modemProfile;
export const isDefaultActive = () => TinyTUS.currentlyUsedModemProfile === TinyTUS.DEFAULT_MODEM_PROFILE;

export function setActiveProfile(modemProfile, source = 'manual') {
    TinyTUS.currentlyUsedModemProfile = modemProfile;
    window.dispatchEvent(new CustomEvent('active-modem-profile-changed', { detail: { profile: modemProfile, source } }));
}

// --- Metadata profilov ---

export function getModemProfileMeta(modemProfile) {
    if (!modemProfile) return { idLabel: '?', name: STORE.unknownProfile, id: null };
    if (modemProfile === TinyTUS.DEFAULT_MODEM_PROFILE) {
        return { idLabel: 'default', name: STORE.defaultProfile, id: 'default' };
    }
    const profile = profiles.find(p => p.modemProfile === modemProfile);
    if (!profile) return { idLabel: '?', name: STORE.unknownProfile, id: null };
    return {
        idLabel: String(profile.id),
        name: profile.name || `Profil ${profile.id}`,
        id: profile.id,
    };
}

export function getAllModemProfilesForDemodulation() {
    const all = [
        TinyTUS.currentlyUsedModemProfile,
        ...profiles.map(p => p.modemProfile),
        TinyTUS.DEFAULT_MODEM_PROFILE,
    ];
    return all.filter((p, i, arr) => p && arr.indexOf(p) === i);
}

export { MAX_PROFILES, MAX_PROFILE_NAME, MAX_CHANNEL_COUNT };
