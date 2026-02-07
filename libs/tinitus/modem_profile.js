import { Tinitus } from "./tinitus.js";


export class ModemProfile {
    constructor(config = {}) {
        // Alokujeme miesto pre novy modem profil a ulozime si jeho pointer.
        this.ptr = Tinitus.EXPORTS.mp_create();

        // Najdeme vsetky gettery a settery jednotlivych parametrov profilu.
        this._fields = {};
        for (const exportName in Tinitus.EXPORTS) {
            if (exportName.startsWith("mp_get_")) {
                const fieldName = exportName.substring("mp_get_".length);
                this._fields[fieldName] = this._fields[fieldName] || {};
                this._fields[fieldName].getter = Tinitus.EXPORTS[exportName];
            } else if (exportName.startsWith("mp_set_")) {
                const fieldName = exportName.substring("mp_set_".length);
                this._fields[fieldName] = this._fields[fieldName] || {};
                this._fields[fieldName].setter = Tinitus.EXPORTS[exportName];
            }
        }

        // Nastavime vsetky parametre ktore uzivatel
        // zadal pri vytvarani tohto profilu.
        for (const [key, value] of Object.entries(config)) {
            if (this._fields[key]?.setter) {
                this._fields[key].setter(this.ptr, value);
            }
        }

        // Vypocitame vsetky odvodené polia profilu (readonly).
        Tinitus.EXPORTS.calc_modem_profile_fields(this.ptr);

        // Vytvorime atributy tejto triedy dynamicky na zaklade
        // zozbieranych getterov a setterov.
        this._createDynamicProperties();
    }

    _createDynamicProperties() {
        for (const [fieldName, funcs] of Object.entries(this._fields)) {
            Object.defineProperty(this, fieldName, {
                get: () => funcs.getter(this.ptr),
                // Pre readonly polia nebude setter definovany,
                // takze ich nebude mozne menit.
                set: funcs.setter ? (value) => {
                    funcs.setter(this.ptr, value);
                    Tinitus.EXPORTS.calc_modem_profile_fields(this.ptr);
                } : undefined,
                enumerable: true
            });
        }
    }

    // Ak chceme aktualizovat viacero parametrov naraz a nechceme
    // zakazdym prepocitavat odvodene polia.
    update(config) {
        for (const [key, value] of Object.entries(config)) {
            if (this._fields[key]?.setter) {
                this._fields[key].setter(this.ptr, value);
            }
        }
        Tinitus.EXPORTS.calc_modem_profile_fields(this.ptr);
    }

    // Vrati vsetky nastavitelne polia ako objekt
    toObject() {
        const obj = {};
        for (const fieldName of Object.keys(this._fields)) {
            obj[fieldName] = this[fieldName];
        }
        return obj;
    }

    // Uvolni miesto ktore bolo alokovane pre tento modemovy profil.
    destroy() {
        if (this.ptr) {
            Tinitus.EXPORTS.free(this.ptr);
            this.ptr = null;
        }
    }
}
