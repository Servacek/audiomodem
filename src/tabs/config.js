/**
 * @file config.js
 * @description Správa modemových profilov a ich konfigurácie
 */

import { TinyTUS } from '../../libs/tinytus/tinytus.js';
import { ModemProfile } from '../../libs/tinytus/modem_profile.js';
import { renderFreqPicker, initFreqPickers } from '../freq_picker.js';

const PARAM_LABELS = {
    min_rx_freq:        "Min RX frekvencia (Hz)",
    max_rx_freq:        "Max RX frekvencia (Hz)",
    sample_rate:        "Vzorkovacia frekvencia (Hz)",
    symbol_rate:        "Symbolová rýchlosť (Bd)",
    bps:                "Bity za sekundu",
    bits_per_symbol:    "Bity na symbol",
    bytes_per_tx_block: "Bajtov v TX bloku",
    ecc_percent:        "Podiel samoopravných bajtov",
    dss_enabled:        "DSS (rozptyl spektra)",
    squelch_thresh:     "Squelch prah",
    cphase:             "Spojitá fáza",
    min_tx_freq:        "Min TX frekvencia (Hz)",
    max_tx_freq:        "Max TX frekvencia (Hz)",
    min_tx_amp:         "Min TX amplitúda",
    max_tx_amp:         "Max TX amplitúda",
    min_tx_phs:         "Min TX fáza (0–180°)",
    max_tx_phs:         "Max TX fáza (0–180°)",
    samples_per_symbol: "Počet vzorkov na jeden symbol",
};

// Stav aplikácie
let profiles = [];
let profileToDelete = null;

// Referencie na DOM prvky
const container         = document.getElementById('profiles-container');
const addButton         = document.getElementById('add-profile-button');
const confirmationModal = document.getElementById('confirmation-modal');
const confirmButton     = document.getElementById('confirmation-confirm-button');
const cancelButton      = document.getElementById('confirmation-cancel-button');

// Načítavanie a ukladanie profilov do local storage
function loadProfiles() {
    const saved = localStorage.getItem('modemProfiles');
    if (!saved) return;
    try {
        const parsed = JSON.parse(saved);
        profiles = parsed.map(p => ({
            id:           p.id,
            name:         p.name,
            modemProfile: new ModemProfile(p),
        }));
    } catch (e) {
        profiles = [];
    }
}

function saveProfiles() {
    const serialized = profiles.map(p => ({
        id:   p.id,
        name: p.name,
        ...p.modemProfile.toObject()
    }));
    localStorage.setItem('modemProfiles', JSON.stringify(serialized));
}

// Vracia ukazovateľ na aktuálne používaný profil, alebo null pre predvolený
function getActiveProfilePtr() {
    const p = TinyTUS.currentlyUsedModemProfile;
    return (p && p !== TinyTUS.DEFAULT_MODEM_PROFILE) ? p.ptr : null;
}

function isProfileActive(profile) {
    return TinyTUS.currentlyUsedModemProfile === profile.modemProfile;
}

function isDefaultActive() {
    return TinyTUS.currentlyUsedModemProfile === TinyTUS.DEFAULT_MODEM_PROFILE;
}

function setActiveProfile(modemProfile) {
    TinyTUS.currentlyUsedModemProfile = modemProfile;
    // Odoslanie udalosti označujúcej zmenu aktívneho profilu
    window.dispatchEvent(new CustomEvent("active-modem-profile-changed", {
        detail: { profile: modemProfile }
    }));
    renderProfiles();
}

function findFreeProfileID() {
    const ids = new Set(profiles.map(p => p.id));
    let id = 1;
    while (ids.has(id)) id++;
    return id;
}

