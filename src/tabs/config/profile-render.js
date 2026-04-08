// Renderovanie HTML kariet profilov a delegacia UI eventov.

import { TinyTUS } from '../../../libs/tinytus/tinytus.js';
import { renderFreqPicker, initFreqPickers, updateFreqPickerRange } from '../../freq_picker.js';
import {
    getProfiles, getProfileById, isProfileActive, isDefaultActive,
    setActiveProfile, removeProfileFromStore, addProfileToStore,
    normalizeChannelCount, estimateChannelCountFromModemProfile,
    updateProfileField, saveProfiles, MAX_PROFILE_NAME, MAX_CHANNEL_COUNT,
} from './profile-store.js';
import { getModemProfileTLVCode, isProfileSameAsDefault } from './profile-tlv.js';
import { ModemProfile } from '../../../libs/tinytus/modem_profile.js';
import { preValidateFieldValue } from './profile-validation.js';
import {
    PARAM_LABELS, HELP, SECTIONS, WAVE_INFO_LABELS, SPEED_LABEL,
    PROFILE_CARD, USB_SELECTOR,
} from './profile-strings.js';

const $ = id => document.getElementById(id);

// --- Pomocne HTML buildery ---

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

function formatSliderLabel(field, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    if (field === 'ecc_percent') return `${Math.round(n * 100)}%`;
    if (field === 'max_tx_amp') return n.toFixed(2);
    return n.toFixed(3);
}

function clearFieldError(el) {
    const wrap = el?.closest('.profile-field');
    if (!wrap) return;
    const errorEl = wrap.querySelector('.profile-field-error');
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
    }
    el.classList.remove('field-invalid');
}

function showFieldError(el, text) {
    const wrap = el?.closest('.profile-field');
    if (!wrap) return;
    let errorEl = wrap.querySelector('.profile-field-error');
    if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.className = 'profile-field-error';
        wrap.appendChild(errorEl);
    }
    errorEl.textContent = text;
    errorEl.style.display = 'block';
    el.classList.add('field-invalid');
}

function getModelFieldValue(profileId, field) {
    const profile = getProfileById(profileId);
    if (!profile) return null;
    if (field === 'channel_count') return normalizeChannelCount(profile.channelCount, 1);
    if (field === 'name') return profile.name;
    return profile.modemProfile?.[field];
}

function rollbackControlValue(el, profileId, field) {
    const modelValue = getModelFieldValue(profileId, field);
    if (modelValue == null) return;

    if (el.type === 'checkbox') {
        el.checked = Boolean(modelValue);
    } else {
        el.value = modelValue;
    }

    if (el.type === 'range') {
        const label = el.parentElement?.querySelector('.slider-label');
        if (label) label.textContent = formatSliderLabel(field, modelValue);
    }
}

function renderFramePreview(mp, idSuffix) {
    return `<div class="profile-spectrogram-preview">
        <div class="profile-spectrogram-head">
            <div class="profile-spectrogram-title">Nahlad modulovaneho ramca</div>
            <div class="profile-spectrogram-speed">${getSpeedText(mp)}</div>
        </div>
        <canvas id="profile-spectrogram-${idSuffix}" class="profile-spectrogram-canvas" aria-label="Nahlad ramca"></canvas>
    </div>`;
}

// --- Informacie o profile ---

function getChannelSummaryText(mp) {
    const channelCount = normalizeChannelCount(mp?.channel_count, estimateChannelCountFromModemProfile(mp));
    const channelSize = Number(mp?.channel_size);
    const minTx = Number(mp?.min_tx_freq);
    if (!Number.isFinite(channelSize) || channelSize <= 0 || !Number.isFinite(minTx)) return '-';
    return `${channelCount}x${channelSize} Hz (${minTx} - ${minTx + channelSize} Hz)`;
}

function getSpeedText(mp) {
    const bitsPerSymbol = (Number(mp.bits_per_lane) || 0) * (Number(mp.lanes_per_symbol) || 0);
    const repeats = Math.max(1, Number(mp.symbol_repeats) || 1);
    const bps = (Number(mp.symbol_rate) || 0) * (bitsPerSymbol / repeats);
    if (!Number.isFinite(bps) || bps <= 0) return '-';
    return `${bps.toFixed(2)} b/s`;
}

