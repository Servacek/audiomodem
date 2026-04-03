// Modal pre zdielanie profilu - zobrazuje QR kod a TLV kod profilu.

const $ = id => document.getElementById(id);

const modal        = $('share-profile-modal');
const titleEl      = $('share-profile-modal-title');
const subtitleEl   = $('share-profile-modal-subtitle');
const qrEl         = $('share-profile-modal-qr');
const codeInput    = $('share-profile-modal-code');
const copyButton   = $('share-profile-modal-copy');
const cancelButton = $('share-profile-modal-cancel');
const broadcastBtn = $('share-profile-modal-broadcast');

let currentCode = '';
let onBroadcast = null;

// --- QR generovanie ---

function generateQRSvg(code) {
    if (!code || typeof qrcode === 'undefined') return '';
    try {
        const qr = qrcode(0, 'M');
        qr.addData(code, 'Byte');
        qr.make();
        return qr.createSvgTag({ scalable: true });
    } catch {
        return '';
    }
}

// --- Kopirovanie ---

async function copyCurrentCode() {
    if (!currentCode || !copyButton) return;
    const originalTitle = copyButton.title;
    const originalLabel = copyButton.getAttribute('aria-label') || originalTitle;

    try {
        await navigator.clipboard.writeText(currentCode);
    } catch {
        if (codeInput) { codeInput.focus({ preventScroll: true }); codeInput.select(); }
    }

    copyButton.classList.add('copied');
    copyButton.title = 'Skopírované';
    copyButton.setAttribute('aria-label', 'Skopírované');

    setTimeout(() => {
        if (!copyButton) return;
        copyButton.classList.remove('copied');
        copyButton.title = originalTitle;
        copyButton.setAttribute('aria-label', originalLabel);
    }, 1200);
}

// --- Otvorenie / zatvorenie ---

export function openShareModal(profileName, code) {
    if (!modal) return;
    currentCode = code || '';
    if (titleEl) titleEl.textContent = 'Zdieľať profil';
    if (subtitleEl) subtitleEl.textContent = profileName ? `Profil: ${profileName}` : 'Naskenujte QR alebo skopírujte kód profilu.';
    if (codeInput) codeInput.value = currentCode;
    if (qrEl) {
        const qrSvg = generateQRSvg(currentCode);
        qrEl.innerHTML = qrSvg || '<div class="share-modal-qr-empty">QR náhľad nie je dostupný.</div>';
    }
    if (broadcastBtn) broadcastBtn.disabled = !currentCode;
    modal.style.display = 'flex';
}

export function closeShareModal() {
    if (modal) modal.style.display = 'none';
    currentCode = '';
}

// --- Init ---

export function initShareModal(broadcastCallback) {
    onBroadcast = broadcastCallback;

    cancelButton?.addEventListener('click', closeShareModal);
    modal?.addEventListener('click', e => { if (e.target === modal) closeShareModal(); });
    copyButton?.addEventListener('click', copyCurrentCode);
    codeInput?.addEventListener('click', () => { codeInput.focus({ preventScroll: true }); codeInput.select(); });

    broadcastBtn?.addEventListener('click', () => {
        if (currentCode) onBroadcast?.(currentCode);
        closeShareModal();
    });
}
