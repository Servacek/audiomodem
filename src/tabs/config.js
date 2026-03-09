/**
 * @file config.js
 * @description Sprava modemovych profilov a ich konfiguracie.
 */

import { TinyTUS } from '../../libs/tinytus/tinytus.js';
import { ModemProfile } from '../../libs/tinytus/modem_profile.js';
import { renderFreqPicker, initFreqPickers, updateFreqPickerRange, clearAttenuationData } from '../freq_picker.js';

/* Konstanty */

const MAX_PROFILES = 10;
const MAX_PROFILE_NAME = 24;

const PARAM_LABELS = {
    min_tx_freq: "Frekvenčný offset vysielača",
    sample_rate: "Vzorkovacia frekvencia (Hz)",
    bits_per_tone: "Počet bitov na jeden tón",
    bytes_per_symbol: "Počet bajtov v symbole",
    symbols_per_marker: "Počet symbolov na marker",
    bits_in_marker: "Počet tón v markeri",
    tones_per_symbol: "Počet tónov v symbole",
    ecc_percent: "Podiel samoopravných bajtov",
    dss_enabled: "DSS (rozptyl spektra)",
    squelch_thresh: "Squelch prah",
    cphase: "Spojitá fáza",
    max_tx_amp: "Max TX amplitúda (hlasitosť)",
    samples_per_symbol: "Počet vzorkov na jeden symbol",
};

/* Stav a DOM referencie */

let profiles = [];
let profileToDelete = null;
let _stickyObservers = [];

const $ = id => document.getElementById(id);
const container = $('profiles-container');
const addButton = $('add-profile-button');
const confirmationModal = $('confirmation-modal');
const confirmButton = $('confirmation-confirm-button');
const cancelButton = $('confirmation-cancel-button');
const configTabContent = $('tab-config');
const usbProfileSelector = $('usb-profile-selector');

/* Nastavenia USB zariadenia */

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

    // Zmaz existujuce moznosti okrem prvej predvolenej.
    usbProfileSelector.innerHTML = '<option value="">Ponechať aktuálny profil</option>';

    // Pridaj moznost predvoleneho profilu.
    const defaultOption = document.createElement('option');
    defaultOption.value = 'default';
    defaultOption.textContent = 'Predvolený profil';
    usbProfileSelector.appendChild(defaultOption);

    // Pridaj vlastne profily.
    profiles.forEach(profile => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        usbProfileSelector.appendChild(option);
    });

    // Obnov predchadzajuci vyber.
    usbProfileSelector.value = currentSelection;
}

export function getUsbAutoProfile() {
    const setting = getUsbProfileSetting();
    if (!setting) return null;
    if (setting === 'default') return TinyTUS.DEFAULT_MODEM_PROFILE;

    const profile = profiles.find(p => p.id === parseInt(setting));
    return profile ? profile.modemProfile : null;
}

/* Persistencia */

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
        activeProfileId: isDefaultActive() ? 'default' : profiles.find(p => isProfileActive(p))?.id ?? 'default',
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
            : profiles.find(p => p.id === state.activeProfileId)?.modemProfile;
        if (profileToActivate) {
            TinyTUS.currentlyUsedModemProfile = profileToActivate;
            window.dispatchEvent(new CustomEvent("active-modem-profile-changed", { detail: { profile: profileToActivate } }));
        }

        state.expandedProfiles?.forEach(id => {
            const content = $(`profile-content-${id}`);
            const toggle = $(`profile-toggle-${id}`);
            if (!content || !toggle) return;
            content.classList.add('expanded');
            toggle.classList.add('expanded');
            setTimeout(() => drawWaveVisualization(id), 50);
        });

        if (state.scrollPosition && configTabContent)
            setTimeout(() => { configTabContent.scrollTop = state.scrollPosition; }, 100);
    } catch { /* Ignoruj poskodeny stav. */ }
}

/* Sprava profilov */