// Operácie CRUD pre profily
function addProfile(event = null) {
    const MAX_PROFILES = 10;
    if (profiles.length >= MAX_PROFILES) {
        alert("Maximálny počet profilov je " + MAX_PROFILES + ". Odstráňte niektorý z existujúcich profilov, aby ste mohli pridať nový.");
        return;
    }

    const modemProfile = new ModemProfile();
    const profile_id = findFreeProfileID();
    const newProfile = {
        id:           profile_id,
        name:         `Profil ${profile_id}`,
        modemProfile,
    };
    profiles.push(newProfile);
    saveProfiles();
    renderProfiles();

    setTimeout(() => {
        const content   = document.getElementById(`profile-content-${newProfile.id}`);
        const nameInput = document.querySelector(
            `input[data-profile-id="${newProfile.id}"][data-field="name"]`
        );
        if (content) {
            content.classList.add('expanded');
            document.getElementById(`profile-toggle-${newProfile.id}`)?.classList.add('expanded');
        }
        // Nastavme fokus na novo vytvorený profil, len ak nedržíme SHIFT
        if (nameInput && !(event?.shiftKey)) {
            nameInput.focus();
            nameInput.select();
            drawWaveVisualization(newProfile.id);
        }

        initFreqPickers();
    }, 100);
}

