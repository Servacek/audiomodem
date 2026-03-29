// Renderovanie HTML kariet profilov a delegacia UI eventov.

import { TinyTUS } from '../../../libs/tinytus/tinytus.js';
import { renderFreqPicker, initFreqPickers, updateFreqPickerRange } from '../../freq_picker.js';
import {
    getProfiles, getProfileById, isProfileActive, isDefaultActive,
    setActiveProfile, removeProfileFromStore, addProfileToStore,
    normalizeChannelCount, estimateChannelCountFromModemProfile,
    updateProfileField, saveProfiles, MAX_PROFILE_NAME, MAX_CHANNEL_COUNT,
} from './profile-store.js';
import { getModemProfileTLVCode, isProfileSameAsDefault, applyProfileCodeToModemProfile } from './profile-import.js';
import { updateProfileSpectrogram } from './profile-spectrogram.js';
import { ModemProfile } from '../../../libs/tinytus/modem_profile.js';

const $ = id => document.getElementById(id);

const PARAM_LABELS = {
    sample_rate:        'Vzorkovacia frekvencia (Hz)',
    channel_size:       'Sirka kanala (Hz)',
    bits_per_tone:      'Pocet bitov na jeden ton',
    symbols_per_marker: 'Dlzka markera v symboloch',
    bits_in_marker:     'Pocet tonov v markeri',
    tones_per_symbol:   'Pocet tonov v symbole',
    ecc_percent:        'Podiel samoopravnych bajtov',
    dss_enabled:        'DSS (rozptyl spektra)',
    squelch_thresh:     'Squelch',
    cphase:             'Spojna faza',
    max_tx_amp:         'Hlasitost vysielaca',
    samples_per_symbol: 'Pocet vzorkov na jeden symbol',
    channel_count:      'Pocet kanalov',
};

// ─── Pomocne HTML buildery ────────────────────────────────────────────────────

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
    if (readonly) return fieldWrap(name, `<select disabled><option>${val}</option></select>`, help);
    const optionsHtml = options.map(opt => `<option value="${opt}" ${opt == val ? 'selected' : ''}>${opt}</option>`).join('');
    return fieldWrap(name, `<select data-profile-id="${id}" data-field="${name}">${optionsHtml}</select>`, help);
}

function row(...fields) { return `<div class="profile-field-row">${fields.join('')}</div>`; }
function divider(title) { return `<div class="section-divider"><div class="section-title">${title}</div></div>`; }

// ─── Informacie o profile ─────────────────────────────────────────────────────

function getChannelSummaryText(mp) {
    const channelCount = normalizeChannelCount(mp?.channel_count, estimateChannelCountFromModemProfile(mp));
    const channelSize = Number(mp?.channel_size);
    const minTx = Number(mp?.min_tx_freq);
    if (!Number.isFinite(channelSize) || channelSize <= 0 || !Number.isFinite(minTx)) return '-';
    return `${channelCount}x${channelSize} Hz (${minTx} - ${minTx + channelSize} Hz)`;
}

function getSpeedText(mp) {
    const bps = (Number(mp.symbol_rate) || 0) * ((Number(mp.bits_per_tone) || 0) * Number(mp.tones_per_symbol || 0));
    if (!Number.isFinite(bps) || bps <= 0) return '-';
    return `${bps.toFixed(2)} b/s`;
}

function renderReadonlyProps(mp, idSuffix) {
    const nyquist = Math.round((Number(mp.sample_rate) || 0) / 2);
    const items = [
        { label: PARAM_LABELS.sample_rate, value: `<span data-profile-sample-rate-for="${idSuffix}">${mp.sample_rate} Hz (Nyquist ${nyquist} Hz)</span>` },
        { label: PARAM_LABELS.channel_size, value: `<span data-profile-channel-size-for="${idSuffix}">${getChannelSummaryText(mp)}</span>` },
        { label: 'Rychlost', value: `<span data-profile-speed-for="${idSuffix}">${getSpeedText(mp)}</span>` },
    ];
    return `<div class="profile-readonly-properties">${
        items.map(item => `<div class="profile-readonly-prop-row">
            <span class="profile-readonly-prop-label">${item.label}</span>
            <span class="profile-readonly-prop-value">${item.value}</span>
        </div>`).join('')
    }</div>`;
}

