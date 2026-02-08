import { Tinitus } from '../../libs/tinitus/tinitus.js';
import { ModemProfile } from '../../libs/tinitus/modem_profile.js';

// Nazvy pre jednotlive parametre modemoveho profilu.
const PARAM_LABELS = {
    param: "Modulovaný parameter",
    min_rx_freq: "Min RX frekvencia (Hz)",
    max_rx_freq: "Max RX frekvencia (Hz)",
    car_freq: "Nosná frekvencia (Hz)",
    sample_rate: "Vzorkovacia frekvencia (Hz)",
    bps: "Bity za sekundu",
    bits_per_symbol: "Bity na symbol",
    min_tx_freq: "Min TX frekvencia (Hz)",
    max_tx_freq: "Max TX frekvencia (Hz)",
    min_tx_amp: "Min TX amplitúda (0-255)",
    max_tx_amp: "Max TX amplitúda (0-255)",
    min_tx_phs: "Min TX fáza (0-180°)",
    max_tx_phs: "Max TX fáza (0-180°)"
};

const PARAM_TYPES = {
    0: "Frekvencia",
    1: "Amplitúda",
    2: "Fáza"
};

const defaultModemParams = {
    param: 0,
    min_rx_freq: 1200,
    max_rx_freq: 2200,
    car_freq: 3000,
    sample_rate: 8000,
    bps: 100,
    bits_per_symbol: 1,
    min_tx_freq: 800,
    max_tx_freq: 1600,
    min_tx_amp: 100,
    max_tx_amp: 255,
    min_tx_phs: 0,
    max_tx_phs: 180
};

let profiles = [];
let profileIdCounter = 1;
let profileToDelete = null;

const container = document.getElementById('profiles-container');
const addButton = document.getElementById('add-profile-button');
const confirmationModal = document.getElementById('confirmation-modal');
const confirmButton = document.getElementById('confirmation-confirm-button');
const cancelButton = document.getElementById('confirmation-cancel-button');

function loadProfiles() {
    const saved = localStorage.getItem('modemProfiles');
    if (saved) {
        try {
            const savedProfiles = JSON.parse(saved);
            profiles = savedProfiles.map(p => ({
                id: p.id,
                name: p.name,
                modemProfile: new ModemProfile(p),
            }));
            profileIdCounter = Math.max(...profiles.map(p => p.id), 0) + 1;
        } catch (e) {
            profiles = [];
        }
    }
}

function saveProfiles() {
    const serialized = profiles.map(p => ({
        id: p.id,
        name: p.name,
        ...p.modemProfile.toObject()
    }));
    localStorage.setItem('modemProfiles', JSON.stringify(serialized));
}

function addProfile() {
    const modemProfile = new ModemProfile(defaultModemParams);
    const newProfile = {
        id: profileIdCounter++,
        name: `Profil ${profileIdCounter - 1}`,
        modemProfile
    };
    profiles.push(newProfile);
    saveProfiles();
    renderProfiles();

    // Expand the new profile and focus on name input
    setTimeout(() => {
        const content = document.getElementById(`profile-content-${newProfile.id}`);
        const nameInput = document.querySelector(`input[data-profile-id="${newProfile.id}"][data-field="name"]`);

        if (content) {
            content.classList.add('expanded');
            const toggle = document.getElementById(`profile-toggle-${newProfile.id}`);
            if (toggle) toggle.classList.add('expanded');
        }

        if (nameInput) {
            nameInput.focus();
            nameInput.select();
            drawWaveVisualization(newProfile.id);
        }
    }, 100);
}

function deleteProfile(id) {
    profileToDelete = id;
    confirmationModal.style.display = 'flex';
}

function confirmDelete() {
    if (profileToDelete !== null) {
        const profile = profiles.find(p => p.id === profileToDelete);
        if (profile?.modemProfile) {
            profile.modemProfile.destroy();
        }
        profiles = profiles.filter(p => p.id !== profileToDelete);
        saveProfiles();
        renderProfiles();
        profileToDelete = null;
    }
    closeModal();
}

function closeModal() {
    confirmationModal.style.display = 'none';
    profileToDelete = null;
}

function toggleProfile(id) {
    const content = document.getElementById(`profile-content-${id}`);
    const toggle = document.getElementById(`profile-toggle-${id}`);

    const wasExpanded = content.classList.contains('expanded');
    content.classList.toggle('expanded');
    toggle.classList.toggle('expanded');

    // Draw visualization when expanding
    if (!wasExpanded) {
        setTimeout(() => drawWaveVisualization(id), 50);
    }
}

