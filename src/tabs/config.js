/**
 * @file config.js
 * @description Správa modemových profilov a ich konfigurácie
 */

import { TinyTUS } from '../../libs/tinytus/tinytus.js';
import { ModemProfile } from '../../libs/tinytus/modem_profile.js';
import { renderFreqPicker, initFreqPickers } from '../freq_picker.js';

/********************************/
/****  CONSTANTS             ****/
/********************************/

const MAX_PROFILES     = 10;
const MAX_PROFILE_NAME = 24;

const PARAM_LABELS = {
    min_rx_freq:        "Min RX frekvencia (Hz)",
    max_rx_freq:        "Max RX frekvencia (Hz)",
    sample_rate:        "Vzorkovacia frekvencia (Hz)",
    bits_per_symbol:    "Bity na symbol",
    bytes_per_tx_block: "Bajtov v TX bloku",
    ecc_percent:        "Podiel samoopravných bajtov",
    dss_enabled:        "DSS (rozptyl spektra)",
    squelch_thresh:     "Squelch prah",
    cphase:             "Spojitá fáza",
    max_tx_amp:         "Max TX amplitúda (hlasitosť)",
    samples_per_symbol: "Počet vzorkov na jeden symbol",
};

/********************************/
/****  STATE & DOM REFS      ****/
/********************************/

let profiles = [];
let profileToDelete = null;

const $ = id => document.getElementById(id);
const container         = $('profiles-container');
const addButton         = $('add-profile-button');
const confirmationModal = $('confirmation-modal');
const confirmButton     = $('confirmation-confirm-button');
const cancelButton      = $('confirmation-cancel-button');
const configTabContent  = $('tab-config');
const usbProfileSelector = $('usb-profile-selector');

/********************************/
/****  USB DEVICE SETTINGS   ****/
/********************************/

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

    // Clear existing options except the first (default)
    usbProfileSelector.innerHTML = '<option value="">Ponechať aktuálny profil</option>';

    // Add default profile option
    const defaultOption = document.createElement('option');
    defaultOption.value = 'default';
    defaultOption.textContent = 'Predvolený profil';
    usbProfileSelector.appendChild(defaultOption);

    // Add custom profiles
    profiles.forEach(profile => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        usbProfileSelector.appendChild(option);
    });

    // Restore previous selection
    usbProfileSelector.value = currentSelection;
}

export function getUsbAutoProfile() {
    const setting = getUsbProfileSetting();
    if (!setting) return null;
    if (setting === 'default') return TinyTUS.DEFAULT_MODEM_PROFILE;

    const profile = profiles.find(p => p.id === parseInt(setting));
    return profile ? profile.modemProfile : null;
}

/********************************/
/****  PERSISTENCE           ****/
/********************************/

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
        activeProfileId:  isDefaultActive() ? 'default' : profiles.find(p => isProfileActive(p))?.id ?? 'default',
        expandedProfiles: expanded,
        scrollPosition:   configTabContent?.scrollTop || 0,
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
            const toggle  = $(`profile-toggle-${id}`);
            if (!content || !toggle) return;
            content.classList.add('expanded');
            toggle.classList.add('expanded');
            setTimeout(() => drawWaveVisualization(id), 50);
        });

        if (state.scrollPosition && configTabContent)
            setTimeout(() => { configTabContent.scrollTop = state.scrollPosition; }, 100);
    } catch { /* ignore corrupt state */ }
}

/********************************/
/****  PROFILE MANAGEMENT    ****/
/********************************/

const isProfileActive = profile => TinyTUS.currentlyUsedModemProfile === profile.modemProfile;
const isDefaultActive = ()      => TinyTUS.currentlyUsedModemProfile === TinyTUS.DEFAULT_MODEM_PROFILE;