function renderReadonlyProps(mp, idSuffix) {
    const items = [
        { label: PARAM_LABELS.channel_size, value: `<span data-profile-channel-size-for="${idSuffix}">${getChannelSummaryText(mp)}</span>` },
        { label: SPEED_LABEL, value: `<span data-profile-speed-for="${idSuffix}">${getSpeedText(mp)}</span>` },
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
    const renderMp = Object.create(mp);
    renderMp.channel_count = channelCount ?? mp?.channel_count;

    const csEl = document.querySelector(`[data-profile-channel-size-for="${idSuffix}"]`);
    if (csEl) csEl.textContent = getChannelSummaryText(renderMp);

    const spEl = document.querySelector(`[data-profile-speed-for="${idSuffix}"]`);
    if (spEl) spEl.textContent = getSpeedText(mp);
}

// --- Zdielanie profilu ---

function renderShareRow(mp, idSuffix, readonly) {
    if (readonly) {
        return `<div class="profile-share-row">
            <div class="profile-share-note profile-readonly-note">
                <i class="fas fa-lock"></i>
                <span>${PROFILE_CARD.readonlyNote}</span>
            </div>
        </div>`;
    }
    const profileCode = getModemProfileTLVCode(mp);
    const unchanged = isProfileSameAsDefault(mp);
    return `<div class="profile-share-row">
        <div class="profile-share-actions${unchanged ? ' is-hidden' : ''}" data-profile-share-actions-for="${idSuffix}">
            <button class="share-profile-button" data-action="share-profile" data-profile-id="${idSuffix}">
                <i class="fas fa-share-nodes"></i> Zdieľať profil
            </button>
            <div class="profile-share-code-wrap">
                <input type="text" class="profile-code-input" data-profile-code-for="${idSuffix}" value="${profileCode}"
                    readonly title="Kliknite pre skopírovanie kódu profilu">
                <button class="copy-profile-code-button" data-action="copy-profile-code" data-profile-id="${idSuffix}"
                    title="Skopírovať kód profilu">
                    <i class="fas fa-copy"></i>
                </button>
            </div>
        </div>
        <div class="profile-share-note${unchanged ? '' : ' is-hidden'}" data-profile-share-note-for="${idSuffix}">
            <i class="fas fa-circle-info"></i>
            <span>${PROFILE_CARD.sameAsDefaultNote}</span>
        </div>
    </div>`;
}

export function syncProfileCodeInput(profileId, profileCode) {
    const el = document.querySelector(`[data-profile-code-for="${profileId}"]`);
    if (el) el.value = profileCode;
}

export function updateProfileCodeUI(profileId, mp) {
    const profileCode = getModemProfileTLVCode(mp);
    const unchanged = isProfileSameAsDefault(mp);

    const actions = document.querySelector(`[data-profile-share-actions-for="${profileId}"]`);
    const note = document.querySelector(`[data-profile-share-note-for="${profileId}"]`);
    actions?.classList.toggle('is-hidden', unchanged);
    note?.classList.toggle('is-hidden', !unchanged);
    syncProfileCodeInput(profileId, profileCode);
}

// --- Pole s informaciami o vlne ---

const WAVE_INFO_KEYS = [
    [WAVE_INFO_LABELS.symbolRate, 'symbol-rate', mp => mp.symbol_rate?.toFixed(3) ?? '-'],
    [WAVE_INFO_LABELS.period,     'period',      mp => `${(mp.sample_duration * mp.samples_per_symbol * 1000).toFixed(3)} ms`],
    [WAVE_INFO_LABELS.nyquist,    'nyquist',     mp => `${mp.sample_rate / 2} Hz`],
];

export function updateWaveInfo(profileId, mp) {
    const suffix = profileId === 'default' ? 'default' : String(profileId);
    WAVE_INFO_KEYS.forEach(([, key, fn]) => {
        const el = document.querySelector(`[data-wave-info="${key}${suffix}"]`);
        if (el) el.textContent = fn(mp);
    });
}

// --- Renderovanie poli profilu ---

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
        ${renderReadonlyProps(mp, idSuffix)}
        ${renderFramePreview(mp, idSuffix)}
        ${divider(SECTIONS.basic)}
        ${row(sel('samples_per_symbol', { options: [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192], help: HELP.samples_per_symbol }),
              n('bits_per_lane', { min: 1, max: 32, help: HELP.bits_per_lane }))}
        ${row(
            n('lanes_per_symbol', { min: 1, max: 255, help: HELP.lanes_per_symbol }),
            n('symbol_repeats', { min: 1, max: 255, help: HELP.symbol_repeats })
        )}
        ${row(
            fieldWrap('channel_count', readonly
                ? `<input type="number" value="${normalizeChannelCount(mp?.channel_count)}" disabled>`
                : `<input type="number" value="${normalizeChannelCount(mp?.channel_count)}" data-profile-id="${idSuffix}" data-field="channel_count" min="1" max="${MAX_CHANNEL_COUNT}" step="1">`,
                HELP.channel_count),
            sel('sample_rate', { options: [8000, 44100, 48000], help: HELP.sample_rate })
        )}
        ${divider(SECTIONS.tx)}
        ${s('max_tx_amp', { min: 0, max: 1, step: 0.01, icon: 'fas fa-volume-high',
            help: HELP.max_tx_amp, format: v => parseFloat(v).toFixed(2) })}
        ${renderFreqPicker(pickerProfile, idSuffix, readonly)}
        ${divider(SECTIONS.advanced)}
        <div class="profile-subsection-title">${SECTIONS.markers}</div>
        <div class="section-description">
            ${SECTIONS.markerDesc}
        </div>
        ${row(n('symbols_per_marker', { min: 1, max: 255, help: HELP.symbols_per_marker }),
              n('tones_in_marker',    { min: 1, max: 255, help: HELP.tones_in_marker }))}
        <div class="profile-subsection-title"></div>
        ${s('ecc_percent',    { min: 0, max: 1, step: 0.05, help: HELP.ecc_percent, format: v => `${Math.round(v * 100)} %` })}
        ${s('squelch_thresh', { min: 0, max: 1, step: 0.005, icon: 'fas fa-filter', help: HELP.squelch_thresh, format: v => parseFloat(v).toFixed(3) })}
        <div class="profile-field-row" style="gap:24px;align-items:center;">
            ${t('cphase', HELP.cphase)}
            ${t('dss_enabled', HELP.dss_enabled)}
        </div>`;
}

function profileCardHtml({ id, name, mp, active, readonly = false, isDefault = false }) {
    const suffix = isDefault ? 'default' : id;
    const profileAttr = isDefault ? '' : `data-profile-id="${id}"`;

    const headerLeft = isDefault
        ? `<i id="profile-toggle-default" class="fas fa-chevron-right profile-toggle"></i>
           <span class="profile-name-display">${PROFILE_CARD.defaultName}</span>`
        : readonly
        ? `<i id="profile-toggle-${id}" class="fas fa-chevron-right profile-toggle"></i>
           <span class="profile-id-label" title="ID profilu">#${id}</span>
           <span class="profile-name-display">${name}</span>`
        : `<i id="profile-toggle-${id}" class="fas fa-chevron-right profile-toggle"></i>
           <span class="profile-id-label" title="ID profilu">#${id}</span>
           <input type="text" id="profile-name-input-${id}" class="profile-name-input"
                  value="${name}" data-profile-id="${id}" data-field="name"
                  maxlength="${MAX_PROFILE_NAME}" placeholder="${PROFILE_CARD.namePlaceholder}"
                  onclick="event.stopPropagation()">`;

    const headerRight = `
        <button class="use-profile-button ${active ? 'use-profile-button--active' : ''}"
                data-action="${isDefault ? 'use-default' : 'use-profile'}" ${profileAttr} ${active ? 'disabled' : ''}>
            ${active ? PROFILE_CARD.useActive : PROFILE_CARD.use}
        </button>
        ${!isDefault && !readonly ? `<button class="delete-profile-button" data-profile-id="${id}" data-action="delete">
            <i class="fas fa-times"></i></button>` : ''}`;

    return `
    <div class="profile-item ${isDefault ? 'profile-item--default' : ''} ${active ? 'profile-item--active' : ''}">
        <div class="profile-sticky-sentinel"></div>
        <div class="profile-header" data-action="${isDefault ? 'toggle-default' : 'toggle'}" ${profileAttr}>
            <div class="profile-header-left">${headerLeft}</div>
            <div class="profile-header-right">${headerRight}</div>
        </div>
        <div id="profile-content-${suffix}" class="profile-content">
            <div class="profile-content-inner">
                ${renderProfileFields(mp, suffix, readonly)}
            </div>
        </div>
    </div>`;
}

// --- Pozorovace lepkavej hlavicky ---

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

// --- Vykreslenie ---

export function renderProfiles(container, configTabContent, usbProfileSelector) {
    if (!container) return;

    const profiles = getProfiles();
    const editableCount = profiles.filter(p => !p.readonly).length;
    const defaultMp = TinyTUS.DEFAULT_MODEM_PROFILE;

    const profileItems = profiles.map(p => {
        const renderMp = Object.create(p.modemProfile);
        renderMp.channel_count = p.channelCount;
        return { id: p.id, name: p.name, mp: renderMp, active: isProfileActive(p), readonly: Boolean(p.readonly) };
    });

    const defaultRenderMp = defaultMp ? (() => {
        const renderMp = Object.create(defaultMp);
        renderMp.channel_count = estimateChannelCountFromModemProfile(defaultMp);
        return renderMp;
    })() : null;

    container.innerHTML = [
        ...profileItems.map(item => profileCardHtml(item)),
        defaultRenderMp ? profileCardHtml({ mp: defaultRenderMp, active: isDefaultActive(), readonly: true, isDefault: true }) : '',
        editableCount === 0 ? `<div class="empty-state">${PROFILE_CARD.emptyState}</div>` : '',
    ].join('');

    // Naplnenie USB selektora.
    if (usbProfileSelector) {
        const currentSelection = usbProfileSelector.value;
        usbProfileSelector.innerHTML = `<option value="">${USB_SELECTOR.keepCurrent}</option>`;
        const defaultOpt = document.createElement('option');
        defaultOpt.value = 'default';
        defaultOpt.textContent = USB_SELECTOR.defaultProfile;
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

// --- UI aktivneho profilu ---

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
        btn.innerHTML = active ? PROFILE_CARD.useActive : PROFILE_CARD.use;
    });
}

// --- Rozbalenie profilu ---

export function toggleProfile(id, onOpened) {
    const content = $(`profile-content-${id}`);
    const toggle  = $(`profile-toggle-${id}`);
    if (!content) return;
    const opening = !content.classList.contains('expanded');
    content.classList.toggle('expanded');
    toggle?.classList.toggle('expanded');
    if (opening && onOpened) onOpened(id);
}

// --- Kopirovanie kodu profilu ---

async function copyProfileCode(profileId, btn) {
    const codeInput = document.querySelector(`[data-profile-code-for="${profileId}"]`);
    const code = codeInput?.value;
    if (!code) return;
    try { await navigator.clipboard.writeText(code); } catch {
        if (codeInput) { codeInput.focus({ preventScroll: true }); codeInput.select(); }
    }
    if (btn) {
        btn.classList.add('copied');
        setTimeout(() => btn?.classList.remove('copied'), 1200);
    }
}

// --- Delegacia eventov ---

export function initContainerEvents(container, callbacks) {
    container?.addEventListener('click', async e => {
        const btn = action => e.target.closest(`[data-action="${action}"]`);

        if (btn('copy-profile-code')) {
            e.stopPropagation();
            const copyBtn = btn('copy-profile-code');
            const id = parseInt(copyBtn.dataset.profileId, 10);
            if (!Number.isNaN(id)) await copyProfileCode(id, copyBtn);
            return;
        }
        const inlineCodeInput = e.target.closest('.profile-code-input[data-profile-code-for]');
        if (inlineCodeInput) {
            e.stopPropagation();
            inlineCodeInput.focus({ preventScroll: true });
            inlineCodeInput.select();
            return;
        }
        if (btn('share-profile')) {
            e.stopPropagation();
            const id = parseInt(btn('share-profile').dataset.profileId);
            if (!Number.isNaN(id)) callbacks.shareProfile(id);
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
            if (p) setActiveProfile(p.modemProfile);
            return;
        }
        if (btn('use-default')) {
            e.stopPropagation();
            setActiveProfile(TinyTUS.DEFAULT_MODEM_PROFILE);
            return;
        }
        if (btn('toggle-default')) return toggleProfile('default', callbacks.onProfileOpened);
        if (btn('toggle')) return toggleProfile(parseInt(btn('toggle').dataset.profileId), callbacks.onProfileOpened);
    });

    container?.addEventListener('change', e => {
        const { profileId, field, type } = e.target.dataset;
        if (!profileId || !field) return;

        const id = parseInt(profileId);
        const value = type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value;

        if (e.target.type === 'number' && !e.target.validity.valid) {
            showFieldError(e.target, 'Neplatna hodnota.');
            rollbackControlValue(e.target, id, field);
            return;
        }

        const pre = preValidateFieldValue(field, value);
        if (!pre.valid) {
            showFieldError(e.target, pre.error || 'Neplatna hodnota.');
            rollbackControlValue(e.target, id, field);
            return;
        }

        if (updateProfileField(id, field, value)) {
            clearFieldError(e.target);
            callbacks.onFieldChanged(id, field);
            return;
        }

        showFieldError(e.target, 'Neplatna kombinacia parametrov pre tento profil.');
        rollbackControlValue(e.target, id, field);
    });

    container?.addEventListener('input', e => {
        if (e.target?.dataset?.field) clearFieldError(e.target);

        if (e.target.type === 'range' && e.target.dataset?.field) {
            const label = e.target.parentElement?.querySelector('.slider-label');
            if (label) label.textContent = formatSliderLabel(e.target.dataset.field, e.target.value);
        }

        if (e.target.classList.contains('profile-name-input')) {
            const { profileId, field } = e.target.dataset;
            if (profileId && field === 'name') {
                updateProfileField(parseInt(profileId), 'name', e.target.value);
            }
        }
    });
}