const isProfileActive = profile => TinyTUS.currentlyUsedModemProfile === profile.modemProfile;
const isDefaultActive = () => TinyTUS.currentlyUsedModemProfile === TinyTUS.DEFAULT_MODEM_PROFILE;

function updateActiveProfileUI(modemProfile) {
    // Zrus active class zo vsetkych profilov.
    document.querySelectorAll('.profile-item--active').forEach(el => el.classList.remove('profile-item--active'));

    // Zisti, ktory profil je aktivny.
    const isDefault = modemProfile === TinyTUS.DEFAULT_MODEM_PROFILE;
    const activeId = isDefault ? 'default' : profiles.find(p => p.modemProfile === modemProfile)?.id;

    if (!activeId) return;

    // Nastav active class pre aktivny profil.
    const activeProfileItem = document.querySelector(`#profile-content-${activeId}`)?.parentElement;
    if (activeProfileItem) activeProfileItem.classList.add('profile-item--active');

    // Aktualizuj vsetky tlacidla "Pouzit".
    document.querySelectorAll('[data-action="use-profile"], [data-action="use-default"]').forEach(btn => {
        const btnProfileId = btn.dataset.profileId ? parseInt(btn.dataset.profileId) : 'default';
        const isThisActive = btnProfileId === activeId;

        btn.disabled = isThisActive;
        btn.classList.toggle('use-profile-button--active', isThisActive);
        btn.innerHTML = isThisActive ? '<i class="fas fa-check"></i> Používa sa' : 'Použiť';
    });
}

function setActiveProfile(modemProfile, source = 'manual') {
    TinyTUS.currentlyUsedModemProfile = modemProfile;
    window.dispatchEvent(new CustomEvent("active-modem-profile-changed", { detail: { profile: modemProfile, source: source } }));
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
    const id = findFreeProfileID();
    const newProfile = { id, name: `Profil ${id}`, modemProfile: new ModemProfile() };
    profiles.unshift(newProfile);
    saveProfiles();
    renderProfiles();

    setTimeout(() => {
        const content = $(`profile-content-${id}`);
        const nameInput = $(`profile-name-input-${id}`);
        content?.classList.add('expanded');
        $(`profile-toggle-${id}`)?.classList.add('expanded');
        if (nameInput && !event?.shiftKey) {
            nameInput.focus();
            nameInput.select();
            drawWaveVisualization(id);
        }
    }, 100);
}

function doDeleteProfile(id) {
    const profile = profiles.find(p => p.id === id);
    if (profile?.modemProfile) {
        if (isProfileActive(profile)) setActiveProfile(TinyTUS.DEFAULT_MODEM_PROFILE);
        profile.modemProfile.destroy();
    }
    clearAttenuationData(id);
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

/* UI akcie */

function toggleProfile(id) {
    const content = $(`profile-content-${id}`);
    const toggle = $(`profile-toggle-${id}`);
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
        // Pri zmene sample_rate alebo samples_per_symbol
        // treba aktualizovat binsize.
        if (field === 'sample_rate' || field === 'samples_per_symbol')
            updateFreqPickerRange(id, profile.modemProfile);
        if ($(`profile-content-${id}`)?.classList.contains('expanded')) {
            updateWaveInfo(id, profile.modemProfile);
            drawWaveVisualization(id);
        }
    }
    saveProfiles();
}

/* Info o vlne */

const waveInfoKeys = [
    ['Symbolová rýchlosť:', 'symbol-rate', mp => mp.symbol_rate?.toFixed(3) ?? '-'],
    ['Perióda symbolu:', 'period', mp => `${(mp.sample_duration * mp.samples_per_symbol * 1000).toFixed(3)} ms`],
    ['Nyquist frekvencia:', 'nyquist', mp => `${mp.sample_rate / 2} Hz`],
];

