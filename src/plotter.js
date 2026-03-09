/**
 * Vykreslovanie waveformu a spektra.
 */

/**
 * Pomocne funkcie pre high-DPI canvas.
 */
class CanvasRenderer {
    static MAX_CANVAS_SIZE = 16384; // Bezpecny limit pre vacsinu prehliadacov.

    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.setupHighDPI();
    }

    setupHighDPI() {
        const dpr = window.devicePixelRatio || 1;

        // Pouzi clientWidth/clientHeight, su spolahlivejsie.
        const displayWidth = this.canvas.clientWidth || this.canvas.width || 600;
        const displayHeight = this.canvas.clientHeight || this.canvas.height || 400;

        // Vypocitaj skalovane rozmery s limitom.
        let scaledWidth = Math.floor(displayWidth * dpr);
        let scaledHeight = Math.floor(displayHeight * dpr);

        // Orez na maximalnu bezpecnu velkost canvasu.
        scaledWidth = Math.min(scaledWidth, CanvasRenderer.MAX_CANVAS_SIZE);
        scaledHeight = Math.min(scaledHeight, CanvasRenderer.MAX_CANVAS_SIZE);

        // Aktualizuj len pri realnej zmene rozmeru.
        if (this.canvas.width !== scaledWidth || this.canvas.height !== scaledHeight) {
            this.canvas.width = scaledWidth;
            this.canvas.height = scaledHeight;
        }

        // Vypocitaj realny DPI pomer po oreze.
        const actualDprX = scaledWidth / displayWidth;
        const actualDprY = scaledHeight / displayHeight;

        this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transformacie.
        this.ctx.scale(actualDprX, actualDprY);
        this.ctx.imageSmoothingEnabled = false;

        this.displayWidth = displayWidth;
        this.displayHeight = displayHeight;
    }

    clear() {
        this.ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);
    }
}

/**
 * Kreslenie waveformu.
 */