function updateProfile(id, field, value) {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;

    if (field === 'name') {
        profile.name = value || `Profil ${id}`;
        const display = document.getElementById(`profile-name-display-${id}`);
        if (display) display.textContent = profile.name;
    } else {
        // Update via ModemProfile setter (automatically recalculates derived fields)
        profile.modemProfile[field] = parseFloat(value) || 0;

        // If modulation type changed, update visibility of TX parameters
        if (field === 'param') {
            updateTxParameterVisibility(id, profile.modemProfile.param);
        }
    }
    saveProfiles();

    // Redraw visualization if content is expanded
    const content = document.getElementById(`profile-content-${id}`);
    if (content && content.classList.contains('expanded')) {
        drawWaveVisualization(id);
    }
}

function updateTxParameterVisibility(profileId, modulationType) {
    const freqRow = document.getElementById(`tx-freq-row-${profileId}`);
    const ampRow = document.getElementById(`tx-amp-row-${profileId}`);
    const phsRow = document.getElementById(`tx-phs-row-${profileId}`);

    if (!freqRow || !ampRow || !phsRow) return;

    // Hide all first
    freqRow.style.display = 'none';
    ampRow.style.display = 'none';
    phsRow.style.display = 'none';

    // Show only the relevant one
    switch (modulationType) {
        case 0: // Frequency (FSK)
            freqRow.style.display = '';
            break;
        case 1: // Amplitude (ASK)
            ampRow.style.display = '';
            break;
        case 2: // Phase (PSK)
            phsRow.style.display = '';
            break;
    }
}