function waveInfoHtml(mp, idSuffix) {
    return `<div class="wave-info">${waveInfoKeys.map(([label, key, fn]) => `
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

/* Vizualizacia */

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
    const w = canvas.offsetWidth;
    const h = 260;
    canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const dark = document.documentElement.classList.contains('dark-scheme');
    const C = {
        grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        axis: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)',
        wave: dark ? '#579ffb' : '#007bff',
        marker: dark ? 'rgb(88,128,101)' : '#28a745',
        label: dark ? 'rgba(255,255,255,0.45)' : '#6c757d',
        tagBg: dark ? 'rgba(87,159,251,0.12)' : 'rgba(0,123,255,0.08)',
        tagFg: dark ? '#579ffb' : '#007bff',
        center: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    };

    const pad = { top: 32, right: 16, bottom: 56, left: 48 };
    const gw = w - pad.left - pad.right;
    const gh = h - pad.top - pad.bottom;
    const cy = pad.top + gh / 2;
    const L = pad.left;

    // Mriezka.
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
        const y = pad.top + gh * i / 4;
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + gw, y); ctx.stroke();
    }

    // Osi.
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(L, pad.top); ctx.lineTo(L, pad.top + gh); ctx.lineTo(L + gw, pad.top + gh); ctx.stroke();

    // Stredova ciara.
    ctx.strokeStyle = C.center; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(L, cy); ctx.lineTo(L + gw, cy); ctx.stroke();
    ctx.setLineDash([]);

    // Popisy osi Y.
    ctx.fillStyle = C.label; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    ctx.fillText('+1', L - 6, pad.top + 4);
    ctx.fillText(' 0', L - 6, cy + 4);
    ctx.fillText('\u22121', L - 6, pad.top + gh + 4);

    // Waveform.
    const NUM_CYCLES = 4;
    const TOTAL_PTS = NUM_CYCLES * 200;
    let phase = 0;
    ctx.strokeStyle = C.wave; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= TOTAL_PTS; i++) {
        const t = (i / TOTAL_PTS) * NUM_CYCLES;
        const freq = Math.floor(t) % 2 === 0 ? mp.min_tx_freq : mp.max_tx_freq;
        let y;
        if (mp.cphase) { phase += 2 * Math.PI * (freq / 1000) * (NUM_CYCLES / TOTAL_PTS); y = Math.sin(phase); }
        else { y = Math.sin(t * Math.PI * 2 * freq / 1000); }
        const x = L + (i / TOTAL_PTS) * gw;
        i === 0 ? ctx.moveTo(x, cy - y * gh * 0.42) : ctx.lineTo(x, cy - y * gh * 0.42);
    }
    ctx.stroke();

    // Hranice symbolov.
    ctx.strokeStyle = C.marker; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    for (let i = 1; i < NUM_CYCLES; i++) {
        const x = L + (i / NUM_CYCLES) * gw;
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + gh); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Tagy bitov.
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    for (let i = 0; i < NUM_CYCLES; i++) {
        const mx = L + ((i + 0.5) / NUM_CYCLES) * gw;
        const bit = i % 2;
        const label = `bit ${bit}  ${bit === 0 ? mp.min_tx_freq : mp.max_tx_freq} Hz`;
        ctx.textAlign = 'center';
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = C.tagBg;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(mx - tw / 2, pad.top - 16, tw, 16, 4);
        else ctx.rect(mx - tw / 2, pad.top - 16, tw, 16);
        ctx.fill();
        ctx.fillStyle = C.tagFg; ctx.fillText(label, mx, pad.top - 3);
    }

    // Sipka a popis periody.
    const period = mp.sample_duration * mp.samples_per_symbol;
    const ay = pad.top + gh + 28;
    const ax1 = L + gw / NUM_CYCLES;
    const asz = 5;
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

/* Buildery poli */

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
    const val = mp[name] ?? 0;
    const display = format ? format(val) : parseFloat(val).toFixed(2);
    const expr = name === 'ecc_percent' ? "Math.round(parseFloat(this.value)*100)+'%'"
        : name === 'max_tx_amp' ? "parseFloat(this.value).toFixed(2)"
            : name === 'min_tx_freq' ? `Math.round(this.value) + ' Hz (Bin #' + Math.round(this.value / ${step}) + ')'`
                : "parseFloat(this.value).toFixed(3)";
    return fieldWrap(name, `<div class="slider-row">
        ${icon ? `<i class="${icon} slider-icon"></i>` : ''}
        <input type="range" min="${min}" max="${max}" step="${step}" value="${val}"
            ${readonly ? 'disabled' : `data-profile-id="${id}" data-field="${name}" oninput="this.nextElementSibling.textContent=${expr}"`}>
        <span class="slider-label">${display}</span>
    </div>`, help);
}