function updateActiveProfileUI(modemProfile) {
    // Remove active class from all profiles
    document.querySelectorAll('.profile-item--active').forEach(el => el.classList.remove('profile-item--active'));

    // Determine which profile is now active
    const isDefault = modemProfile === TinyTUS.DEFAULT_MODEM_PROFILE;
    const activeId = isDefault ? 'default' : profiles.find(p => p.modemProfile === modemProfile)?.id;

    if (!activeId) return;

    // Add active class to the newly active profile
    const activeProfileItem = document.querySelector(`#profile-content-${activeId}`)?.parentElement;
    if (activeProfileItem) activeProfileItem.classList.add('profile-item--active');

    // Update all "Použiť" buttons
    document.querySelectorAll('[data-action="use-profile"], [data-action="use-default"]').forEach(btn => {
        const btnProfileId = btn.dataset.profileId ? parseInt(btn.dataset.profileId) : 'default';
        const isThisActive = btnProfileId === activeId;

        btn.disabled = isThisActive;
        btn.classList.toggle('use-profile-button--active', isThisActive);
        btn.innerHTML = isThisActive ? '<i class="fas fa-check"></i> Používa sa' : 'Použiť';
    });
}

function setActiveProfile(modemProfile) {
    TinyTUS.currentlyUsedModemProfile = modemProfile;
    window.dispatchEvent(new CustomEvent("active-modem-profile-changed", { detail: { profile: modemProfile } }));
    updateActiveProfileUI(modemProfile);
    saveConfigState();
}

function findFreeProfileID() {
    const ids = new Set(profiles.map(p => p.id));
    let id = 1;
    while (ids.has(id)) id++;
    return id;
}

function addProfile(event = null) {
    if (profiles.length >= MAX_PROFILES) {
        alert(`Maximálny počet profilov je ${MAX_PROFILES}. Odstráňte niektorý z existujúcich profilov.`);
        return;
    }
    const id         = findFreeProfileID();
    const newProfile = { id, name: `Profil ${id}`, modemProfile: new ModemProfile() };
    profiles.unshift(newProfile);
    saveProfiles();
    renderProfiles();

    setTimeout(() => {
        const content   = $(`profile-content-${id}`);
        const nameInput = $(`profile-name-input-${id}`);
        content?.classList.add('expanded');
        $(`profile-toggle-${id}`)?.classList.add('expanded');
        if (nameInput && !event?.shiftKey) {
            nameInput.focus();
            nameInput.select();
            drawWaveVisualization(id);
        }
        initFreqPickers();
    }, 100);
}

