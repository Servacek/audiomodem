// FFT vypocet a vykreslenie spektrogramu nahladu profilu.

// Cache FFT planov podla velkosti.
const fftPlanCache = new Map();

function nextPow2(v) {
    let n = 1;
    while (n < v) n <<= 1;
    return n;
}

function getFftPlan(fftSize) {
    if (fftPlanCache.has(fftSize)) return fftPlanCache.get(fftSize);

    const bitRev = new Uint32Array(fftSize);
    const bits = Math.log2(fftSize);
    for (let i = 0; i < fftSize; i++) {
        let x = i, y = 0;
        for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; }
        bitRev[i] = y;
    }

    const win = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
        win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
    }

    const plan = { bitRev, win };
    fftPlanCache.set(fftSize, plan);
    return plan;
}

function runFft(re, im) {
    const n = re.length;
    for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1;
        const ang = (-2 * Math.PI) / len;
        const wLenRe = Math.cos(ang);
        const wLenIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let wRe = 1, wIm = 0;
            for (let j = 0; j < half; j++) {
                const a = i + j, b = a + half;
                const uRe = re[a], uIm = im[a];
                const vRe = re[b] * wRe - im[b] * wIm;
                const vIm = re[b] * wIm + im[b] * wRe;
                re[a] = uRe + vRe; im[a] = uIm + vIm;
                re[b] = uRe - vRe; im[b] = uIm - vIm;
                const nwRe = wRe * wLenRe - wIm * wLenIm;
                wIm = wRe * wLenIm + wIm * wLenRe;
                wRe = nwRe;
            }
        }
    }
}

function getSpectrogramParams(sampleRate, mp) {
    const sr = Math.max(8000, Number(sampleRate) || 48000);
    const minTx = Number(mp?.min_tx_freq) || 800;
    const maxTx = Number(mp?.max_tx_freq) || Math.min(sr / 2 - 1, minTx + 1200);
    const span = Math.max(200, maxTx - minTx);
    const targetBinHz = Math.max(4, Math.min(14, span / 120));
    let fftSize = nextPow2(Math.round(sr / targetBinHz));
    fftSize = Math.max(2048, Math.min(8192, fftSize));
    return { fftSize, hopSize: Math.max(64, fftSize >> 4) };
}

function computeFrames(signal, sampleRate, mp) {
    const { fftSize, hopSize } = getSpectrogramParams(sampleRate, mp);
    if (!signal || signal.length < fftSize) return null;

    const bins = fftSize >> 1;
    const rawCount = Math.max(1, Math.floor((signal.length - fftSize) / hopSize) + 1);
    const maxFrames = 220;
    const step = Math.max(1, Math.ceil(rawCount / maxFrames));
    const frameCount = Math.ceil(rawCount / step);
    const frames = new Array(frameCount);

    const { bitRev, win } = getFftPlan(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);

    for (let out = 0, f = 0; f < rawCount; f += step, out++) {
        const start = f * hopSize;
        for (let i = 0; i < fftSize; i++) {
            const src = start + i;
            re[bitRev[i]] = (src < signal.length ? signal[src] : 0) * win[i];
            im[bitRev[i]] = 0;
        }
        runFft(re, im);
        const mags = new Float32Array(bins);
        for (let k = 0; k < bins; k++) mags[k] = Math.hypot(re[k], im[k]);
        frames[out] = mags;
    }

    return { frames, sampleRate, fftSize };
}

function drawSpectrogram(canvas, spec, mp) {
    if (!canvas || !spec?.frames?.length) return;

    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(240, Math.floor(rect.width || 560));
    const cssH = Math.max(96, Math.floor(rect.height || 140));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const { frames, sampleRate, fftSize } = spec;
    const nyquist = sampleRate / 2;
    const minFreq = Math.max(0, Number(mp.min_tx_freq || 0) - 120);
    const maxFreq = Math.min(nyquist, Number(mp.max_tx_freq || 0) + 120);
    const minBin = Math.max(0, Math.floor((minFreq / nyquist) * (fftSize / 2)));
    const maxBin = Math.max(minBin + 1, Math.min((fftSize / 2) - 1, Math.ceil((maxFreq / nyquist) * (fftSize / 2))));
    const binCount = maxBin - minBin + 1;

    // Vypocitaj dynamicky rozsah decibel.
    const dbValues = [];
    for (let r = 0; r < frames.length; r++) {
        for (let b = minBin; b <= maxBin; b++) {
            dbValues.push(20 * Math.log10(frames[r][b] + 1e-12));
        }
    }
    dbValues.sort((a, b) => a - b);
    const lowDb  = dbValues[Math.floor(dbValues.length * 0.10)] ?? -120;
    const highDb = Math.max(lowDb + 1, dbValues[Math.floor(dbValues.length * 0.995)] ?? -10);

    ctx.fillStyle = 'rgba(14, 20, 28, 0.92)';
    ctx.fillRect(0, 0, cssW, cssH);

    const xScale = cssW / binCount;
    const yScale = cssH / frames.length;
    for (let r = 0; r < frames.length; r++) {
        for (let b = 0; b < binCount; b++) {
            const db = 20 * Math.log10(frames[r][minBin + b] + 1e-12);
            const norm = Math.min(1, Math.max(0, (db - lowDb) / (highDb - lowDb)));
            ctx.fillStyle = norm >= 0.9 ? 'hsl(40 78% 77%)' : 'hsl(215 78% 10%)';
            ctx.fillRect(b * xScale, r * yScale, Math.ceil(xScale), Math.ceil(yScale));
        }
    }

    // Znamc frekvencie vysielania.
    if (Number(mp.min_tx_freq) > 0 && Number(mp.max_tx_freq) > Number(mp.min_tx_freq)) {
        const span = maxFreq - minFreq;
        const minX = ((Number(mp.min_tx_freq) - minFreq) / span) * cssW;
        const maxX = ((Number(mp.max_tx_freq) - minFreq) / span) * cssW;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(minX + 0.5, 0); ctx.lineTo(minX + 0.5, cssH);
        ctx.moveTo(maxX + 0.5, 0); ctx.lineTo(maxX + 0.5, cssH);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, cssW - 1, cssH - 1);
}

// --- Verejne API ---

export function updateProfileSpectrogram(TinyTUS, profileId, mp) {
    const idSuffix = profileId === 'default' ? 'default' : String(profileId);
    const canvas = document.getElementById(`profile-spectrogram-${idSuffix}`);
    if (!canvas || !TinyTUS.modulateMessage) return;

    try {
        const waveform = TinyTUS.modulateMessage('test', mp);
        const spec = computeFrames(waveform, Number(mp.sample_rate) || 48000, mp);
        drawSpectrogram(canvas, spec, mp);
    } catch {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(14, 20, 28, 0.92)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.fillText('Nahlad nie je dostupny', 12, 22);
    }
}
