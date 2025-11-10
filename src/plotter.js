

// debugging functionality
// export function plotWaveform(canvas, waveform) {
//     if (canvas.chart) {
//         canvas.chart.destroy();
//     }

//     if (waveform === null) {
//         return; // In case we just want to clean the canvas.
//     }

//     const datasets = []
//     const nframes = waveform.length / (44100*0.2)
//     for (let i = 0; i < nframes; i++) {
//         datasets.push({
//             label: 'FRAME ' + (i+1),
//             data: (waveform.slice(i * (44100*0.2), i * (44100*0.2) + 512)),
//             borderColor: i % 2 === 0 ? 'rgb(223, 112, 33)' : 'rgb(35, 132, 242)', // Line color
//             borderWidth: 1,
//             pointRadius: 0, // Hide points for large datasets
//             order: nframes -i,
//             stack: false,
//         });
//     }

//     canvas.chart = new Chart(canvas.getContext("2d"), {
//         type: 'line', // Line chart
//         data: {
//             labels: Array.from({ length: 1000 }, (_, i) => i / CONST.SAMPLING_FREQUENCY), // Time values for x-axis
//             datasets: datasets,
//         },
//         options: {
//             responsive: true,
//             maintainAspectRatio: false,
//             scales: {
//                 x: {
//                     type: 'linear',
//                     title: { display: true, text: 'Time (s)' },
//                     ticks: { maxTicksLimit: 10 } // Limit the number of x-axis labels
//                 },
//                 y: {
//                     title: { display: true, text: 'Amplitude' },
//                     suggestedMin: -1,
//                     suggestedMax: 1
//                 }
//             },
//             elements: {
//                 line: { tension: 0 } // Disable smoothing
//             }
//         }
//     });
// }

export function plotWaveform(canvas, waveform, frequency) {
    const ctx = canvas.getContext('2d');

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;

    // Clear previous waveform
    ctx.clearRect(0, 0, width, height);

    const bufferLength = waveform.length;
    const sliceWidth = width / bufferLength;

    ctx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
        const x = i * sliceWidth;
        const y = centerY + waveform[i] * centerY; // Normalize the data to fit within canvas height
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    ctx.lineWidth = 2;
    const color = frequency ? `hsl(${frequency / 100}, 100%, 50%)` : "blue"; // Calculate the color according to the frequency, the higher frequency the redish the color.
    ctx.strokeStyle = color;
    ctx.stroke();
}


export function plotFFT(canvas, frequencies, magnitudes, waterfall) {
    const ctx = canvas.getContext('2d');
    if (canvas.chart) {
        canvas.chart.data.labels = frequencies.map(f => f.toFixed(0)); // Format frequencies
        canvas.chart.data.datasets[0].data = magnitudes;
        canvas.chart.update({
            duration: 2000,
            //easing: 'easeOutBounce'
        });
        return;
    }

    canvas.chart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: frequencies.map(f => f.toFixed(2)), // Format frequencies
            datasets: [
                {
                    label: 'FFT Magnitude',
                    data: magnitudes,
                    borderColor: 'red',
                    backgroundColor: 'rgba(255, 0, 0, 1)',
                },
            ],
        },
        options: {
            responsive: true,
            legend: {
                display: false,
            },
            scales: {
                xAxes: [{
                    title: {
                        display: true,
                        text: 'Frekvencia [Hz]',
                    },
                    gridLines: {
                        color: "rgba(0, 0, 0, 0)",
                    },
                }],
                yAxes: [{
                    title: {
                        display: true,
                        text: 'Magnitúda [dB]',
                    },
                    gridLines: {
                        color: "rgba(0, 0, 0, 0)",
                    },
                    display: false,
                    min: 0, // Set minimum magnitude (adjust as needed)
                    max: 100,    // Set maximum magnitude (adjust as needed)
                }],
            },
        },
    });
}

export function drawFFT(canvas, frequencies, magnitudes) {
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set up graph dimensions
    const barWidth = canvas.width / frequencies.length;
    let x = 0;

    for (let i = 0; i < frequencies.length; i++) {
        const barHeight = Math.min(magnitudes[i] / 255 * canvas.height, canvas.height - 1);

        // Set color for the bars
        ctx.fillStyle = `rgb(${barHeight + 50}, 50, 200)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth;
    }

    requestAnimationFrame(drawFFT);
}



export function plotFFTWaterfall(canvas, frequencies, magnitudes, options = {}) {
    const ctx = canvas.getContext('2d');

    // High-DPI scaling for crisp rendering
    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Disable image smoothing for sharp edges
    ctx.imageSmoothingEnabled = false;

    // Configuration options
    const {
        colorScale = (value) => `rgba(${Math.round(255 * value)}, ${Math.round(255 * (1 - value))}, 128, ${value})`,
        magnitudeScaling = 'log', // 'linear' or 'log'
        noiseFloor = 0.005, // Minimum magnitude value to visualize
    } = options;

    if (!canvas.waterfallData) {
        canvas.waterfallData = [];
    }

    // Normalize and scale magnitudes
    const scaledMagnitudes = magnitudes.map(mag => {
        let scaledValue = mag;
        if (magnitudeScaling === 'log') {
            scaledValue = Math.log10(Math.max(mag, noiseFloor)) / Math.log10(1 / noiseFloor);
        }
        return Math.max(0, Math.min(1, scaledValue)); // Clamp to [0, 1]
    });

    // Set dimensions for bins and rows
    const numRows = canvas.height; // One row per vertical pixel
    const binWidth = canvas.width / frequencies.length; // Subpixel precision
    const rowHeight = canvas.height / numRows; // Subpixel precision

    // Add the new FFT data to the waterfall
    canvas.waterfallData.push(scaledMagnitudes);
    if (canvas.waterfallData.length > numRows) {
        canvas.waterfallData.shift(); // Remove oldest data to maintain numRows
    }

    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render the waterfall
    canvas.waterfallData.forEach((row, rowIndex) => {
        row.forEach((magnitude, binIndex) => {
            const color = colorScale(magnitude); // Map scaled magnitude to color
            ctx.fillStyle = color;
            ctx.fillRect(
                binIndex * binWidth,         // X position
                rowIndex * rowHeight,        // Y position
                binWidth,                    // Width
                rowHeight                    // Height
            );
        });
    });
}