function doDeleteProfile(id) {
    const profile = profiles.find(p => p.id === id);
    if (profile?.modemProfile) {
        if (isProfileActive(profile)) setActiveProfile(TinyTUS.DEFAULT_MODEM_PROFILE);
        profile.modemProfile.destroy();
    }
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

/********************************/
/****  UI ACTIONS            ****/
/********************************/

function toggleProfile(id) {
    const content = $(`profile-content-${id}`);
    const toggle  = $(`profile-toggle-${id}`);
    const opening = !content.classList.contains('expanded');
    content.classList.toggle('expanded');
    toggle?.classList.toggle('expanded');
    if (opening) setTimeout(() => drawWaveVisualization(id), 50);
    saveConfigState();
}

function updateProfile(id, field, value) {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;

    if (field === 'name') {
        profile.name = (value || `Profil ${id}`).substring(0, MAX_PROFILE_NAME).trim();
    } else {
        profile.modemProfile[field] = parseFloat(value) || 0;
        window.dispatchEvent(new CustomEvent("modem-profile-updated", { detail: { profile: profile.modemProfile } }));
        if ($(`profile-content-${id}`)?.classList.contains('expanded')) {
            updateWaveInfo(id, profile.modemProfile);
            drawWaveVisualization(id);
            initFreqPickers();
        }
    }
    saveProfiles();
}

/********************************/
/****  WAVE INFO             ****/
/********************************/

const waveInfoKeys = [
    ['Symbolová rýchlosť:', 'symbol-rate', mp => mp.symbol_rate?.toFixed(3) ?? '–'],
    ['Perióda symbolu:',    'period',      mp => `${(mp.sample_duration * mp.samples_per_symbol * 1000).toFixed(3)} ms`],
    ['Nyquist frekvencia:', 'nyquist',     mp => `${mp.sample_rate / 2} Hz`],
];

function waveInfoHtml(mp, idSuffix) {
    return `<div class="wave-info">${
        waveInfoKeys.map(([label, key, fn]) => `
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

/********************************/
/****  VISUALIZATION         ****/
/********************************/

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
    const w   = canvas.offsetWidth;
    const h   = 260;
    canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const dark = document.documentElement.classList.contains('dark-scheme');
    const C = {
        grid:   dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        axis:   dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)',
        wave:   dark ? '#579ffb' : '#007bff',
        marker: dark ? 'rgb(88,128,101)'        : '#28a745',
        label:  dark ? 'rgba(255,255,255,0.45)' : '#6c757d',
        tagBg:  dark ? 'rgba(87,159,251,0.12)'  : 'rgba(0,123,255,0.08)',
        tagFg:  dark ? '#579ffb'                : '#007bff',
        center: dark ? 'rgba(255,255,255,0.1)'  : 'rgba(0,0,0,0.08)',
    };

    const pad = { top: 32, right: 16, bottom: 56, left: 48 };
    const gw  = w - pad.left - pad.right;
    const gh  = h - pad.top  - pad.bottom;
    const cy  = pad.top + gh / 2;
    const L   = pad.left;

    // Grid
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
        const y = pad.top + gh * i / 4;
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + gw, y); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(L, pad.top); ctx.lineTo(L, pad.top + gh); ctx.lineTo(L + gw, pad.top + gh); ctx.stroke();

    // Centre line
    ctx.strokeStyle = C.center; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(L, cy); ctx.lineTo(L + gw, cy); ctx.stroke();
    ctx.setLineDash([]);

    // Y-axis labels
    ctx.fillStyle = C.label; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    ctx.fillText('+1', L - 6, pad.top + 4);
    ctx.fillText(' 0', L - 6, cy + 4);
    ctx.fillText('\u22121', L - 6, pad.top + gh + 4);

    // Waveform
    const NUM_CYCLES = 4;
    const TOTAL_PTS  = NUM_CYCLES * 200;
    let phase = 0;
    ctx.strokeStyle = C.wave; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= TOTAL_PTS; i++) {
        const t    = (i / TOTAL_PTS) * NUM_CYCLES;
        const freq = Math.floor(t) % 2 === 0 ? mp.min_tx_freq : mp.max_tx_freq;
        let y;
        if (mp.cphase) { phase += 2 * Math.PI * (freq / 1000) * (NUM_CYCLES / TOTAL_PTS); y = Math.sin(phase); }
        else           { y = Math.sin(t * Math.PI * 2 * freq / 1000); }
        const x = L + (i / TOTAL_PTS) * gw;
        i === 0 ? ctx.moveTo(x, cy - y * gh * 0.42) : ctx.lineTo(x, cy - y * gh * 0.42);
    }
    ctx.stroke();

    // Symbol boundaries
    ctx.strokeStyle = C.marker; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    for (let i = 1; i < NUM_CYCLES; i++) {
        const x = L + (i / NUM_CYCLES) * gw;
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + gh); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Bit tags
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    for (let i = 0; i < NUM_CYCLES; i++) {
        const mx    = L + ((i + 0.5) / NUM_CYCLES) * gw;
        const bit   = i % 2;
        const label = `bit ${bit}  ${bit === 0 ? mp.min_tx_freq : mp.max_tx_freq} Hz`;
        ctx.textAlign = 'center';
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = C.tagBg;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(mx - tw / 2, pad.top - 16, tw, 16, 4);
        else               ctx.rect(mx - tw / 2, pad.top - 16, tw, 16);
        ctx.fill();
        ctx.fillStyle = C.tagFg; ctx.fillText(label, mx, pad.top - 3);
    }

    // Period arrow + label
    const period = mp.sample_duration * mp.samples_per_symbol;
    const ay     = pad.top + gh + 28;
    const ax1    = L + gw / NUM_CYCLES;
    const asz    = 5;
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

