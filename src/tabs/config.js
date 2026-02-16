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
    ecc_percent:        "ECC overhead (0.0 – 1.0)",
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

    const ctx    = canvas.getContext('2d');
    const width  = canvas.width  = canvas.offsetWidth * 2;
    const height = canvas.height = 350;

    ctx.clearRect(0, 0, width, height);

    const period = mp.sample_duration * mp.samples_per_symbol;

    const padTop    = 40;
    const padSide   = 40;
    const padBottom = 90;
    const graphHeight  = height - padTop - padBottom;
    const graphWidth   = width  - 2 * padSide;
    const graphCenterY = padTop + graphHeight / 2;

    const isDark      = document.documentElement.classList.contains('dark-scheme');
    const gridColor   = isDark ? 'rgba(255,255,255,0.08)' : '#f1f3f5';
    const axisColor   = isDark ? 'rgba(255,255,255,0.15)' : '#dee2e6';
    const waveColor   = isDark ? '#579ffb' : '#007bff';
    const markerColor = isDark ? 'rgb(88,128,101)' : '#28a745';
    const labelColor  = isDark ? 'rgba(255,255,255,0.5)' : '#6c757d';

    // Osi
    ctx.strokeStyle = axisColor;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(padSide, padTop);
    ctx.lineTo(padSide, padTop + graphHeight);
    ctx.lineTo(width - padSide, padTop + graphHeight);
    ctx.stroke();

    // Mriežka
    ctx.strokeStyle = gridColor;
    ctx.lineWidth   = 1;
    for (let i = 1; i < 4; i++) {
        const y = padTop + (graphHeight * i / 4);
        ctx.beginPath();
        ctx.moveTo(padSide, y);
        ctx.lineTo(width - padSide, y);
        ctx.stroke();
    }

    // Vlnový tvar
    ctx.strokeStyle = waveColor;
    ctx.lineWidth   = 3;
    ctx.beginPath();

    const numCycles      = 3;
    const pointsPerCycle = 100;
    const totalPoints    = numCycles * pointsPerCycle;
    let phase = 0;

    for (let i = 0; i <= totalPoints; i++) {
        const t  = (i / totalPoints) * numCycles;
        const dt = numCycles / totalPoints;
        let y;

        const freq           = Math.floor(t) % 2 ? mp.max_tx_freq : mp.min_tx_freq;
        const normalizedFreq = freq / 1000;
        if (mp.cphase) {
            phase += 2 * Math.PI * normalizedFreq * dt;
            y = Math.sin(phase);
        } else {
            y = Math.sin(t * Math.PI * 2 * normalizedFreq);
        }

        const x    = padSide + (i / totalPoints) * graphWidth;
        const yPos = graphCenterY - (y * graphHeight / 3);
        i === 0 ? ctx.moveTo(x, yPos) : ctx.lineTo(x, yPos);
    }
    ctx.stroke();

    // Značky bitovej periódy
    ctx.strokeStyle = markerColor;
    ctx.lineWidth   = 2;
    ctx.setLineDash([5, 5]);
    for (let i = 1; i < numCycles; i++) {
        const x = padSide + (i / numCycles) * graphWidth;
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + graphHeight);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    // Šípka periódy
    const arrowY      = padTop + graphHeight + 30;
    const arrowStartX = padSide;
    const arrowEndX   = padSide + graphWidth / numCycles;
    const arrowSize   = 8;

    ctx.strokeStyle = markerColor;
    ctx.fillStyle   = markerColor;
    ctx.lineWidth   = 2;

    ctx.beginPath();
    ctx.moveTo(arrowStartX, arrowY);
    ctx.lineTo(arrowEndX, arrowY);
    ctx.stroke();

    for (const [x, dir] of [[arrowStartX, 1], [arrowEndX, -1]]) {
        ctx.beginPath();
        ctx.moveTo(x, arrowY);
        ctx.lineTo(x + dir * arrowSize, arrowY - arrowSize / 2);
        ctx.lineTo(x + dir * arrowSize, arrowY + arrowSize / 2);
        ctx.closePath();
        ctx.fill();
    }

    ctx.fillStyle   = markerColor;
    ctx.font        = '30px sans-serif';
    ctx.textAlign   = 'center';
    ctx.fillText(`Perióda: ${period.toFixed(4)}s`, (arrowStartX + arrowEndX) / 2, arrowY + 20);

    // Popisky na osi Y
    ctx.fillStyle = labelColor;
    ctx.font      = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(' 1.0', padSide - 10, padTop + 5);
    ctx.fillText(' 0.0', padSide - 10, graphCenterY + 5);
    ctx.fillText('-1.0', padSide - 10, padTop + graphHeight + 5);
}

