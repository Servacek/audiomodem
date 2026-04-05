// Rychly nahlad ramca iba z parametrov profilu.

const PREVIEW_PAYLOAD = new Uint8Array([0x48, 0x4f, 0x4c, 0x55, 0x42, 0xaa, 0x55, 0x3c]);

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

function ceilDiv(a, b) {
    return Math.floor((a + b - 1) / b);
}

function estimateSectionSymbols(bits, bitsPerSymbol) {
    if (bits <= 0 || bitsPerSymbol <= 0) return 0;
    return ceilDiv(bits, bitsPerSymbol);
}

function bitAtFromPayload(payload, bitIndex) {
    const byte = payload[Math.floor(bitIndex / 8)] ?? 0;
    const inByte = 7 - (bitIndex % 8);
    return (byte >> inByte) & 1;
}

function bitAtFromEcc(payload, bitIndex) {
    // Pseudo parity stream pre stabilny a citatelny ECC blok.
    let acc = 0;
    for (let i = 0; i < payload.length; i++) {
        const v = payload[i];
        acc ^= (v << (i % 5)) | (v >>> (8 - (i % 5)));
    }
    return (acc >> (bitIndex % 8)) & 1;
}

function buildLaneLayout(mp, laneCount, statesPerLane) {
    const minTx = Math.max(0, Number(mp?.min_tx_freq) || 0);
    const maxTxRaw = Number(mp?.max_tx_freq);
    const freqBinHz = Math.max(1, Number(mp?.freq_bin_hz) || 1);
    const fallbackMax = minTx + Math.max(128, laneCount * statesPerLane) * freqBinHz;
    const maxTx = Number.isFinite(maxTxRaw) ? Math.max(minTx + freqBinHz, maxTxRaw) : fallbackMax;

    const totalBins = Math.max(8, Math.floor((maxTx - minTx) / freqBinHz));
    const laneBandBins = Math.max(1, Math.floor(totalBins / laneCount));
    const binsPerLane = Math.max(1, Math.min(statesPerLane, laneBandBins));
    const laneBaseBins = new Int32Array(laneCount);

    for (let lane = 0; lane < laneCount; lane++) {
        const laneBandStart = lane * laneBandBins;
        const centeredOffset = Math.max(0, Math.floor((laneBandBins - binsPerLane) / 2));
        laneBaseBins[lane] = laneBandStart + centeredOffset;
    }

    return {
        minTx,
        maxTx,
        freqBinHz,
        totalBins,
        binsPerLane,
        laneBaseBins,
    };
}

function markerToneForLane(lane, laneCount, binsPerLane) {
    if (binsPerLane <= 1) return 0;
    const spread = Math.max(1, binsPerLane - 1);
    return Math.floor((lane / Math.max(1, laneCount - 1)) * spread);
}

function buildPreviewFrame(mp) {
    const laneCount = clampInt(mp?.lanes_per_symbol, 1, 32, 1);
    const symbolRepeats = clampInt(mp?.symbol_repeats, 1, 64, 1);
    const bitsPerTone = clampInt(mp?.bits_per_lane, 1, 12, 1);
    const bitsPerSymbol = laneCount * bitsPerTone;
    const statesPerLane = 2 ** bitsPerTone;

    const symbolsPerMarker = clampInt(mp?.symbols_per_marker, 1, 2048, 8);
    const tonesInMarker = clampInt(mp?.tones_in_marker, 1, 4096, 16);
    const eccPercent = Math.max(0, Math.min(1, Number(mp?.ecc_percent) || 0));

    const payloadBits = PREVIEW_PAYLOAD.length * 8;
    const eccBits = Math.round(payloadBits * eccPercent);

    const markerSymbols = symbolsPerMarker * symbolRepeats;
    const dataSymbols = estimateSectionSymbols(payloadBits, bitsPerSymbol) * symbolRepeats;
    const eccSymbols = Math.max(1, estimateSectionSymbols(eccBits, bitsPerSymbol)) * symbolRepeats;
    const symbolCount = Math.max(1, markerSymbols + dataSymbols + eccSymbols + markerSymbols);

    const laneLayout = buildLaneLayout(mp, laneCount, statesPerLane);

    const laneToneIndex = Array.from({ length: laneCount }, () => new Uint16Array(symbolCount));
    const laneToneBin = Array.from({ length: laneCount }, () => new Uint16Array(symbolCount));
    const symbolTypes = new Uint8Array(symbolCount);

    const markerStartEnd = markerSymbols;
    const dataStart = markerStartEnd;
    const dataEnd = dataStart + dataSymbols;
    const eccEnd = dataEnd + eccSymbols;

    for (let symbol = 0; symbol < symbolCount; symbol++) {
        let section = 0;
        if (symbol < markerStartEnd || symbol >= eccEnd) section = 1;
        else if (symbol >= dataEnd) section = 3;
        else section = 2;
        symbolTypes[symbol] = section;

        for (let lane = 0; lane < laneCount; lane++) {
            let value = 0;

            if (section === 1) {
                value = markerToneForLane(lane, laneCount, laneLayout.binsPerLane);
            } else {
                const sectionSymbolIndex = section === 2
                    ? Math.floor((symbol - dataStart) / symbolRepeats)
                    : Math.floor((symbol - dataEnd) / symbolRepeats);
                const baseBit = sectionSymbolIndex * bitsPerSymbol + lane * bitsPerTone;

                for (let b = 0; b < bitsPerTone; b++) {
                    const bitPos = baseBit + b;
                    let bit = 0;

                    if (section === 2) {
                        bit = bitAtFromPayload(PREVIEW_PAYLOAD, bitPos);
                    } else {
                        bit = bitAtFromEcc(PREVIEW_PAYLOAD, bitPos);
                    }

                    value = (value << 1) | bit;
                }
            }

            laneToneIndex[lane][symbol] = value % statesPerLane;
            laneToneBin[lane][symbol] = laneLayout.laneBaseBins[lane] + (laneToneIndex[lane][symbol] % laneLayout.binsPerLane);
        }
    }

    return {
        laneCount,
        bitsPerTone,
        statesPerLane,
        symbolCount,
        markerSymbols,
        dataSymbols,
        eccSymbols,
        symbolTypes,
        laneToneIndex,
        laneToneBin,
        minTx: laneLayout.minTx,
        maxTx: laneLayout.maxTx,
        freqBinHz: laneLayout.freqBinHz,
        totalBins: laneLayout.totalBins,
    };
}