export function updateReadonlyProps(profileId, mp, channelCount = null) {
    const idSuffix = profileId === 'default' ? 'default' : String(profileId);
    const nyquist = Math.round((Number(mp.sample_rate) || 0) / 2);
    const renderMp = Object.create(mp);
    renderMp.channel_count = channelCount ?? mp?.channel_count;

    const srEl = document.querySelector(`[data-profile-sample-rate-for="${idSuffix}"]`);
    if (srEl) srEl.textContent = `${mp.sample_rate} Hz (Nyquist ${nyquist} Hz)`;

    const csEl = document.querySelector(`[data-profile-channel-size-for="${idSuffix}"]`);
    if (csEl) csEl.textContent = getChannelSummaryText(renderMp);

    const spEl = document.querySelector(`[data-profile-speed-for="${idSuffix}"]`);
    if (spEl) spEl.textContent = getSpeedText(mp);
}

// ─── Zdielanie profilu ────────────────────────────────────────────────────────

function renderShareRow(mp, idSuffix, readonly) {
    if (readonly) return '';
    const profileCode = getModemProfileTLVCode(mp);
    const unchanged = isProfileSameAsDefault(mp);
    return `<div class="profile-share-row">
        <button class="share-profile-button" data-action="share-profile" data-profile-id="${idSuffix}" ${unchanged ? 'disabled' : ''}>
            <i class="fas fa-share-nodes"></i> Zdielat profil
        </button>
        <div class="profile-share-content" data-profile-share-for="${idSuffix}">
            <div class="profile-share-code-wrap${unchanged ? ' is-hidden' : ''}">
                <input type="text" class="profile-code-input" data-profile-code-for="${idSuffix}" value="${profileCode}"
                    readonly title="Kliknite pre skopirovanie kodu profilu">
                <button class="copy-profile-code-button" data-action="copy-profile-code" data-profile-id="${idSuffix}"
                    title="Skopirovat kod profilu">
                    <i class="fas fa-copy"></i>
                </button>
            </div>
            <div class="profile-share-nochanges${unchanged ? '' : ' is-hidden'}">
                Profil nema zmeny oproti predvolenemu profilu.
            </div>
        </div>
    </div>`;
}

export function syncProfileCodeInput(profileId, profileCode) {
    const el = document.querySelector(`[data-profile-code-for="${profileId}"]`);
    if (el) el.value = profileCode;
}

export function updateProfileCodeUI(profileId, mp) {
    const profileCode = getModemProfileTLVCode(mp);
    syncProfileCodeInput(profileId, profileCode);

    const shareWrap = document.querySelector(`[data-profile-share-for="${profileId}"]`);
    if (!shareWrap) return;

    const unchanged = isProfileSameAsDefault(mp);
    const row = shareWrap.closest('.profile-share-row');
    const shareBtn = row?.querySelector('[data-action="share-profile"]');
    if (shareBtn) shareBtn.disabled = unchanged;
    shareWrap.querySelector('.profile-share-code-wrap')?.classList.toggle('is-hidden', unchanged);
    shareWrap.querySelector('.profile-share-nochanges')?.classList.toggle('is-hidden', !unchanged);
}

// ─── Tooltip pre kopírovanie ──────────────────────────────────────────────────

let copyTooltip = null;
let copyTooltipTimer = null;

function ensureCopyTooltip() {
    if (copyTooltip && document.body.contains(copyTooltip)) return copyTooltip;
    copyTooltip = document.createElement('div');
    copyTooltip.className = 'profile-copy-tooltip';
    copyTooltip.innerHTML = '<i class="fas fa-circle-check"></i><span>Skopirovane!</span>';
    document.body.appendChild(copyTooltip);
    return copyTooltip;
}

function showCopyTooltip(anchorEl) {
    if (!anchorEl) return;
    const tooltip = ensureCopyTooltip();
    const rect = anchorEl.getBoundingClientRect();
    tooltip.style.top = `${Math.max(10, rect.top - 12)}px`;
    tooltip.style.left = `${Math.max(12, Math.min(window.innerWidth - 12, rect.left + rect.width / 2))}px`;
    tooltip.classList.remove('is-visible');
    requestAnimationFrame(() => tooltip.classList.add('is-visible'));
    if (copyTooltipTimer) clearTimeout(copyTooltipTimer);
    copyTooltipTimer = setTimeout(() => tooltip.classList.remove('is-visible'), 1300);
}

async function copyText(text, fallbackInput) {
    if (!text) return false;
    if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback nizsie */ }
    }
    if (!fallbackInput) return false;
    try {
        fallbackInput.focus({ preventScroll: true });
        fallbackInput.select();
        return document.execCommand('copy');
    } catch { return false; }
}