/********************************/
/****  FIELD BUILDERS        ****/
/********************************/

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
    const val     = mp[name] ?? 0;
    const display = format ? format(val) : parseFloat(val).toFixed(2);
    const expr    = name === 'ecc_percent' ? "Math.round(parseFloat(this.value)*100)+'%'"
                  : name === 'max_tx_amp'  ? "parseFloat(this.value).toFixed(2)"
                  :                          "parseFloat(this.value).toFixed(3)";
    return fieldWrap(name, `<div class="slider-row">
        ${icon ? `<i class="${icon} slider-icon"></i>` : ''}
        <input type="range" min="${min}" max="${max}" step="${step}" value="${val}"
            ${readonly ? 'disabled' : `data-profile-id="${id}" data-field="${name}" oninput="this.nextElementSibling.textContent=${expr}"`}>
        <span class="slider-label">${display}</span>
    </div>`, help);
}

/********************************/
/****  PROFILE CARD HTML     ****/
/********************************/

function renderProfileFields(mp, idSuffix, readonly) {
    const n = (name, opts)      => numField(name, mp, idSuffix, readonly, opts);
    const t = (name, help = '') => toggleField(name, mp, idSuffix, readonly, help);
    const s = (name, opts)      => sliderField(name, mp, idSuffix, readonly, opts);
    const divider = title       => `<div class="section-divider"><div class="section-title">${title}</div></div>`;
    const row = (...fields)     => `<div class="profile-field-row">${fields.join('')}</div>`;

    return `
        ${divider('Základné parametre')}
        ${row(n('sample_rate', { min: 8000, max: 96000, step: 1000, help: 'Odporúčané: 8 000 – 48 000 Hz' }),
              n('samples_per_symbol', { min: 1, max: 10000, step: 2, help: 'Počet vzoriek na jeden symbol' }))}
        ${row(n('bits_per_symbol', { min: 1, max: 8, help: 'Počet bitov na symbol' }),
              n('bytes_per_tx_block', { min: 1, max: 32, help: 'Bajtov v jednom TX bloku' }))}
        ${row(s('ecc_percent', { min: 0, max: 1, step: 0.05,
              help: 'Podiel ECC bajtov (0 % = žiadne, 100 % = maximálna ochrana)',
              format: v => `${Math.round(v * 100)} %` }))}
        ${row(s('squelch_thresh', { min: 0, max: 1, step: 0.005, icon: 'fas fa-filter',
              help: 'Prahová hodnota squelch — signály pod touto úrovňou sú ignorované',
              format: v => parseFloat(v).toFixed(3) }))}
        <div class="profile-field-row" style="gap:24px;align-items:center;">
            ${t('cphase', 'Spojitá fáza (CPM)')} ${t('dss_enabled', 'Rozptyl spektra (DSS)')}
        </div>

        ${divider('RX Parametre (príjem)')}
        ${row(n('min_rx_freq', { min: 100, max: 20000 }), n('max_rx_freq', { min: 100, max: 20000 }))}

        ${divider('TX Parametre (vysielanie)')}
        ${row(s('max_tx_amp', { min: 0, max: 1, step: 0.01, icon: 'fas fa-volume-high',
              help: 'Maximálna amplitúda vysielaného signálu',
              format: v => parseFloat(v).toFixed(2) }))}
        <div id="tx-freq-row-${idSuffix}" class="profile-field-row-full">
            ${renderFreqPicker(mp, idSuffix, readonly)}
        </div>`;
}

function profileCardHtml({ id, name, mp, active, readonly = false, isDefault = false }) {
    const suffix      = isDefault ? 'default' : id;
    const profileAttr = isDefault ? '' : `data-profile-id="${id}"`;

    const headerLeft = isDefault
        ? `<i id="profile-toggle-default" class="fas fa-chevron-right profile-toggle"></i>
           <span class="profile-name-display">Predvolený profil</span>
           <span class="profile-tag profile-tag--readonly"><i class="fas fa-lock"></i> Len na čítanie</span>`
        : `<i id="profile-toggle-${id}" class="fas fa-chevron-right profile-toggle"></i>
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
        <div class="profile-header" data-action="${isDefault ? 'toggle-default' : 'toggle'}" ${profileAttr}>
            <div class="profile-header-left">${headerLeft}</div>
            <div class="profile-header-right">${headerRight}</div>
        </div>
        <div id="profile-content-${suffix}" class="profile-content">
            <!--- <div class="wave-visualization">
                <div class="wave-viz-header"><i class="fas fa-wave-square"></i> Vizualizácia signálu</div>
                <div class="wave-canvas-container"><canvas id="wave-canvas-${suffix}"></canvas></div>
                ${waveInfoHtml(mp, suffix)}
            </div> -->
            ${renderProfileFields(mp, suffix, readonly)}
        </div>
    </div>`;
}