function toneColor(section) {
    if (section === 1) return 'hsl(32 88% 58%)';
    if (section === 3) return 'hsl(306 76% 58%)';
    return 'hsl(202 84% 58%)';
}

function drawSectionLabel(ctx, text, x, y, w) {
    if (w < 32) return;
    ctx.fillStyle = 'rgba(222, 230, 238, 0.84)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textBaseline = 'middle';
    const tx = x + Math.max(4, (w - ctx.measureText(text).width) / 2);
    ctx.fillText(text, tx, y);
}

function drawFramePreview(canvas, preview, mp) {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(260, Math.floor(rect.width || 560));
    const cssH = Math.max(110, Math.floor(rect.height || 140));
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const {
        laneCount,
        symbolCount,
        markerSymbols,
        dataSymbols,
        eccSymbols,
        symbolTypes,
        laneToneBin,
        minTx,
        maxTx,
        freqBinHz,
        totalBins,
    } = preview;

    const topPad = 18;
    const leftPad = 8;
    const rightPad = 8;
    const bottomPad = 8;

    const plotX = leftPad;
    const plotY = topPad;
    const plotW = Math.max(10, cssW - leftPad - rightPad);
    const plotH = Math.max(10, cssH - topPad - bottomPad);
    const cellW = plotW / symbolCount;
    const binH = plotH / totalBins;

    ctx.fillStyle = 'rgba(14, 20, 28, 0.92)';
    ctx.fillRect(0, 0, cssW, cssH);

    const markerStartW = markerSymbols * cellW;
    const dataW = dataSymbols * cellW;
    const eccW = eccSymbols * cellW;
    const markerEndX = plotX + markerStartW + dataW + eccW;

    ctx.fillStyle = 'rgba(255, 168, 48, 0.10)';
    ctx.fillRect(plotX, plotY, markerStartW, plotH);
    ctx.fillRect(markerEndX, plotY, markerStartW, plotH);

    ctx.fillStyle = 'rgba(64, 164, 255, 0.08)';
    ctx.fillRect(plotX + markerStartW, plotY, dataW, plotH);
    ctx.fillStyle = 'rgba(224, 90, 205, 0.08)';
    ctx.fillRect(plotX + markerStartW + dataW, plotY, eccW, plotH);

    const markerLineEndX = plotX + markerStartW - cellW * 0.5;
    const squareSize = Math.max(4, Math.min(12, Math.min(cellW * 0.92, binH * 0.92)));

    for (let lane = 0; lane < laneCount; lane++) {
        const markerBin = laneToneBin[lane][0];
        const y = plotY + plotH - (markerBin + 0.5) * binH;

        if (markerSymbols > 0) {
            ctx.strokeStyle = 'rgba(255, 170, 64, 0.46)';
            ctx.lineWidth = Math.max(0.75, squareSize * 0.16);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(plotX + cellW * 0.5, y);
            ctx.lineTo(Math.max(plotX + cellW * 0.5, markerLineEndX), y);
            ctx.stroke();
        }

        for (let symbol = markerSymbols; symbol < symbolCount - markerSymbols; symbol++) {
            const section = symbolTypes[symbol];
            const x = plotX + symbol * cellW + cellW * 0.5;
            const bin = laneToneBin[lane][symbol];
            const py = plotY + plotH - (bin + 0.5) * binH;

            ctx.fillStyle = toneColor(section);
            ctx.fillRect(x - squareSize / 2, py - squareSize / 2, squareSize, squareSize);
            ctx.strokeStyle = 'rgba(6, 10, 14, 0.7)';
            ctx.lineWidth = 0.8;
            ctx.strokeRect(x - squareSize / 2, py - squareSize / 2, squareSize, squareSize);
        }

        if (markerSymbols > 0) {
            const tailStartSymbol = symbolCount - markerSymbols;
            const tailStartX = plotX + tailStartSymbol * cellW + cellW * 0.5;
            const tailEndX = plotX + plotW - cellW * 0.5;
            ctx.strokeStyle = 'rgba(255, 170, 64, 0.42)';
            ctx.lineWidth = Math.max(0.75, squareSize * 0.14);
            ctx.beginPath();
            ctx.moveTo(tailStartX, y);
            ctx.lineTo(Math.max(tailStartX, tailEndX), y);
            ctx.stroke();
        }
    }

    ctx.lineCap = 'butt';

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
    ctx.lineWidth = 1;
    const yGridStep = Math.max(1, Math.ceil(totalBins / 6));
    for (let b = yGridStep; b < totalBins; b += yGridStep) {
        const y = plotY + plotH - b * binH + 0.5;
        ctx.beginPath();
        ctx.moveTo(plotX, y);
        ctx.lineTo(plotX + plotW, y);
        ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
    for (let symbol = 1; symbol < symbolCount; symbol++) {
        const x = plotX + symbol * cellW + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, plotY);
        ctx.lineTo(x, plotY + plotH);
        ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    const splitA = plotX + markerStartW + 0.5;
    const splitB = plotX + markerStartW + dataW + 0.5;
    const splitC = markerEndX + 0.5;
    ctx.beginPath();
    ctx.moveTo(splitA, plotY);
    ctx.lineTo(splitA, plotY + plotH);
    ctx.moveTo(splitB, plotY);
    ctx.lineTo(splitB, plotY + plotH);
    ctx.moveTo(splitC, plotY);
    ctx.lineTo(splitC, plotY + plotH);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(67, 196, 126, 0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(plotX + 0.5, plotY);
    ctx.lineTo(plotX + 0.5, plotY + plotH);
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.strokeRect(plotX + 0.5, plotY + 0.5, plotW - 1, plotH - 1);

    drawSectionLabel(ctx, 'MARKER', plotX, 9, markerStartW);
    drawSectionLabel(ctx, 'PAYLOAD', plotX + markerStartW, 9, dataW);
    drawSectionLabel(ctx, 'ECC', plotX + markerStartW + dataW, 9, eccW);
    drawSectionLabel(ctx, 'MARKER', markerEndX, 9, markerStartW);

    const minHz = Math.round(minTx);
    const maxHz = Math.round(maxTx);
    const spanBins = Math.max(1, totalBins - 1);
    const midHz = Math.round(minTx + freqBinHz * Math.floor(spanBins / 2));

    ctx.fillStyle = 'rgba(220, 230, 240, 0.72)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${minHz} Hz`, plotX + 4, cssH - 4);
    const maxTxt = `${maxHz} Hz`;
    ctx.fillText(maxTxt, plotX + plotW - ctx.measureText(maxTxt).width - 4, cssH - 4);

    const midTxt = `${midHz} Hz`;
    ctx.fillText(midTxt, plotX + (plotW - ctx.measureText(midTxt).width) / 2, cssH - 4);
}

export function updateProfileSpectrogram(_TinyTUS, profileId, mp) {
    const idSuffix = profileId === 'default' ? 'default' : String(profileId);
    const canvas = document.getElementById(`profile-spectrogram-${idSuffix}`);
    if (!canvas || !mp) return;

    try {
        const preview = buildPreviewFrame(mp);
        drawFramePreview(canvas, preview, mp);
    } catch {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(260, Math.floor(rect.width || 560));
        const h = Math.max(110, Math.floor(rect.height || 140));
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(14, 20, 28, 0.92)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.fillText('Nahlad ramca nie je dostupny', 12, 22);
    }
}