async function copyProfileCode(profileId, anchorEl) {
    const profile = getProfileById(profileId);
    if (!profile) return;
    const profileCode = getModemProfileTLVCode(profile.modemProfile);
    if (!profileCode) return;
    syncProfileCodeInput(profileId, profileCode);
    const codeInput = document.querySelector(`[data-profile-code-for="${profileId}"]`);
    if (!await copyText(profileCode, codeInput)) return;
    if (codeInput) { codeInput.focus({ preventScroll: true }); codeInput.select(); }
    showCopyTooltip(anchorEl || codeInput);
}

// ─── Pole s informaciami o vlne ───────────────────────────────────────────────

const WAVE_INFO_KEYS = [
    ['Symbolova rychlost:', 'symbol-rate', mp => mp.symbol_rate?.toFixed(3) ?? '-'],
    ['Perioda symbolu:',    'period',      mp => `${(mp.sample_duration * mp.samples_per_symbol * 1000).toFixed(3)} ms`],
    ['Nyquist frekvencia:', 'nyquist',     mp => `${mp.sample_rate / 2} Hz`],
];

export function updateWaveInfo(profileId, mp) {
    const suffix = profileId === 'default' ? 'default' : String(profileId);
    WAVE_INFO_KEYS.forEach(([, key, fn]) => {
        const el = document.querySelector(`[data-wave-info="${key}${suffix}"]`);
        if (el) el.textContent = fn(mp);
    });
}

// ─── Renderovanie poli profilu ────────────────────────────────────────────────

function renderProfileFields(mp, idSuffix, readonly) {
    const n   = (name, opts) => numField(name, mp, idSuffix, readonly, opts);
    const t   = (name, help = '') => toggleField(name, mp, idSuffix, readonly, help);
    const s   = (name, opts) => sliderField(name, mp, idSuffix, readonly, opts);
    const sel = (name, opts) => selectField(name, mp, idSuffix, readonly, opts);

    const pickerProfile = {
        sample_rate:   Number(mp.sample_rate)   || 0,
        min_tx_freq:   Number(mp.min_tx_freq)   || 0,
        max_tx_freq:   Number(mp.max_tx_freq)   || 0,
        freq_bin_hz:   Number(mp.freq_bin_hz)   || 1,
        channel_count: normalizeChannelCount(mp?.channel_count),
    };

    return `
        ${renderShareRow(mp, idSuffix, readonly)}
        ${readonly ? '<div class="profile-readonly-note"><i class="fas fa-lock"></i> Tento profil sa pouziva na synchronizaciu komunikacie a neda sa upravovat.</div>' : ''}
        ${renderReadonlyProps(mp, idSuffix)}
        ${divider('Zakladne parametre')}
        ${row(sel('samples_per_symbol', { options: [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192], help: 'Pocet vzoriek na jeden symbol (mocnina 2)' }),
              n('bits_per_tone', { min: 1, max: 32, help: 'Kolko bitov ma jeden ton reprezentovat.' }))}
        ${row(
            n('tones_per_symbol', { min: 1, max: 255, help: 'Kolko tonov ma jeden symbol obsahovat.' }),
            fieldWrap('channel_count', readonly
                ? `<input type="number" value="${normalizeChannelCount(mp?.channel_count)}" disabled>`
                : `<input type="number" value="${normalizeChannelCount(mp?.channel_count)}" data-profile-id="${idSuffix}" data-field="channel_count" min="1" max="${MAX_CHANNEL_COUNT}" step="1">`,
                'Na kolko rovnako velkych casti mame rozdelit spektrum frekvencii.')
        )}
        ${divider('TX Parametre (vysielanie)')}
        ${s('max_tx_amp', { min: 0, max: 1, step: 0.01, icon: 'fas fa-volume-high',
            help: 'Maximalna amplituda vysielaneho signalu', format: v => parseFloat(v).toFixed(2) })}
        ${renderFreqPicker(pickerProfile, idSuffix, readonly)}
        ${divider('Pokrocile nastavenia')}
        <div class="profile-subsection-title">Markery</div>
        <div class="section-description">
            Markery su specialne tony, ktore oznacuju zaciatok alebo koniec datoveho prenosu.
        </div>
        ${row(n('symbols_per_marker', { min: 1, max: 255, help: 'Kolko dlzok symbolu ma jeden marker trvat.' }),
              n('bits_in_marker',     { min: 1, max: 255, help: 'Kolko tonov ma marker obsahovat.' }))}
        <div class="profile-subsection-title"></div>
        ${s('ecc_percent',    { min: 0, max: 1, step: 0.05, help: 'Podiel ECC bajtov (0% = ziadne, 100% = max ochrana)', format: v => `${Math.round(v * 100)} %` })}
        ${s('squelch_thresh', { min: 0, max: 1, step: 0.005, icon: 'fas fa-filter', help: 'Prahova hodnota squelchu', format: v => parseFloat(v).toFixed(3) })}
        <div class="profile-field-row" style="gap:24px;align-items:center;">
            ${t('cphase', 'Spojna faza (CPM)')}
            ${t('dss_enabled', 'Vynasobj prenasane bajty pseudonahodnymi cislami pre rovnomernejsie rozlozenie energie.')}
        </div>`;
}

