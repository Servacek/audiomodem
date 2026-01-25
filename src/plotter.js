/**
 * Audio Visualization Plotter
 * Provides functions for rendering waveforms and frequency spectra
 */

/**
 * Canvas utilities for high-DPI rendering
 */
class CanvasRenderer {
    static MAX_CANVAS_SIZE = 16384; // Safe limit for most browsers

    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.setupHighDPI();
    }

    setupHighDPI() {
        const dpr = window.devicePixelRatio || 1;

        // Use clientWidth/clientHeight which are more reliable
        const displayWidth = this.canvas.clientWidth || this.canvas.width || 600;
        const displayHeight = this.canvas.clientHeight || this.canvas.height || 400;

        // Calculate scaled dimensions with safety limits
        let scaledWidth = Math.floor(displayWidth * dpr);
        let scaledHeight = Math.floor(displayHeight * dpr);

        // Clamp to maximum safe canvas size
        scaledWidth = Math.min(scaledWidth, CanvasRenderer.MAX_CANVAS_SIZE);
        scaledHeight = Math.min(scaledHeight, CanvasRenderer.MAX_CANVAS_SIZE);

        // Only update if dimensions actually changed
        if (this.canvas.width !== scaledWidth || this.canvas.height !== scaledHeight) {
            this.canvas.width = scaledWidth;
            this.canvas.height = scaledHeight;
        }

        // Calculate actual DPI ratio used (may be less than device DPR if clamped)
        const actualDprX = scaledWidth / displayWidth;
        const actualDprY = scaledHeight / displayHeight;

        this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
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
 * Waveform Plotter
 */
export function plotWaveform(canvas, waveform, frequency = null) {
    // Cache renderer, only recreate if canvas size changed
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

    // Draw waveform
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

    // Color based on frequency if provided
    const color = frequency
        ? `hsl(${Math.min(frequency / 100, 360)}, 100%, 50%)`
        : 'rgb(35, 132, 242)';

    ctx.strokeStyle = color;
    ctx.stroke();
}

/**
 * Spectrum Bar Chart Plotter
 */
export function drawFFT(canvas, frequencies, magnitudes) {
    // Cache renderer, only recreate if canvas size changed
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

        // Color gradient based on magnitude
        const hue = 240 - (normalizedHeight * 180); // Blue to red
        ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;

        const x = i * barWidth;
        const y = displayHeight - barHeight;

        ctx.fillRect(x, y, barWidth - 1, barHeight);
    }
}

/**
 * Waterfall Spectrogram Plotter
 */
export function plotFFTWaterfall(canvas, frequencies, magnitudes, options = {}) {
    const {
        magnitudeScaling = 'log',
        noiseFloor = 0.005,
        colormap = 'viridis'
    } = options;

    // Initialize renderer (only resizes if needed)
    if (!canvas._renderer || canvas.clientWidth !== canvas._lastWidth || canvas.clientHeight !== canvas._lastHeight) {
        canvas._renderer = new CanvasRenderer(canvas);
        canvas._lastWidth = canvas.clientWidth;
        canvas._lastHeight = canvas.clientHeight;

        // Reset waterfall data on resize
        canvas.waterfallData = [];
    }

    const { ctx, displayWidth, displayHeight } = canvas._renderer;

    // Initialize waterfall history
    if (!canvas.waterfallData) {
        canvas.waterfallData = [];
    }

    const maxRows = Math.floor(displayHeight);
    const binWidth = displayWidth / frequencies.length;

    // Scale magnitudes
    const scaledMagnitudes = scaleMagnitudes(magnitudes, magnitudeScaling, noiseFloor);

    // Add new data row
    canvas.waterfallData.push(scaledMagnitudes);
    if (canvas.waterfallData.length > maxRows) {
        canvas.waterfallData.shift();
    }

    // Render waterfall
    canvas._renderer.clear();
    renderWaterfall(ctx, canvas.waterfallData, { binWidth, displayHeight }, colormap);
}

/**
 * Scale magnitudes for visualization
 */
function scaleMagnitudes(magnitudes, scaling, noiseFloor) {
    return magnitudes.map(mag => {
        let scaled = mag;

        if (scaling === 'log') {
            const logValue = Math.log10(Math.max(mag, noiseFloor));
            const logFloor = Math.log10(noiseFloor);
            scaled = (logValue - logFloor) / -logFloor;
        } else {
            // Linear scaling
            const maxMag = Math.max(...magnitudes, 1);
            scaled = mag / maxMag;
        }

        return Math.max(0, Math.min(1, scaled));
    });
}

/**
 * Render waterfall display
 */
function renderWaterfall(ctx, waterfallData, config, colormap) {
    const { binWidth, displayHeight } = config;
    const numRows = waterfallData.length;

    if (numRows === 0) return;

    // Calculate row height to fill the display area
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
 * Color mapping functions
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
    // Simplified viridis-like colormap
    const r = Math.round(255 * Math.pow(value, 3));
    const g = Math.round(255 * value);
    const b = Math.round(255 * Math.sqrt(1 - value));
    return `rgb(${r}, ${g}, ${b})`;
}

function hotColormap(value) {
    // Black -> Red -> Yellow -> White
    const r = Math.round(255 * Math.min(value * 3, 1));
    const g = Math.round(255 * Math.max(0, Math.min((value - 0.33) * 3, 1)));
    const b = Math.round(255 * Math.max(0, (value - 0.66) * 3));
    return `rgb(${r}, ${g}, ${b})`;
}

function coolColormap(value) {
    // Cyan -> Blue -> Magenta
    const r = Math.round(255 * value);
    const g = Math.round(255 * (1 - value));
    const b = 255;
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Legacy Chart.js function (kept for compatibility)
 * Note: Requires Chart.js library
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