function drawWaveVisualization(profileId) {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;

    const mp = profile.modemProfile;
    const canvas = document.getElementById(`wave-canvas-${profileId}`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth * 2;
    const height = canvas.height = 350;

    ctx.clearRect(0, 0, width, height);

    const samples_per_bit = mp.samples_per_bit;
    const period = mp.sample_period * samples_per_bit;

    const padTop = 40;
    const padSide = 40;
    const padBottom = 90;
    const graphHeight = height - padTop - padBottom;
    const graphWidth = width - 2 * padSide;
    const graphCenterY = padTop + graphHeight / 2;

    // Detect theme for colors
    const isDark = document.documentElement.classList.contains('dark-scheme');
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : '#f1f3f5';
    const axisColor = isDark ? 'rgba(255,255,255,0.15)' : '#dee2e6';
    const waveColor = isDark ? '#579ffb' : '#007bff';
    const markerColor = isDark ? 'rgb(88, 128, 101)' : '#28a745';
    const labelColor = isDark ? 'rgba(255,255,255,0.5)' : '#6c757d';
    const titleColor = isDark ? 'rgba(255,255,255,0.7)' : '#495057';

    // Draw axes
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padSide, padTop);
    ctx.lineTo(padSide, padTop + graphHeight);
    ctx.lineTo(width - padSide, padTop + graphHeight);
    ctx.stroke();

    // Draw grid
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
        const y = padTop + (graphHeight * i / 4);
        ctx.beginPath();
        ctx.moveTo(padSide, y);
        ctx.lineTo(width - padSide, y);
        ctx.stroke();
    }

    // Draw waveform
    ctx.strokeStyle = waveColor;
    ctx.lineWidth = 3;
    ctx.beginPath();

    const numCycles = 3;
    const pointsPerCycle = 100;
    const totalPoints = numCycles * pointsPerCycle;

    mp.cphase = 1;
    let phase = 0; // Accumulated phase for continuous phase modulation

    for (let i = 0; i <= totalPoints; i++) {
        const t = (i / totalPoints) * numCycles;
        const dt = numCycles / totalPoints; // Time step
        let y;

        if (mp.param === 0) { // FSK
            const bit = Math.floor(t) % 2;
            const freq = bit ? mp.max_tx_freq : mp.min_tx_freq;
            const normalizedFreq = freq / 1000;

            if (mp.cphase) {
                // Continuous phase: accumulate phase based on instantaneous frequency
                phase += 2 * Math.PI * normalizedFreq * dt;
                y = Math.sin(phase);
            } else {
                // Discontinuous phase
                y = Math.sin(t * Math.PI * 2 * normalizedFreq);
            }
        } else if (mp.param === 1) { // ASK
            const bit = Math.floor(t) % 2;
            const amp = bit ? mp.max_tx_amp : mp.min_tx_amp;
            const normalizedAmp = amp / 255;
            y = Math.sin(t * Math.PI * 2 * 2) * normalizedAmp;
        } else { // PSK
            const bit = Math.floor(t) % 2;
            const phaseShift = bit ? (mp.max_tx_phs * Math.PI / 180) : (mp.min_tx_phs * Math.PI / 180);

            if (mp.cphase) {
                // For CPSK, gradually transition the phase
                phase = t * Math.PI * 2 * 2 + phaseShift;
                y = Math.sin(phase);
            } else {
                y = Math.sin(t * Math.PI * 2 * 2 + phaseShift);
            }
        }

        const x = padSide + (i / totalPoints) * graphWidth;
        const yPos = graphCenterY - (y * graphHeight / 3);
        if (i === 0) ctx.moveTo(x, yPos);
        else ctx.lineTo(x, yPos);
    }
    // const usedProfile = Tinitus.DEFAULT_MODEM_PROFILE;
    // usedProfile.cphase = 1;
    // usedProfile.max_tx_freq = Tinitus.DEFAULT_MODEM_PROFILE.max_tx_freq / 1000;
    // usedProfile.min_tx_freq = Tinitus.DEFAULT_MODEM_PROFILE.min_tx_freq / 1000;
    // const outLenPtr = Tinitus.MEMORY_STACK_START + 2048;
    // const outPtr = Tinitus.EXPORTS.fsk_modulate(usedProfile.ptr, 0xA, 1, outLenPtr);
    // const takeSamples = usedProfile.samples_per_bit * 3;
    // const outArray = Tinitus.getReturnValue("f32", outPtr, Tinitus.getValueFromPointer("i32", outLenPtr));
    // const points = outArray.slice(0, takeSamples);
    // print(points);
    // // Len prve tri bity:
    // for (let i = 0; i < points.length; i++) {
    //     const x = padSide + (i / points.length) * graphWidth;
    //     const yPos = graphCenterY - (points[i] * graphHeight / 3);

    //     if (i === 0) ctx.moveTo(x, yPos);
    //     else ctx.lineTo(x, yPos);
    // }
    ctx.stroke();

    // Draw bit period markers
    ctx.strokeStyle = markerColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    for (let i = 1; i < numCycles; i++) {
        const x = padSide + (i / numCycles) * graphWidth;
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + graphHeight);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw period arrow below the x-axis
    const arrowY = padTop + graphHeight + 30;
    const arrowStartX = padSide;
    const arrowEndX = padSide + (graphWidth / numCycles);

    ctx.strokeStyle = markerColor;
    ctx.fillStyle = markerColor;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(arrowStartX, arrowY);
    ctx.lineTo(arrowEndX, arrowY);
    ctx.stroke();

    const arrowSize = 8;
    ctx.beginPath();
    ctx.moveTo(arrowStartX, arrowY);
    ctx.lineTo(arrowStartX + arrowSize, arrowY - arrowSize / 2);
    ctx.lineTo(arrowStartX + arrowSize, arrowY + arrowSize / 2);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(arrowEndX, arrowY);
    ctx.lineTo(arrowEndX - arrowSize, arrowY - arrowSize / 2);
    ctx.lineTo(arrowEndX - arrowSize, arrowY + arrowSize / 2);
    ctx.closePath();
    ctx.fill();

    // Period label
    ctx.fillStyle = markerColor;
    ctx.font = '30px ';
    ctx.textAlign = 'center';
    ctx.fillText(`Perióda: ${period.toFixed(4)}s`, (arrowStartX + arrowEndX) / 2, arrowY + 20);

    // Y-axis labels
    ctx.fillStyle = labelColor;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('1.0', padSide - 10, padTop + 5);
    ctx.fillText('0.0', padSide - 10, graphCenterY + 5);
    ctx.fillText('-1.0', padSide - 10, padTop + graphHeight + 5);

    // Title
    ctx.fillStyle = titleColor;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    // const modType = PARAM_TYPES[mp.param] || 'Neznámy';
    // ctx.fillText(`${modType} modulácia`, width / 2, 25);
}