// Vykreslenie
function renderProfileFields(mp, idSuffix, readonly) {
    const field = (name, inputHtml, helpText = '') => `
        <div class="profile-field">
            <label>${PARAM_LABELS[name] ?? name}</label>
            ${inputHtml}
            ${helpText ? `<div class="help-text">${helpText}</div>` : ''}
        </div>`;

    const num = (name, {min, max, step = 1, help = ''} = {}) => {
        const val = mp[name] ?? 0;
        if (readonly) return field(name,
            `<input type="number" value="${val}" disabled>`, help);
        return field(name,
            `<input type="number" value="${val}"
                data-profile-id="${idSuffix}" data-field="${name}"
                ${min != null ? `min="${min}"` : ''}
                ${max != null ? `max="${max}"` : ''}
                step="${step}">`, help);
    };

    const toggle = (name, help = '') => {
        const checked = mp[name] ? 'checked' : '';
        if (readonly) return field(name,
            `<input type="checkbox" ${checked} disabled>`, help);
        return field(name,
            `<input type="checkbox" ${checked}
                data-profile-id="${idSuffix}" data-field="${name}" data-type="checkbox">`, help);
    };

    return `
        <div class="section-divider"><div class="section-title">Základné parametre</div></div>

        <div class="profile-field-row">
            ${num('sample_rate',        { min: 8000, max: 96000, step: 1000, help: 'Odporúčané: 8 000 – 48 000 Hz' })}
            ${num('samples_per_symbol',        { min: 1, max: 10000, step: 2, help: 'Počet vzoriek na jeden symbol' })}
        </div>
        <div class="profile-field-row">
            ${num('bits_per_symbol',    { min: 1, max: 8,   help: 'Počet bitov na symbol' })}
            ${num('bytes_per_tx_block', { min: 1, max: 32,  help: 'Bajtov v jednom TX bloku' })}
        </div>
        <div class="profile-field-row">
            ${num('ecc_percent', { min: 0, max: 1, step: 0.05, help: 'Podiel ECC bajtov (0.0 = žiadne, 1.0 = 100 %)' })}
        </div>
        <div class="profile-field-row">
            ${num('squelch_thresh', { min: 0, max: 1, step: 0.01, help: 'Prahová hodnota pre squelch' })}
            <div class="profile-field-row" style="gap: 24px; align-items: center;">
                ${toggle('cphase',      'Spojitá fáza (CPM)')}
                ${toggle('dss_enabled', 'Rozptyl spektra (DSS)')}
            </div>
        </div>

        <div class="section-divider"><div class="section-title">RX Parametre (príjem)</div></div>
        <div class="profile-field-row">
            ${num('min_rx_freq', { min: 100, max: 20000 })}
            ${num('max_rx_freq', { min: 100, max: 20000 })}
        </div>

        <div class="section-divider"><div class="section-title">TX Parametre (vysielanie)</div></div>

        <div id="tx-freq-row-${idSuffix}" class="profile-field-row"
            style="display: flex">
            ${renderFreqPicker(mp, idSuffix, readonly)}
        </div>
    `;
}

function renderDefaultProfileCard() {
    const mp      = TinyTUS.DEFAULT_MODEM_PROFILE;
    if (!mp) return '';

    const active  = isDefaultActive();
    const nyquist = mp.sample_rate / 2;

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
                <div class="wave-info">
                    <div class="wave-info-item">
                        <span class="wave-info-label">Symbolová rýchlosť:</span> ${mp.symbol_rate?.toFixed(3) ?? '–'}
                    </div>
                    <div class="wave-info-item">
                        <span class="wave-info-label">Perióda symbolu:</span>
                        ${((mp.sample_duration ?? 0) * (mp.samples_per_symbol ?? 0) * 1000).toFixed(2)} ms
                    </div>
                    <div class="wave-info-item">
                        <span class="wave-info-label">Nyquist frekvencia:</span> ${nyquist} Hz
                    </div>
                </div>
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
        const nyquist = mp.sample_rate / 2;

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
                    <div class="wave-info">
                        <div class="wave-info-item">
                            <span class="wave-info-label">Symbolová rýchlosť:</span> ${mp.symbol_rate?.toFixed(2) ?? '–'}
                        </div>
                        <div class="wave-info-item">
                            <span class="wave-info-label">Perióda symbolu:</span>
                            ${(mp.sample_duration * mp.samples_per_symbol * 1000).toFixed(2)} ms
                        </div>
                        <div class="wave-info-item">
                            <span class="wave-info-label">Nyquist frekvencia:</span> ${nyquist} Hz
                        </div>
                        <div class="wave-info-item">
                            <span class="wave-info-label">Frekvenčná modulácia</span>}
                        </div>
                    </div>
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
