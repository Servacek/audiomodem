// TLV kodovanie/dekodovanie profilov, validacia kodu a pridanie profilu z kodu.

import { TinyTUS } from '../../../libs/tinytus/tinytus.js';
import { ModemProfile } from '../../../libs/tinytus/modem_profile.js';
import { addProfileToStore, setActiveProfile } from './profile-store.js';
import { wasmValidateProfile } from './profile-validation.js';

// ─── TLV kodovanie ────────────────────────────────────────────────────────────

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

// ─── Validacia kodu ───────────────────────────────────────────────────────────

export function validateProfileCode(code) {
    const trimmed = (code || '').trim();
    if (!trimmed) return { valid: false, message: '' };

    const bytes = codeToBytes(trimmed);
    if (!bytes) return { valid: false, message: 'Kód nemá správny formát.' };
    if (!TinyTUS.EXPORTS?.mp_decode_tlv) return { valid: false, message: 'Knižnica ešte nie je načítaná.' };

    const temp = new ModemProfile();
    try {
        return applyProfileCodeToModemProfile(temp, trimmed)
            ? { valid: true,  message: 'Kód profilu je platný.'   }
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

// ─── Pridanie profilu z kodu ──────────────────────────────────────────────────

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