function profileCardHtml({ id, name, mp, active, readonly = false, isDefault = false }) {
    const suffix = isDefault ? 'default' : id;
    const profileAttr = isDefault ? '' : `data-profile-id="${id}"`;

    const headerLeft = isDefault
        ? `<i id="profile-toggle-default" class="fas fa-chevron-right profile-toggle"></i>
           <span class="profile-name-display">Predvoleny profil</span>`
        : `<i id="profile-toggle-${id}" class="fas fa-chevron-right profile-toggle"></i>
           <span class="profile-id-label" title="ID profilu">#${id}</span>
           <input type="text" id="profile-name-input-${id}" class="profile-name-input"
                  value="${name}" data-profile-id="${id}" data-field="name"
                  maxlength="${MAX_PROFILE_NAME}" placeholder="Nazov profilu"
                  onclick="event.stopPropagation()">`;

    const headerRight = `
        <button class="use-profile-button ${active ? 'use-profile-button--active' : ''}"
                data-action="${isDefault ? 'use-default' : 'use-profile'}" ${profileAttr} ${active ? 'disabled' : ''}>
            ${active ? '<i class="fas fa-check"></i> Pouziva sa' : 'Pouzit'}
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

// ─── Sticky header observery ──────────────────────────────────────────────────

let stickyObservers = [];

function setupStickyHeaderObservers(container, configTabContent) {
    stickyObservers.forEach(io => io.disconnect());
    stickyObservers = [];
    if (!configTabContent) return;

    container.querySelectorAll('.profile-sticky-sentinel').forEach(sentinel => {
        const header = sentinel.nextElementSibling;
        if (!header?.classList.contains('profile-header')) return;
        const io = new IntersectionObserver(([entry]) => {
            header.classList.toggle('profile-header--stuck', !entry.isIntersecting);
        }, { root: configTabContent, threshold: 0 });
        io.observe(sentinel);
        stickyObservers.push(io);
    });
}

// ─── Vykreslenie ──────────────────────────────────────────────────────────────

export function renderProfiles(container, configTabContent, usbProfileSelector) {
    if (!container) return;

    const profiles = getProfiles();
    const defaultMp = TinyTUS.DEFAULT_MODEM_PROFILE;

    const profileItems = profiles.map(p => {
        const renderMp = Object.create(p.modemProfile);
        renderMp.channel_count = p.channelCount;
        return { id: p.id, name: p.name, mp: renderMp, active: isProfileActive(p) };
    });

    const defaultRenderMp = defaultMp ? (() => {
        const renderMp = Object.create(defaultMp);
        renderMp.channel_count = estimateChannelCountFromModemProfile(defaultMp);
        return renderMp;
    })() : null;

    container.innerHTML = [
        ...profileItems.map(item => profileCardHtml(item)),
        defaultRenderMp ? profileCardHtml({ mp: defaultRenderMp, active: isDefaultActive(), readonly: true, isDefault: true }) : '',
        profiles.length === 0 ? '<div class="empty-state">Ziadne vlastne profily. Kliknite na "Pridat profil" pre vytvorenie noveho.</div>' : '',
    ].join('');

    // Naplnenie USB selektora.
    if (usbProfileSelector) {
        const currentSelection = usbProfileSelector.value;
        usbProfileSelector.innerHTML = '<option value="">Ponechat aktualny profil</option>';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = 'default';
        defaultOpt.textContent = 'Predvoleny profil';
        usbProfileSelector.appendChild(defaultOpt);
        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            usbProfileSelector.appendChild(opt);
        });
        usbProfileSelector.value = currentSelection;
    }

    initFreqPickers();
    setupStickyHeaderObservers(container, configTabContent);
}

// ─── Aktivny profil UI ────────────────────────────────────────────────────────

export function updateActiveProfileUI(modemProfile) {
    document.querySelectorAll('.profile-item--active').forEach(el => el.classList.remove('profile-item--active'));

    const isDefault = modemProfile === TinyTUS.DEFAULT_MODEM_PROFILE;
    const activeId = isDefault ? 'default' : getProfiles().find(p => p.modemProfile === modemProfile)?.id;
    if (!activeId) return;

    document.querySelector(`#profile-content-${activeId}`)?.parentElement?.classList.add('profile-item--active');

    document.querySelectorAll('[data-action="use-profile"], [data-action="use-default"]').forEach(btn => {
        const btnId = btn.dataset.profileId ? parseInt(btn.dataset.profileId) : 'default';
        const active = btnId === activeId;
        btn.disabled = active;
        btn.classList.toggle('use-profile-button--active', active);
        btn.innerHTML = active ? '<i class="fas fa-check"></i> Pouziva sa' : 'Pouzit';
    });
}