/********************************/
/****  RENDER                ****/
/********************************/

function renderProfiles() {
    if (!container) return;
    const defaultMp = TinyTUS.DEFAULT_MODEM_PROFILE;
    container.innerHTML = [
        ...profiles.map(p => profileCardHtml({ id: p.id, name: p.name, mp: p.modemProfile, active: isProfileActive(p) })),
        defaultMp ? profileCardHtml({ mp: defaultMp, active: isDefaultActive(), readonly: true, isDefault: true }) : '',
        profiles.length === 0 ? '<div class="empty-state">Žiadne vlastné profily. Kliknite na "Pridať profil" pre vytvorenie nového.</div>' : '',
    ].join('');
    initFreqPickers();
    populateUsbProfileSelector();
}

/********************************/
/****  EVENT DELEGATION      ****/
/********************************/

container?.addEventListener('click', e => {
    const btn = action => e.target.closest(`[data-action="${action}"]`);

    if (btn('delete')) {
        e.stopPropagation();
        const id = parseInt(btn('delete').dataset.profileId);
        return e.shiftKey ? doDeleteProfile(id) : deleteProfile(id);
    }
    if (btn('use-profile')) {
        e.stopPropagation();
        const profile = profiles.find(p => p.id === parseInt(btn('use-profile').dataset.profileId));
        return profile && setActiveProfile(profile.modemProfile);
    }
    if (btn('use-default'))    { e.stopPropagation(); return setActiveProfile(TinyTUS.DEFAULT_MODEM_PROFILE); }
    if (btn('toggle-default')) { return toggleProfile('default'); }
    if (btn('toggle'))         { return toggleProfile(parseInt(btn('toggle').dataset.profileId)); }
});

container?.addEventListener('change', e => {
    const { profileId, field, type } = e.target.dataset;
    if (!profileId || !field) return;
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
            TinyTUS.currentlyUsedModemProfile = autoProfile;
            window.dispatchEvent(new CustomEvent("active-modem-profile-changed", {
                detail: { profile: autoProfile, source: 'usb-auto' }
            }));
        }
    } catch (e) {
        console.warn('Failed to apply USB auto-profile:', e);
    }
}

addButton?.addEventListener('click', addProfile);
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

const allProfileIds = () => ['default', ...profiles.map(p => p.id)];
const redrawExpanded = () => allProfileIds().forEach(id => {
    if ($(`profile-content-${id}`)?.classList.contains('expanded')) drawWaveVisualization(id);
});

new MutationObserver(redrawExpanded)
    .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

window.addEventListener('resize', redrawExpanded);

let scrollTimeout;
configTabContent?.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(saveConfigState, 150);
});

window.addEventListener('refresh-local-storage', saveProfiles);

window.addEventListener("usb-device-connected", syncAutoProfileWithUSBState);

window.addEventListener("active-modem-profile-changed", (e) => {
    if (!e.detail?.profile) {
        // Uzivatel sa rozhodol zmenit profil, uz teraz nebudeeme vraciat spat
        lastProfileBeforeAutoSet = null;
    } else {
        console.log('Active modem profile changed due to USB auto-profile:', e.detail.profile);
        updateActiveProfileUI(e.detail.profile);
    }
});

window.addEventListener("usb-device-disconnected", () => {
    if (lastProfileBeforeAutoSet) {
        console.log('Restoring previous profile after USB disconnect:', lastProfileBeforeAutoSet);
        TinyTUS.currentlyUsedModemProfile = lastProfileBeforeAutoSet;
    }
});

TinyTUS.afterLoad(() => {
    loadProfiles();
    renderProfiles();
    restoreConfigState();
});