function selectField(name, mp, id, readonly, { options = [], help = '' } = {}) {
    const val = mp[name] ?? options[0];
    if (readonly) {
        return fieldWrap(name, `<select disabled><option>${val}</option></select>`, help);
    }
    const optionsHtml = options.map(opt =>
        `<option value="${opt}" ${opt == val ? 'selected' : ''}>${opt}</option>`
    ).join('');
    return fieldWrap(name, `<select data-profile-id="${id}" data-field="${name}">${optionsHtml}</select>`, help);
}

/* HTML karty profilu */

function renderProfileFields(mp, idSuffix, readonly) {
    const n = (name, opts) => numField(name, mp, idSuffix, readonly, opts);
    const t = (name, help = '') => toggleField(name, mp, idSuffix, readonly, help);
    const s = (name, opts) => sliderField(name, mp, idSuffix, readonly, opts);
    const sel = (name, opts) => selectField(name, mp, idSuffix, readonly, opts);
    const divider = title => `<div class="section-divider"><div class="section-title">${title}</div></div>`;
    const row = (...fields) => `<div class="profile-field-row">${fields.join('')}</div>`;

    return `
        ${divider('Základné parametre')}
        ${row(n('sample_rate', { min: 8000, max: 96000, step: 1000, help: 'Vzorkovacia frekvencia modulátora a demodulator (8 000 - 48 000 Hz)' }),
        sel('samples_per_symbol', { options: [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192], help: 'Počet vzoriek na jeden symbol (mocnina 2)' }))}
        ${row(sel('bits_per_tone', { options: [1, 2, 4, 8], help: 'Koľko bitov má reprezentovať jeden tón v symbole (1, 2, 4 alebo 8)' }),
            n('bytes_per_symbol', { min: 1, max: 32, help: 'Koľko bajtov má jeden symbol obsahovať. Každý z bajtov bude rozdelený do jednotlivých tónov.' }))}
        ${row(n('symbols_per_marker', { min: 1, max: 255, help: 'Koľko dĺžok symbolu má jeden marker začiatku alebo konca trvať.' }),
                n('bits_in_marker', { min: 1, max: 255, help: 'Koľko tónov má marker začiatku alebo konca obsahovať.' }))}
        ${row(n('tones_per_symbol', { min: 1, max: 255, help: 'Počet rámcov v TX bloku' }))}
        ${divider('TX Parametre (vysielanie)')}
        ${s('max_tx_amp', {
                    min: 0, max: 1, step: 0.01, icon: 'fas fa-volume-high',
                    help: 'Maximálna amplitúda vysielaného signálu',
                    format: v => parseFloat(v).toFixed(2)
                })}
        ${renderFreqPicker(mp, idSuffix, readonly)}

        ${divider('Pokročilé nastavenia')}
        ${s('ecc_percent', {
                    min: 0, max: 1, step: 0.05,
                    help: 'Podiel ECC bajtov (0 % = žiadne, 100 % = maximálna ochrana)',
                    format: v => `${Math.round(v * 100)} %`
                })}
        ${s('squelch_thresh', {
                    min: 0, max: 1, step: 0.005, icon: 'fas fa-filter',
                    help: 'Prahova hodnota squelch - signaly pod touto urovnou su ignorovane',
                    format: v => parseFloat(v).toFixed(3)
                })}
        <div class="profile-field-row" style="gap:24px;align-items:center;">
            ${t('cphase', 'Spojitá fáza (CPM)')} ${t('dss_enabled', 'Vynásobí prenášané bajty pseudonáhodnými číslami, ktoré zaistia rovnomernejšie rozloženie energie v signály.')}
        </div>`;
}