export function plotWaveform(canvas, waveform, frequency = null) {
    // Cache rendereru, vytvor znova len pri zmene velkosti.
    if (!canvas._renderer || canvas.clientWidth !== canvas._lastWidth || canvas.clientHeight !== canvas._lastHeight) {
        canvas._renderer = new CanvasRenderer(canvas);
        canvas._lastWidth = canvas.clientWidth;
        canvas._lastHeight = canvas.clientHeight;
    }

    const { ctx, displayWidth, displayHeight } = canvas._renderer;
    canvas._renderer.clear();

    const centerY = displayHeight / 2;
    const bufferLength = waveform.length;
    const stepX = displayWidth / bufferLength;

    // Kresli waveform.
    ctx.beginPath();
    ctx.lineWidth = 2;

    for (let i = 0; i < bufferLength; i++) {
        const x = i * stepX;
        const y = centerY + (waveform[i] * centerY);

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    // Farba podla frekvencie, ak je zadana.
    const color = frequency
        ? `hsl(${Math.min(frequency / 100, 360)}, 100%, 50%)`
        : 'rgb(35, 132, 242)';

    ctx.strokeStyle = color;
    ctx.stroke();
}

/**
 * Stlpcovy graf spektra.
 */
export function drawFFT(canvas, frequencies, magnitudes) {
    // Cache rendereru, vytvor znova len pri zmene velkosti.
    if (!canvas._renderer || canvas.clientWidth !== canvas._lastWidth || canvas.clientHeight !== canvas._lastHeight) {
        canvas._renderer = new CanvasRenderer(canvas);
        canvas._lastWidth = canvas.clientWidth;
        canvas._lastHeight = canvas.clientHeight;
    }

    const { ctx, displayWidth, displayHeight } = canvas._renderer;
    canvas._renderer.clear();

    const barWidth = displayWidth / frequencies.length;
    const maxMagnitude = Math.max(...magnitudes, 1);

    for (let i = 0; i < frequencies.length; i++) {
        const normalizedHeight = magnitudes[i] / maxMagnitude;
        const barHeight = normalizedHeight * displayHeight;

        // Farebny gradient podla amplitudy.
        const hue = 240 - (normalizedHeight * 180); // Modra po cervenu.
        ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;

        const x = i * barWidth;
        const y = displayHeight - barHeight;

        ctx.fillRect(x, y, barWidth - 1, barHeight);
    }
}

/**
 * Waterfall spektrogram.
 */
export function plotFFTWaterfall(canvas, frequencies, magnitudes, options = {}) {
    const {
        magnitudeScaling = 'log',
        noiseFloor = 0.005,
        colormap = 'viridis'
    } = options;

    // Inicializuj renderer, resize len ked treba.
    if (!canvas._renderer || canvas.clientWidth !== canvas._lastWidth || canvas.clientHeight !== canvas._lastHeight) {
        canvas._renderer = new CanvasRenderer(canvas);
        canvas._lastWidth = canvas.clientWidth;
        canvas._lastHeight = canvas.clientHeight;

        // Pri resize resetni waterfall data.
        canvas.waterfallData = [];
    }

    const { ctx, displayWidth, displayHeight } = canvas._renderer;

    // Inicializuj historiu waterfallu.
    if (!canvas.waterfallData) {
        canvas.waterfallData = [];
    }

    const maxRows = Math.floor(displayHeight);
    const binWidth = displayWidth / frequencies.length;

    // Skaluj amplitudy.
    const scaledMagnitudes = scaleMagnitudes(magnitudes, magnitudeScaling, noiseFloor);

    // Pridaj novy riadok dat.
    canvas.waterfallData.push(scaledMagnitudes);
    if (canvas.waterfallData.length > maxRows) {
        canvas.waterfallData.shift();
    }

    // Vykresli waterfall.
    canvas._renderer.clear();
    renderWaterfall(ctx, canvas.waterfallData, { binWidth, displayHeight }, colormap);
}

/**
 * Skalovanie amplitud pre vykreslenie.
 */
function scaleMagnitudes(magnitudes, scaling, noiseFloor) {
    return magnitudes.map(mag => {
        let scaled = mag;

        if (scaling === 'log') {
            const logValue = Math.log10(Math.max(mag, noiseFloor));
            const logFloor = Math.log10(noiseFloor);
            scaled = (logValue - logFloor) / -logFloor;
        } else {
            // Linearne skalovanie.
            const maxMag = Math.max(...magnitudes, 1);
            scaled = mag / maxMag;
        }

        return Math.max(0, Math.min(1, scaled));
    });
}

/**
 * Vykreslenie waterfallu.
 */
function renderWaterfall(ctx, waterfallData, config, colormap) {
    const { binWidth, displayHeight } = config;
    const numRows = waterfallData.length;

    if (numRows === 0) return;

    // Vypocitaj vysku riadku pre celu plochu.
    const rowHeight = displayHeight / numRows;

    waterfallData.forEach((row, rowIndex) => {
        const y = rowIndex * rowHeight;

        row.forEach((magnitude, binIndex) => {
            const x = binIndex * binWidth;

            ctx.fillStyle = getColor(magnitude, colormap);
            ctx.fillRect(x, y, Math.max(binWidth, 1), Math.max(rowHeight, 1));
        });
    });
}

/**
 * Funkcie mapovania farieb.
 */
function getColor(value, colormap) {
    switch (colormap) {
        case 'viridis':
            return viridisColormap(value);
        case 'hot':
            return hotColormap(value);
        case 'cool':
            return coolColormap(value);
        default:
            return viridisColormap(value);
    }
}

function viridisColormap(value) {
    // Zjednodusena viridis mapa.
    const r = Math.round(255 * Math.pow(value, 3));
    const g = Math.round(255 * value);
    const b = Math.round(255 * Math.sqrt(1 - value));
    return `rgb(${r}, ${g}, ${b})`;
}

function hotColormap(value) {
    // Cierna -> cervena -> zlta -> biela.
    const r = Math.round(255 * Math.min(value * 3, 1));
    const g = Math.round(255 * Math.max(0, Math.min((value - 0.33) * 3, 1)));
    const b = Math.round(255 * Math.max(0, (value - 0.66) * 3));
    return `rgb(${r}, ${g}, ${b})`;
}

function coolColormap(value) {
    // Cyan -> modra -> magenta.
    const r = Math.round(255 * value);
    const g = Math.round(255 * (1 - value));
    const b = 255;
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Legacy funkcia cez Chart.js pre kompatibilitu.
 * Poznamka: vyzaduje Chart.js.
 */
export function plotFFT(canvas, frequencies, magnitudes) {
    console.warn('plotFFT with Chart.js is deprecated. Use drawFFT or plotFFTWaterfall instead.');

    if (!window.Chart) {
        console.error('Chart.js not available');
        return;
    }

    const ctx = canvas.getContext('2d');

    if (canvas.chart) {
        canvas.chart.data.labels = frequencies.map(f => f.toFixed(0));
        canvas.chart.data.datasets[0].data = magnitudes;
        canvas.chart.update({ duration: 0 });
        return;
    }

    canvas.chart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: frequencies.map(f => f.toFixed(0)),
            datasets: [{
                label: 'FFT Magnitude',
                data: magnitudes,
                backgroundColor: 'rgba(255, 0, 0, 0.8)',
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Frequency [Hz]' }
                },
                y: {
                    title: { display: true, text: 'Magnitude' },
                    min: 0
                }
            }
        }
    });
}
