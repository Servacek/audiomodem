// Validacia modem profilu.
//
// Strategia:
// 1. JS-strana: lacna predbezna kontrola - len typ a hruby rozsah, aby sa zabranilo
//    zrejme nespravnym hodnotam (napr. retazce, NaN, zaporne cisla kde nie su povolene).
// 2. WASM mp_validate: autoritativna validacia po kazdom zapise do profilu.
//    Ak mp_validate zlyha, zapis sa vrati naspat na povodnu hodnotu.

import { TinyTUS } from '../../../libs/tinytus/tinytus.js';
import { VALIDATION } from './profile-strings.js';

// Hruby rozsah a typ pre kazde pole - len predbezna ochrana pred zrejme nespravnymi hodnotami.
const FIELD_RULES = {
    samples_per_symbol: { min: 2,    max: 8192,   integer: true, pow2: true },
    bits_per_tone:      { min: 1,    max: 32,     integer: true },
    tones_per_symbol:   { min: 1,    max: 255,    integer: true },
    symbols_per_marker: { min: 1,    max: 255,    integer: true },
    bits_in_marker:     { min: 1,    max: 255,    integer: true },
    ecc_percent:        { min: 0,    max: 1,      integer: false },
    squelch_thresh:     { min: 0,    max: 1,      integer: false },
    max_tx_amp:         { min: 0,    max: 1,      integer: false },
    min_tx_freq:        { min: 1,    max: 24000,  integer: false },
    max_tx_freq:        { min: 1,    max: 24000,  integer: false },
    sample_rate:        { min: 8000, max: 192000, integer: true },
};

// Polia ktore su vypocitane z inych poli a nesmu byt menene priamo.
// min_tx_freq a max_tx_freq su nastavovane cez freq_picker, preto nie su readonly.
const READONLY_FIELDS = new Set([
    'freq_bin_hz', 'sample_duration', 'symbol_rate', 'channel_size',
]);

export function isReadonlyField(field) {
    return READONLY_FIELDS.has(field);
}

// Predbezna JS validacia - len typ a hruby rozsah.
// Vrati {valid, value, error}.
export function preValidateFieldValue(field, rawValue) {
    const rule = FIELD_RULES[field];

    if (!rule) {
        const num = parseFloat(rawValue);
        if (!Number.isFinite(num)) return { valid: false, error: VALIDATION.invalidValue };
        return { valid: true, value: num };
    }

    const num = rule.integer ? parseInt(rawValue, 10) : parseFloat(rawValue);

    if (!Number.isFinite(num)) return { valid: false, error: VALIDATION.notANumber };
    if (num < rule.min || num > rule.max) return { valid: false, error: VALIDATION.outOfRange(rule.min, rule.max) };
    if (rule.pow2 && (num & (num - 1)) !== 0) return { valid: false, error: VALIDATION.notPow2 };

    return { valid: true, value: num };
}

// Autoritativna validacia cez WASM mp_validate.
// Vrati true ak je profil platny.
export function wasmValidateProfile(mp) {
    console.log("Validating profile with mp_validate...");
    console.log("IS AVAILABLE EXPORTS:", TinyTUS.EXPORTS?.mp_validate);
    if (!TinyTUS.EXPORTS?.mp_validate || !mp?.ptr) {
        console.warn("WASM not available for validation.");
        return true; // WASM este nie je nacitany - prepust.
    }
    try {
        return TinyTUS.EXPORTS.mp_validate(mp.ptr) !== 0;
    } catch {
        return false;
    }
}

export { FIELD_RULES };