function doDeleteProfile(id) {
    const profile = profiles.find(p => p.id === id);
    if (profile?.modemProfile) {
        // Návrat na predvolený profil, ak sa odstraňuje aktívny profil
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
    if (profileToDelete !== null) {
        doDeleteProfile(profileToDelete);
        profileToDelete = null;
    }
    closeModal();
}

function closeModal() {
    confirmationModal.style.display = 'none';
    profileToDelete = null;
}

// Pomocné funkcie UI
function toggleProfile(id) {
    const content = document.getElementById(`profile-content-${id}`);
    const toggle  = document.getElementById(`profile-toggle-${id}`);
    const wasExpanded = content.classList.contains('expanded');
    content.classList.toggle('expanded');
    toggle.classList.toggle('expanded');
    if (!wasExpanded) setTimeout(() => drawWaveVisualization(id), 50);
}

function toggleDefaultProfile() {
    const content = document.getElementById('profile-content-default');
    const toggle  = document.getElementById('profile-toggle-default');
    const wasExpanded = content.classList.contains('expanded');
    content.classList.toggle('expanded');
    toggle?.classList.toggle('expanded');
    if (!wasExpanded) setTimeout(() => drawWaveVisualization('default'), 50);
}

function updateProfile(id, field, value) {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;

    if (field === 'name') {
        profile.name = value || `Profil ${id}`;
        const display = document.getElementById(`profile-name-display-${id}`);
        if (display) display.textContent = profile.name;
    } else {
        profile.modemProfile[field] = parseFloat(value) || 0;
        // if (field === 'param') updateTxParameterVisibility(id, profile.modemProfile.param);
    }
    saveProfiles();

    window.dispatchEvent(new CustomEvent("modem-profile-updated", {
        detail: { profile: profile.modemProfile }
    }));

    const content = document.getElementById(`profile-content-${id}`);
    if (content?.classList.contains('expanded')) {
        updateWaveInfo(id, profile.modemProfile);
        drawWaveVisualization(id);
        initFreqPickers();
    }
}

// function updateTxParameterVisibility(profileId, modulationType) {
//     const suffix = profileId === 'default' ? '-default' : `-${profileId}`;
//     const freqRow = document.getElementById(`tx-freq-row${suffix}`);
//     const ampRow  = document.getElementById(`tx-amp-row${suffix}`);
//     const phsRow  = document.getElementById(`tx-phs-row${suffix}`);
//     if (!freqRow || !ampRow || !phsRow) return;

//     freqRow.style.display = modulationType === 0 ? '' : 'none';
//     ampRow.style.display  = modulationType === 1 ? '' : 'none';
//     phsRow.style.display  = modulationType === 2 ? '' : 'none';
// }

// Vizualizácia vlnového tvaru
function drawWaveVisualization(profileId) {
    const mp = profileId === 'default'
        ? TinyTUS.DEFAULT_MODEM_PROFILE
        : profiles.find(p => p.id === profileId)?.modemProfile;
    if (!mp) return;

    const canvas = document.getElementById(`wave-canvas-${profileId}`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w   = canvas.offsetWidth;
    const h   = 260;
    canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const isDark      = document.documentElement.classList.contains('dark-scheme');
    const gridColor   = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const axisColor   = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)';
    const waveColor   = isDark ? '#579ffb' : '#007bff';
    const markerColor = isDark ? 'rgb(88,128,101)' : '#28a745';
    const labelColor  = isDark ? 'rgba(255,255,255,0.45)' : '#6c757d';
    const tagBg       = isDark ? 'rgba(87,159,251,0.12)' : 'rgba(0,123,255,0.08)';
    const tagFg       = isDark ? '#579ffb' : '#007bff';

    const pad = { top: 32, right: 16, bottom: 56, left: 48 };
    const gw  = w - pad.left - pad.right;
    const gh  = h - pad.top  - pad.bottom;
    const cy  = pad.top + gh / 2;

    // Grid
    ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
        const y = pad.top + gh * i / 4;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + gw, y); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = axisColor; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, pad.top + gh);
    ctx.lineTo(pad.left + gw, pad.top + gh); ctx.stroke();

    // Centre line
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.left, cy); ctx.lineTo(pad.left + gw, cy); ctx.stroke();
    ctx.setLineDash([]);

    // Y labels
    ctx.fillStyle = labelColor; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    ctx.fillText('+1', pad.left - 6, pad.top + 4);
    ctx.fillText(' 0', pad.left - 6, cy + 4);
    ctx.fillText('\u22121', pad.left - 6, pad.top + gh + 4);

    // Waveform
    const numCycles = 4, totalPoints = numCycles * 200;
    let phase = 0;
    ctx.strokeStyle = waveColor; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= totalPoints; i++) {
        const t    = (i / totalPoints) * numCycles;
        const dt   = numCycles / totalPoints;
        const freq = Math.floor(t) % 2 === 0 ? mp.min_tx_freq : mp.max_tx_freq;
        const norm = freq / 1000;
        let y;
        if (mp.cphase) { phase += 2 * Math.PI * norm * dt; y = Math.sin(phase); }
        else           { y = Math.sin(t * Math.PI * 2 * norm); }
        const x = pad.left + (i / totalPoints) * gw;
        i === 0 ? ctx.moveTo(x, cy - y * gh * 0.42) : ctx.lineTo(x, cy - y * gh * 0.42);
    }
    ctx.stroke();

    // Symbol boundaries
    ctx.strokeStyle = markerColor; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    for (let i = 1; i < numCycles; i++) {
        const x = pad.left + (i / numCycles) * gw;
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + gh); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Bit tags
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    for (let i = 0; i < numCycles; i++) {
        const x0    = pad.left + (i / numCycles) * gw;
        const x1    = pad.left + ((i + 1) / numCycles) * gw;
        const mx    = (x0 + x1) / 2;
        const label = `bit ${i % 2}  ${i % 2 === 0 ? mp.min_tx_freq : mp.max_tx_freq} Hz`;
        ctx.textAlign = 'center';
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = tagBg;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(mx - tw / 2, pad.top - 16, tw, 16, 4);
        else ctx.rect(mx - tw / 2, pad.top - 16, tw, 16);
        ctx.fill();
        ctx.fillStyle = tagFg; ctx.fillText(label, mx, pad.top - 3);
    }

    // Period arrow
    const period = mp.sample_duration * mp.samples_per_symbol;
    const arrowY = pad.top + gh + 28;
    const ax0 = pad.left, ax1 = pad.left + gw / numCycles, asz = 5;
    ctx.strokeStyle = markerColor; ctx.fillStyle = markerColor; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ax0, arrowY); ctx.lineTo(ax1, arrowY); ctx.stroke();
    for (const [x, d] of [[ax0, 1], [ax1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(x, arrowY); ctx.lineTo(x + d * asz, arrowY - asz / 2);
        ctx.lineTo(x + d * asz, arrowY + asz / 2); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = labelColor; ctx.font = '11px JetBrains Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillText(`T = ${(period * 1000).toFixed(3)} ms`, (ax0 + ax1) / 2, arrowY + 14);
}

// Pomocné funkcie na vykreslenie polí
function fieldWrap(name, inputHtml, helpText = '') {
    return `
    <div class="profile-field">
        <label>${PARAM_LABELS[name] ?? name}</label>
        ${inputHtml}
        ${helpText ? `<div class="help-text">${helpText}</div>` : ''}
    </div>`;
}

function numField(name, mp, idSuffix, readonly, opts = {}) {
    const { min, max, step = 1, help = '' } = opts;
    const val = mp[name] ?? 0;
    if (readonly) return fieldWrap(name, `<input type="number" value="${val}" disabled>`, help);
    return fieldWrap(name, `
        <input type="number" value="${val}"
            data-profile-id="${idSuffix}" data-field="${name}"
            ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''}
            step="${step}">`, help);
}

function toggleField(name, mp, idSuffix, readonly, help = '') {
    const checked = mp[name] ? 'checked' : '';
    if (readonly) return fieldWrap(name, `<input type="checkbox" ${checked} disabled>`, help);
    return fieldWrap(name, `
        <input type="checkbox" ${checked}
            data-profile-id="${idSuffix}" data-field="${name}" data-type="checkbox">`, help);
}

function sliderField(name, mp, idSuffix, readonly, opts = {}) {
    const { min = 0, max = 1, step = 0.01, help = '', icon = '', format } = opts;
    const val     = mp[name] ?? 0;
    const display = format ? format(val) : parseFloat(val).toFixed(2);

    let labelExpr;
    if      (name === 'ecc_percent') labelExpr = "Math.round(parseFloat(this.value)*100)+'%'";
    else if (name === 'max_tx_amp')  labelExpr = "parseFloat(this.value).toFixed(2)";
    else                             labelExpr = "parseFloat(this.value).toFixed(3)";

    return fieldWrap(name, `
        <div class="slider-row">
            ${icon ? `<i class="${icon} slider-icon"></i>` : ''}
            <input type="range" min="${min}" max="${max}" step="${step}" value="${val}"
                ${readonly
                    ? 'disabled'
                    : `data-profile-id="${idSuffix}" data-field="${name}"
                       oninput="this.nextElementSibling.textContent=${labelExpr}"`}>
            <span class="slider-label">${display}</span>
        </div>`, help);
}

// Vykreslenie polí profilu
function renderProfileFields(mp, idSuffix, readonly) {
    const num    = (name, opts)      => numField(name, mp, idSuffix, readonly, opts);
    const toggle = (name, help = '') => toggleField(name, mp, idSuffix, readonly, help);
    const slider = (name, opts)      => sliderField(name, mp, idSuffix, readonly, opts);

    return `
        <div class="section-divider"><div class="section-title">Základné parametre</div></div>
        <div class="profile-field-row">
            ${num('sample_rate',        { min: 8000, max: 96000, step: 1000, help: 'Odporúčané: 8 000 – 48 000 Hz' })}
            ${num('samples_per_symbol', { min: 1, max: 10000, step: 2, help: 'Počet vzoriek na jeden symbol' })}
        </div>
        <div class="profile-field-row">
            ${num('bits_per_symbol',    { min: 1, max: 8,  help: 'Počet bitov na symbol' })}
            ${num('bytes_per_tx_block', { min: 1, max: 32, help: 'Bajtov v jednom TX bloku' })}
        </div>
        <div class="profile-field-row">
            ${slider('ecc_percent', {
                min: 0, max: 1, step: 0.05,
                help: 'Podiel ECC bajtov (0 % = žiadne, 100 % = maximálna ochrana)',
                format: v => `${Math.round(v * 100)} %`
            })}
        </div>
        <div class="profile-field-row">
            ${slider('squelch_thresh', {
                min: 0, max: 1, step: 0.005,
                help: 'Prahová hodnota squelch — signály pod touto úrovňou sú ignorované',
                icon: 'fas fa-filter',
                format: v => parseFloat(v).toFixed(3)
            })}
        </div>
        <div class="profile-field-row" style="gap: 24px; align-items: center;">
            ${toggle('cphase',      'Spojitá fáza (CPM)')}
            ${toggle('dss_enabled', 'Rozptyl spektra (DSS)')}
        </div>

        <div class="section-divider"><div class="section-title">RX Parametre (príjem)</div></div>
        <div class="profile-field-row">
            ${num('min_rx_freq', { min: 100, max: 20000 })}
            ${num('max_rx_freq', { min: 100, max: 20000 })}
        </div>

        <div class="section-divider"><div class="section-title">TX Parametre (vysielanie)</div></div>
        <div class="profile-field-row">
            ${slider('max_tx_amp', {
                min: 0, max: 1, step: 0.01,
                help: 'Maximálna amplitúda vysielaného signálu',
                icon: 'fas fa-volume-high',
                format: v => parseFloat(v).toFixed(2)
            })}
        </div>
        <div id="tx-freq-row-${idSuffix}" class="profile-field-row" style="display: flex">
            ${renderFreqPicker(mp, idSuffix, readonly)}
        </div>`;
}

function waveInfoHtml(mp, idSuffix) {
    const period  = mp.sample_duration * mp.samples_per_symbol;
    const nyquist = mp.sample_rate / 2;
    const item    = (label, key, val) => `
        <div class="wave-info-item">
            <span class="wave-info-label">${label}</span><br>
            <span data-wave-info="${key}-${idSuffix}">${val}</span>
        </div>`;
    return `
        <div class="wave-info">
            ${item('Symbolová rýchlosť:',  'symbol-rate',  mp.symbol_rate?.toFixed(3) ?? '–')}
            ${item('Perióda symbolu:',      'period',       `${(period * 1000).toFixed(3)} ms`)}
            ${item('Nyquist frekvencia:',   'nyquist',      `${nyquist} Hz`)}
        </div>`;
}

function updateWaveInfo(profileId, mp) {
    const suffix = profileId === 'default' ? '-default' : `-${profileId}`;
    const set    = (key, val) => {
        const el = document.querySelector(`[data-wave-info="${key}${suffix}"]`);
        if (el) el.textContent = val;
    };
    const period  = mp.sample_duration * mp.samples_per_symbol;
    const nyquist = mp.sample_rate / 2;
    set('symbol-rate', mp.symbol_rate?.toFixed(3) ?? '–');
    set('period',      `${(period * 1000).toFixed(3)} ms`);
    set('nyquist',     `${nyquist} Hz`);
    set('bps',         mp.bps ?? '–');
    set('bits-symbol', mp.bits_per_symbol ?? '–');
    set('min-rx-freq', `${mp.min_rx_freq} Hz`);
    set('max-rx-freq', `${mp.max_rx_freq} Hz`);
    set('min-tx-freq', `${mp.min_tx_freq} Hz`);
    set('max-tx-freq', `${mp.max_tx_freq} Hz`);
}

function renderDefaultProfileCard() {
    const mp      = TinyTUS.DEFAULT_MODEM_PROFILE;
    if (!mp) return '';

    const active  = isDefaultActive();

    return `
    <div class="profile-item profile-item--default ${active ? 'profile-item--active' : ''}">
        <div class="profile-header" data-action="toggle-default">
            <div class="profile-header-left">
                <i id="profile-toggle-default" class="fas fa-chevron-right profile-toggle"></i>
                <span class="profile-name-display">Predvolený profil</span>
                <span class="profile-tag profile-tag--readonly">
                    <i class="fas fa-lock"></i> Len na čítanie
                </span>
            </div>
            <div class="profile-header-right">
                <button class="use-profile-button ${active ? 'use-profile-button--active' : ''}"
                        data-action="use-default"
                        ${active ? 'disabled' : ''}>
                    ${active ? '<i class="fas fa-check"></i> Používa sa' : 'Použiť'}
                </button>
            </div>
        </div>
        <div id="profile-content-default" class="profile-content">
            <div class="wave-visualization">
                <div class="wave-viz-header"><i class="fas fa-wave-square"></i> Vizualizácia signálu</div>
                <div class="wave-canvas-container"><canvas id="wave-canvas-default"></canvas></div>
                ${waveInfoHtml(mp, 'default')}
            </div>
            ${renderProfileFields(mp, 'default', true)}
        </div>
    </div>`;
}

function renderProfiles() {
    if (!container) return;

    const defaultCard = renderDefaultProfileCard();

    if (profiles.length === 0) {
        container.innerHTML = defaultCard +
            '<div class="empty-state">Žiadne vlastné profily. Kliknite na "Pridať profil" pre vytvorenie nového.</div>';
        return;
    }

    const profileCards = profiles.map(profile => {
        const mp      = profile.modemProfile;
        const active  = isProfileActive(profile);

        return `
        <div class="profile-item ${active ? 'profile-item--active' : ''}">
            <div class="profile-header" data-profile-id="${profile.id}" data-action="toggle">
                <div class="profile-header-left">
                    <i id="profile-toggle-${profile.id}" class="fas fa-chevron-right profile-toggle"></i>
                    <span id="profile-name-display-${profile.id}" class="profile-name-display">${profile.name}</span>
                </div>
                <div class="profile-header-right">
                    <button class="use-profile-button ${active ? 'use-profile-button--active' : ''}"
                            data-profile-id="${profile.id}" data-action="use-profile"
                            ${active ? 'disabled' : ''}>
                        ${active ? '<i class="fas fa-check"></i> Používa sa' : 'Použiť'}
                    </button>
                    <button class="delete-profile-button" data-profile-id="${profile.id}" data-action="delete">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
            <div id="profile-content-${profile.id}" class="profile-content">
                <div class="profile-field">
                    <label>Názov profilu</label>
                    <input type="text" value="${profile.name}"
                           data-profile-id="${profile.id}" data-field="name" maxlength="32">
                </div>

                <div class="wave-visualization">
                    <div class="wave-viz-header"><i class="fas fa-wave-square"></i> Vizualizácia signálu</div>
                    <div class="wave-canvas-container"><canvas id="wave-canvas-${profile.id}"></canvas></div>
                    ${waveInfoHtml(mp, profile.id)}
                </div>

                ${renderProfileFields(mp, profile.id, false)}
            </div>
        </div>`;
    }).join('');

    container.innerHTML = defaultCard + profileCards;
    initFreqPickers();
}

// Delegovanie udalostí
if (container) {
    container.addEventListener('click', (e) => {
        // Zmazanie profilu
        const deleteBtn = e.target.closest('[data-action="delete"]');
        if (deleteBtn) {
            e.stopPropagation();
            // Ak je stlačený SHIFT, odstránime bez potvrdenia
            if (e.shiftKey) {
                doDeleteProfile(parseInt(deleteBtn.dataset.profileId));
                return;
            }

            deleteProfile(parseInt(deleteBtn.dataset.profileId));
            return;
        }

        // Použitie profilu
        const useBtn = e.target.closest('[data-action="use-profile"]');
        if (useBtn) {
            e.stopPropagation();
            const profile = profiles.find(p => p.id === parseInt(useBtn.dataset.profileId));
            if (profile) setActiveProfile(profile.modemProfile);
            return;
        }

        // Použitie predvoleného
        const useDefaultBtn = e.target.closest('[data-action="use-default"]');
        if (useDefaultBtn) {
            e.stopPropagation();
            setActiveProfile(TinyTUS.DEFAULT_MODEM_PROFILE);
            return;
        }

        // Rozbalenie/zbalenie predvolenej karty
        const toggleDefault = e.target.closest('[data-action="toggle-default"]');
        if (toggleDefault) {
            toggleDefaultProfile();
            return;
        }

        // Rozbalenie/zbalenie užívateľského profilu
        const header = e.target.closest('[data-action="toggle"]');
        if (header) {
            toggleProfile(parseInt(header.dataset.profileId));
        }
    });

    container.addEventListener('change', (e) => {
        const el = e.target;
        if (!el.dataset.profileId || !el.dataset.field) return;
        const id    = parseInt(el.dataset.profileId);
        const value = el.dataset.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
        updateProfile(id, el.dataset.field, value);
    });
}

if (addButton)      addButton.addEventListener('click', addProfile);
if (confirmButton)  confirmButton.addEventListener('click', confirmDelete);
if (cancelButton)   cancelButton.addEventListener('click', closeModal);
if (confirmationModal) {
    confirmationModal.addEventListener('click', e => {
        if (e.target === confirmationModal) closeModal();
    });
}

// Sledovanie zmien schémy a prekreslenie
new MutationObserver(() => {
    // Prekreslenie predvolenej karty, ak je otvorená
    const defContent = document.getElementById('profile-content-default');
    if (defContent?.classList.contains('expanded')) drawWaveVisualization('default');

    // Prekreslenie užívateľských profilov
    profiles.forEach(p => {
        const content = document.getElementById(`profile-content-${p.id}`);
        if (content?.classList.contains('expanded')) drawWaveVisualization(p.id);
    });
}).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

// Inicializácia
window.addEventListener('refresh-local-storage', saveProfiles);

// Čakanie na načítanie WASM pred vykresľovaním, pretože predvolený profil
// vyžaduje existenciu TinyTUS.DEFAULT_MODEM_PROFILE
TinyTUS.afterLoad(() => {
    loadProfiles();
    renderProfiles();
});