// ─── Toggle profilu ───────────────────────────────────────────────────────────

export function toggleProfile(id, onOpened) {
    const content = $(`profile-content-${id}`);
    const toggle  = $(`profile-toggle-${id}`);
    const opening = !content.classList.contains('expanded');
    content.classList.toggle('expanded');
    toggle?.classList.toggle('expanded');
    if (opening && onOpened) onOpened(id);
}

// ─── Delegacia eventov ────────────────────────────────────────────────────────

export function initContainerEvents(container, callbacks) {
    container?.addEventListener('click', async e => {
        const btn = action => e.target.closest(`[data-action="${action}"]`);
        const codeInput = e.target.closest('.profile-code-input');

        if (btn('copy-profile-code')) {
            e.stopPropagation();
            const id = parseInt(btn('copy-profile-code').dataset.profileId, 10);
            if (!Number.isNaN(id)) await copyProfileCode(id, btn('copy-profile-code'));
            return;
        }
        if (codeInput) {
            e.stopPropagation();
            const id = parseInt(codeInput.dataset.profileCodeFor, 10);
            if (!Number.isNaN(id)) await copyProfileCode(id, codeInput);
            return;
        }
        if (btn('share-profile')) {
            e.stopPropagation();
            const id = parseInt(btn('share-profile').dataset.profileId);
            if (!Number.isNaN(id)) {
                const profile = getProfileById(id);
                if (profile) {
                    const code = getModemProfileTLVCode(profile.modemProfile);
                    syncProfileCodeInput(id, code);
                    window.dispatchEvent(new CustomEvent('chat-share-profile', { detail: { profileCode: code } }));
                }
            }
            return;
        }
        if (btn('delete')) {
            e.stopPropagation();
            const id = parseInt(btn('delete').dataset.profileId);
            return e.shiftKey ? callbacks.doDelete(id) : callbacks.confirmDelete(id);
        }
        if (btn('use-profile')) {
            e.stopPropagation();
            const p = getProfileById(parseInt(btn('use-profile').dataset.profileId));
            if (p) { setActiveProfile(p.modemProfile); callbacks.onProfileChanged(); }
            return;
        }
        if (btn('use-default')) {
            e.stopPropagation();
            setActiveProfile(TinyTUS.DEFAULT_MODEM_PROFILE);
            callbacks.onProfileChanged();
            return;
        }
        if (btn('toggle-default')) return toggleProfile('default', callbacks.onProfileOpened);
        if (btn('toggle')) return toggleProfile(parseInt(btn('toggle').dataset.profileId), callbacks.onProfileOpened);
    });

    container?.addEventListener('change', e => {
        const { profileId, field, type } = e.target.dataset;
        if (!profileId || !field) return;
        if (e.target.type === 'number' && !e.target.validity.valid) return;
        const id = parseInt(profileId);
        const value = type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value;
        if (updateProfileField(id, field, value)) callbacks.onFieldChanged(id, field);
    });

    container?.addEventListener('input', e => {
        if (e.target.classList.contains('profile-name-input')) {
            const { profileId, field } = e.target.dataset;
            if (profileId && field === 'name') {
                updateProfileField(parseInt(profileId), 'name', e.target.value);
            }
        }
    });
}