function renderProfiles() {
    if (!container) return;

    if (profiles.length === 0) {
        container.innerHTML = '<div class="empty-state">Žiadne profily. Kliknite na "Pridať profil" pre vytvorenie nového.</div>';
        return;
    }

    container.innerHTML = profiles.map(profile => {
        const mp = profile.modemProfile;
        const nyquist = mp.sample_rate / 2;

        return `
        <div class="profile-item">
            <div class="profile-header" data-profile-id="${profile.id}" data-action="toggle">
                <div class="profile-header-left">
                    <i id="profile-toggle-${profile.id}" class="fas fa-chevron-right profile-toggle"></i>
                    <span id="profile-name-display-${profile.id}" class="profile-name-display">${profile.name}</span>
                </div>
                <div class="profile-header-right">
                    <button class="delete-profile-button" data-profile-id="${profile.id}" data-action="delete">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
            <div id="profile-content-${profile.id}" class="profile-content">
                <div class="profile-field">
                    <label>Názov profilu</label>
                    <input type="text" value="${profile.name}"
                           data-profile-id="${profile.id}" data-field="name"
                           maxlength="32">
                </div>

                <div class="wave-visualization">
                    <div class="wave-viz-header">
                        <i class="fas fa-wave-square"></i>
                        Vizualizácia signálu
                    </div>
                    <div class="wave-canvas-container">
                        <canvas id="wave-canvas-${profile.id}"></canvas>
                    </div>
                    <div class="wave-info">
                        <div class="wave-info-item">
                            <span class="wave-info-label">Vzoriek na bit:</span> ${mp.samples_per_bit.toFixed(2)}
                        </div>
                        <div class="wave-info-item">
                            <span class="wave-info-label">Perióda bitu:</span> ${(mp.sample_period * mp.samples_per_bit * 1000).toFixed(2)} ms
                        </div>
                        <div class="wave-info-item">
                            <span class="wave-info-label">Nyquist frekvencia:</span> ${nyquist} Hz
                        </div>
                        <div class="wave-info-item">
                            <span class="wave-info-label">Modulácia:</span> ${PARAM_TYPES[mp.param] || 'Neznámy'}
                        </div>
                    </div>
                </div>

                <div class="section-divider">
                    <div class="section-title">Základné parametre</div>
                </div>

                <div class="profile-field">
                    <label>${PARAM_LABELS.param}</label>
                    <select data-profile-id="${profile.id}" data-field="param">
                        <option value="0" ${mp.param === 0 ? 'selected' : ''}>0 - Frekvencia (FSK)</option>
                        <option value="1" ${mp.param === 1 ? 'selected' : ''}>1 - Amplitúda (ASK)</option>
                        <option value="2" ${mp.param === 2 ? 'selected' : ''}>2 - Fáza (PSK)</option>
                    </select>
                    <div class="help-text">Typ modulácie používaný pre prenos dát</div>
                </div>

                <div class="profile-field-row">
                    <div class="profile-field">
                        <label>${PARAM_LABELS.sample_rate}</label>
                        <input type="number" value="${mp.sample_rate}"
                               data-profile-id="${profile.id}" data-field="sample_rate"
                               min="8000" max="48000" step="1000">
                        <div class="help-text">Odporúčané: 8000-48000 Hz</div>
                    </div>
                    <div class="profile-field">
                        <label>${PARAM_LABELS.bps}</label>
                        <input type="number" value="${mp.bps}"
                               data-profile-id="${profile.id}" data-field="bps"
                               min="1" max="1000">
                        <div class="help-text">Rýchlosť prenosu dát</div>
                    </div>
                </div>

                <div class="profile-field-row">
                    <div class="profile-field">
                        <label>${PARAM_LABELS.car_freq}</label>
                        <input type="number" value="${mp.car_freq}"
                               data-profile-id="${profile.id}" data-field="car_freq"
                               min="100" max="20000">
                        <div class="help-text">Nosná frekvencia signálu</div>
                    </div>
                    <div class="profile-field">
                        <label>${PARAM_LABELS.bits_per_symbol}</label>
                        <input type="number" value="${mp.bits_per_symbol}"
                               data-profile-id="${profile.id}" data-field="bits_per_symbol"
                               min="1" max="8">
                        <div class="help-text">Počet bitov na symbol</div>
                    </div>
                </div>

                <div class="section-divider">
                    <div class="section-title">RX Parametre (príjem)</div>
                </div>

                <div class="profile-field-row">
                    <div class="profile-field">
                        <label>${PARAM_LABELS.min_rx_freq}</label>
                        <input type="number" value="${mp.min_rx_freq}"
                               data-profile-id="${profile.id}" data-field="min_rx_freq"
                               min="100" max="20000">
                    </div>
                    <div class="profile-field">
                        <label>${PARAM_LABELS.max_rx_freq}</label>
                        <input type="number" value="${mp.max_rx_freq}"
                               data-profile-id="${profile.id}" data-field="max_rx_freq"
                               min="100" max="20000">
                    </div>
                </div>

                <div class="section-divider">
                    <div class="section-title">TX Parametre (vysielanie)</div>
                </div>

                <div id="tx-freq-row-${profile.id}" class="profile-field-row" style="display: ${mp.param === 0 ? '' : 'none'}">
                    <div class="profile-field">
                        <label>${PARAM_LABELS.min_tx_freq}</label>
                        <input type="number" value="${mp.min_tx_freq}"
                               data-profile-id="${profile.id}" data-field="min_tx_freq"
                               min="100" max="20000">
                        <div class="help-text">Pre bit 0</div>
                    </div>
                    <div class="profile-field">
                        <label>${PARAM_LABELS.max_tx_freq}</label>
                        <input type="number" value="${mp.max_tx_freq}"
                               data-profile-id="${profile.id}" data-field="max_tx_freq"
                               min="100" max="20000">
                        <div class="help-text">Pre bit 1</div>
                    </div>
                </div>

                <div id="tx-amp-row-${profile.id}" class="profile-field-row" style="display: ${mp.param === 1 ? '' : 'none'}">
                    <div class="profile-field">
                        <label>${PARAM_LABELS.min_tx_amp}</label>
                        <input type="number" value="${mp.min_tx_amp}"
                               data-profile-id="${profile.id}" data-field="min_tx_amp"
                               min="0" max="255">
                        <div class="help-text">Pre bit 0 (0-255)</div>
                    </div>
                    <div class="profile-field">
                        <label>${PARAM_LABELS.max_tx_amp}</label>
                        <input type="number" value="${mp.max_tx_amp}"
                               data-profile-id="${profile.id}" data-field="max_tx_amp"
                               min="0" max="255">
                        <div class="help-text">Pre bit 1 (0-255)</div>
                    </div>
                </div>

                <div id="tx-phs-row-${profile.id}" class="profile-field-row" style="display: ${mp.param === 2 ? '' : 'none'}">
                    <div class="profile-field">
                        <label>${PARAM_LABELS.min_tx_phs}</label>
                        <input type="number" value="${mp.min_tx_phs}"
                               data-profile-id="${profile.id}" data-field="min_tx_phs"
                               min="0" max="180">
                        <div class="help-text">Pre bit 0 (0-180°)</div>
                    </div>
                    <div class="profile-field">
                        <label>${PARAM_LABELS.max_tx_phs}</label>
                        <input type="number" value="${mp.max_tx_phs}"
                               data-profile-id="${profile.id}" data-field="max_tx_phs"
                               min="0" max="180">
                        <div class="help-text">Pre bit 1 (0-180°)</div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

if (container) {
    container.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('[data-action="delete"]');
        if (deleteBtn) {
            e.stopPropagation();
            const id = parseInt(deleteBtn.dataset.profileId);
            deleteProfile(id);
            return;
        }

        const header = e.target.closest('[data-action="toggle"]');
        if (header) {
            const id = parseInt(header.dataset.profileId);
            toggleProfile(id);
        }
    });

    container.addEventListener('change', (e) => {
        const el = e.target;
        if (el.dataset.profileId && el.dataset.field) {
            const id = parseInt(el.dataset.profileId);
            updateProfile(id, el.dataset.field, el.value);
        }
    });
}

if (addButton) {
    addButton.addEventListener('click', addProfile);
}

if (confirmButton) {
    confirmButton.addEventListener('click', confirmDelete);
}

if (cancelButton) {
    cancelButton.addEventListener('click', closeModal);
}

if (confirmationModal) {
    confirmationModal.addEventListener('click', (e) => {
        if (e.target === confirmationModal) closeModal();
    });
}

const themeObserver = new MutationObserver(() => {
    profiles.forEach(p => {
        const content = document.getElementById(`profile-content-${p.id}`);
        if (content && content.classList.contains('expanded')) {
            drawWaveVisualization(p.id);
        }
    });
});
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

window.addEventListener('refresh-local-storage', saveProfiles);

loadProfiles();
renderProfiles();
