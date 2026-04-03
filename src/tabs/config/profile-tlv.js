// TLV kodovanie/dekodovanie profilov, validacia kodu a pridanie profilu z kodu.

import { TinyTUS } from '../../../libs/tinytus/tinytus.js';
import { ModemProfile } from '../../../libs/tinytus/modem_profile.js';
import { addProfileToStore, setActiveProfile } from './profile-store.js';
import { wasmValidateProfile } from './profile-validation.js';

// --- TLV kodovanie ---

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
    // Odstranime iba whitespace a dvojbodky. Pomlcka je validny base64url znak.
    const compact = (code || '').replace(/[\s:]/g, '');
    if (!compact) return null;

    // Povolime base64url aj standardny base64 zapis.
    const withoutPadding = compact.replace(/=+$/g, '');
    if (!withoutPadding) return null;
    if (!/^[A-Za-z0-9+/_-]+$/.test(withoutPadding)) return null;

    try {
        let base64 = withoutPadding.replace(/-/g, '+').replace(/_/g, '/');
        if (!/^[A-Za-z0-9+/]+$/.test(base64)) return null;
        base64 += '='.repeat((4 - (base64.length % 4)) % 4);
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
        const decodeStatus = TinyTUS.EXPORTS.mp_decode_tlv(modemProfile.ptr, ptr, bytes.length);

        // Niektore buildy vracaju 0 pri uspechu, ine vracaju pocet spracovanych bajtov.
        // Chybu berieme iba pri zapornom stave.
        if (decodeStatus < 0) return false;

        // Po dekodovani dopocitaj odvodene polia, aby validacia bezala nad konzistentnym profilom.
        if (TinyTUS.EXPORTS?.calc_modem_profile_fields) {
            TinyTUS.EXPORTS.calc_modem_profile_fields(modemProfile.ptr);
        }

        // Ak dekoder vrati 0, overime este konzistenciu cez kanonicky roundtrip.
        if (decodeStatus === 0) {
            const canonicalInput = bytesToCode(bytes);
            const canonicalOutput = getModemProfileTLVCode(modemProfile);
            if (!canonicalOutput || canonicalOutput !== canonicalInput) return false;
        }

        // Dekodovanie uspesne - overime, ze hodnoty su platne podla WASM.
        return wasmValidateProfile(modemProfile);
    } catch {
        return false;
    } finally {
        TinyTUS.EXPORTS.free(ptr);
    }
}

// --- Validacia kodu ---

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

// --- Pridanie profilu z kodu ---

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
