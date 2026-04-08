// Rychly vyber profilu pod vstupnym barom v tabule Spravy.

import { TinyTUS } from '../../libs/tinytus/tinytus.js';
import { getProfiles, setActiveProfile } from './config.js';

const wrapper = document.getElementById('quick-config-wrapper');
const select  = document.getElementById('quick-profile-select');

function getOptionLabel(profile) {
    const label = profile.readonly ? profile.name : `#${profile.id} ${profile.name}`;
    return label;
}

function rebuild() {
    const current = TinyTUS.currentlyUsedModemProfile;
    const profiles = getProfiles();

    select.innerHTML = '';

    // Predvoleny profil.
    const defOpt = document.createElement('option');
    defOpt.value = 'default';
    defOpt.textContent = 'Predvolený profil';
    defOpt.selected = current === TinyTUS.DEFAULT_MODEM_PROFILE;
    select.appendChild(defOpt);

    profiles.forEach(p => {
        const opt = document.createElement('option');
        opt.value = String(p.id);
        opt.textContent = getOptionLabel(p);
        opt.selected = current === p.modemProfile;
        select.appendChild(opt);
    });
}

function show() {
    wrapper.style.display = '';
}

select.addEventListener('change', () => {
    const val = select.value;
    if (val === 'default') {
        setActiveProfile(TinyTUS.DEFAULT_MODEM_PROFILE);
        return;
    }
    const id = parseInt(val, 10);
    const profile = getProfiles().find(p => p.id === id);
    if (profile) setActiveProfile(profile.modemProfile);
});

window.addEventListener('profiles-updated',            rebuild);
window.addEventListener('active-modem-profile-changed', rebuild);
window.addEventListener('wasm-library-loaded', () => { rebuild(); show(); });

if (TinyTUS.isLibraryLoaded()) { rebuild(); show(); }