function profileCardHtml({ id, name, mp, active, readonly = false, isDefault = false }) {
    const suffix = isDefault ? 'default' : id;
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
        <div class="profile-sticky-sentinel"></div>
        <div class="profile-header" data-action="${isDefault ? 'toggle-default' : 'toggle'}" ${profileAttr}>
            <div class="profile-header-left">${headerLeft}</div>
            <div class="profile-header-right">${headerRight}</div>
        </div>
        <div id="profile-content-${suffix}" class="profile-content">
            ${renderProfileFields(mp, suffix, readonly)}
        </div>
    </div>`;
}

/* Vykreslenie */

function setupStickyHeaderObservers() {
    _stickyObservers.forEach(io => io.disconnect());
    _stickyObservers = [];
    if (!configTabContent) return;
    document.querySelectorAll('.profile-sticky-sentinel').forEach(sentinel => {
        const header = sentinel.nextElementSibling;
        if (!header?.classList.contains('profile-header')) return;
        const io = new IntersectionObserver(([entry]) => {
            header.classList.toggle('profile-header--stuck', !entry.isIntersecting);
        }, { root: configTabContent, threshold: 0 });
        io.observe(sentinel);
        _stickyObservers.push(io);
    });
}

function renderProfiles() {
    if (!container) return;
    const defaultMp = TinyTUS.DEFAULT_MODEM_PROFILE;
    container.innerHTML = [
        ...profiles.map(p => profileCardHtml({ id: p.id, name: p.name, mp: p.modemProfile, active: isProfileActive(p) })),
        defaultMp ? profileCardHtml({ mp: defaultMp, active: isDefaultActive(), readonly: true, isDefault: true }) : '',
        profiles.length === 0 ? '<div class="empty-state">Žiadne vlastné profily. Kliknite na "Pridať profil" pre vytvorenie nového.</div>' : '',
    ].join('');
    populateUsbProfileSelector();
    initFreqPickers();
    setupStickyHeaderObservers();
}

/* Delegacia eventov */

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
    if (btn('use-default')) { e.stopPropagation(); return setActiveProfile(TinyTUS.DEFAULT_MODEM_PROFILE); }
    if (btn('toggle-default')) { return toggleProfile('default'); }
    if (btn('toggle')) { return toggleProfile(parseInt(btn('toggle').dataset.profileId)); }
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
            setActiveProfile(autoProfile, 'usb-auto');
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

let scrollTimeout;
configTabContent?.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(saveConfigState, 150);
});

window.addEventListener('refresh-local-storage', saveProfiles);

window.addEventListener("usb-device-connected", syncAutoProfileWithUSBState);

window.addEventListener("active-modem-profile-changed", (e) => {
    const profile = e.detail?.profile;
    if (!profile) return;

    if (e.detail?.source === 'usb-auto') {
        console.log('Active modem profile changed due to USB auto-profile:', profile);
    } else {
        console.log('Active modem profile changed manually, clearing lastProfileBeforeAutoSet');
        lastProfileBeforeAutoSet = null; // only clear on manual change, not USB auto
    }

    updateActiveProfileUI(profile);
});

window.addEventListener("usb-device-disconnected", () => {
    if (lastProfileBeforeAutoSet) {
        console.log('Restoring previous profile after USB disconnect:', lastProfileBeforeAutoSet);
        setActiveProfile(lastProfileBeforeAutoSet, 'usb-auto');
    }
});

TinyTUS.afterLoad(() => {
    loadProfiles();
    renderProfiles();
    restoreConfigState();

    // Zobraz verziu kniznice.
    const versionEl = document.getElementById('lib-version-display');
    if (versionEl && TinyTUS.EXPORTS.get_lib_version) {
        const ptr = TinyTUS.EXPORTS.get_lib_version();
        versionEl.textContent = TinyTUS.getStringFromPointer(ptr) || '-';
    }
});
