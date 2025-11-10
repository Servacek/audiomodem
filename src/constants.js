
// TERMINOLOGY:
// tonewave - pure sine wave, representing a single frequency
// wavefrom - shows the displacement (amplitude) of the sound wave on the vertical axis and time on the horizontal axis.

export const ALIGMENT_RIGHT = "right"
export const ALIGMENT_LEFT  = "left";

export const TAB = {
    GRAPH: "tab-graph",
    CONFIG: "tab-config",
    CHAT: "tab-chat",
    OSCILLATOR: "tab-oscillator",

}

export const DARK_MODE = "dark-scheme";
export const MAKE_DARK_MODE_DEFAULT = true;

export const MAX_USERNAME_LENGTH = 16;
export const MAX_CHANNELNAME_LENGTH = 16;
export const MAX_MESSAGE_LENGTH = 128;

export const SYSTEM_MESSAGE_ICONS = {
    ["info"]: "fas fa-circle-info",
    ["warn"]: "fas fa-triangle-exclamation",
    ["error"]: "fas fa-circle-xmark",
    ["welcome"]: "fas fa-hands"
};

export const SYSTEM_MESSAGE_COLORS = {
    ["info"]: "#2ba5f7", // light blue
    ["warn"]: "#ffc107", // yellow orange
    ["error"]: "#ff6e6e", // light red
    ["welcome"]: "#8bc34a" // light green
};

export const DEBUG_MODE = true;

export const TWOPI = 2 * Math.PI;

export const CBYTE = {
    NDA: 0, // No data avaiable
    DXA: 1, // Data available
    SXT: 2, // Start transmission
    EXT: 3, // End transmission
}

// The maximal number of empty chunks received before timing out the connection.
export const MAX_EMPTY_CONSECUTIVE_CHUNKS = 10;

// A human can hear from 20 Hz to something around 22 050 Hz,
// to correctly recreate any full cycle of a 22,05 kHz tone
// the sample frequency must be at least twice that frequency.
//
// In reality we do not really need such high sample frequency since
// most microphones do not capture the full human hearing range...

export const MAX_HUMAN_HEAR_FREQUENCY = 22050; // Hz
// Determines how long will each tone representing a data frame last.
export const DATA_FRAME_DURATION = 0.2; // Seconds
export const CONTROL_FRAME_DURATION = 2; // Seconds
export const MAX_FRAME_DURATION = 3; // Seconds
export const BITS_PER_FRAME = 4;  // Max is 8 we will have 2^BITS_PER_FRAME number of tones.
export const FRAME_SPACING_DURATION = 0;//DATA_FRAME_DURATION / 4;
// How many tones we will be using for transmitting actual data
// This doesn't count tones used for controlling the transmission.
export const TONES_COUNT = 2 ** BITS_PER_FRAME;

// Lower and upper bound of the frequency range used for communication (TX).
// For ultrasonic communication use frequencies 20 kHz+ but keep in mind
// not all microphones can capture the full range.
// TODO: This should be set according to the device used by the client.
export const MIN_TX_FREQUENCY = 1200; // used as the base frequency for frames
export const MAX_TX_FREQUENCY = 2500;
export const FREQUENCY_DECIMAL = Math.floor((MAX_TX_FREQUENCY - MIN_TX_FREQUENCY) / TONES_COUNT / 10) * 10
export const MAX_USED_TX_FREQUENCY = FREQUENCY_DECIMAL * TONES_COUNT;
if (MAX_USED_TX_FREQUENCY > MAX_TX_FREQUENCY) {
    throw new Error(`MAX_USED_TX_FREQUENCY (${MAX_USED_TX_FREQUENCY}) > MAX_TX_FREQUENCY (${MAX_TX_FREQUENCY})`);
}

export const FRAME_HEADER = "1";
export const FRAME_TAIL = "1";
export const DATA_FREQ_RANGE_MIN = 1000;
export const DATA_FREQ_RANGE_MAX = 10000;
export const BIT_SPACING = 200; // Hz spacing from the bit on the left and on the right.
export const DATA_FREQ_RANGE_LENGTH = DATA_FREQ_RANGE_MAX - DATA_FREQ_RANGE_MIN;
export const MAX_BITS_PER_FRAME = (DATA_FREQ_RANGE_LENGTH / BIT_SPACING) - (FRAME_HEADER.length + FRAME_TAIL.length);

export const START_TONE_FREQUENCY = 800;
export const START_TONE_FREQUENCIES = [300, 400, 500, 600];
export const END_TONE_FREQUENCY = 900;
export const END_TONE_FREQUENCIES = [350, 450, 550, 650];
export const ACKNOWLEDGE_TONE_FREQUENCY = 200;
export const CONTROL_FREQUENCIES = [START_TONE_FREQUENCY, END_TONE_FREQUENCY, ACKNOWLEDGE_TONE_FREQUENCY];

// So we support even special characters with diacritics.
export const DEFAULT_STRING_ENCODING = "utf-8";

// Determines the upper and lower bound of the wave.
// So our range is 2^16 = 65 535 so we
// get a max of 32 767.5 and a min of -32 767.5
// 24 (but we do not have an int24 so we would have to use int32)
export const BIT_DEPTH = 16;
export const VOLUME = 0.25;  // Percent

// According to the Nyquist theorem
// https://en.wikipedia.org/wiki/Nyquist%E2%80%93Shannon_sampling_theorem
export const SAMPLING_FREQUENCY = 48000; //MAX_HUMAN_HEAR_FREQUENCY * 2; // Hz = 44 100 Hz
export const MIN_SAMPLING_FREQUENCY = DATA_FREQ_RANGE_MAX * 2;
export const SAMPLING_PERIOD = 1 / SAMPLING_FREQUENCY; // Seconds T = 1 / f
export const SAMPLE_DURATION = SAMPLING_PERIOD;
export const SAMPLES_PER_FRAME = Math.floor(SAMPLING_FREQUENCY * DATA_FRAME_DURATION);
export const MAX_MAGNITUDE = 2 ** (BIT_DEPTH - 1);
export const AMPLITUDE = MAX_MAGNITUDE * VOLUME; // ym

// np.<One of:
// - bartlett
// - np.blackman
// - hamming
// - hanning
// - kaiser>
// or None if no windowing function should be used.
export const WINDOW_FUNCTION = null; //np.blackman;

// The integer type used to represent individual samples of a signal.
export const DEFAULT_INTEGER_TYPE = Int16Array;
export const INTEGER_TYPE = {
    16: Int16Array, 24: Int32Array, 32: Int32Array,
}[BIT_DEPTH] || DEFAULT_INTEGER_TYPE;

export const BIT_RATE = BITS_PER_FRAME / DATA_FRAME_DURATION; // bits per second
export const SAMPLE_CHUNK_SIZE = Math.floor(SAMPLING_FREQUENCY * (DATA_FRAME_DURATION + FRAME_SPACING_DURATION)); // Samples per chunk
export const CHUNK_DURATION = SAMPLE_CHUNK_SIZE * SAMPLE_DURATION;
export const CHUNKING_FREQUENCY = 1 / CHUNK_DURATION; // Hertz

// For mono audio. Set to None if you would like to use all available channels.
export const INPUT_CHANNELS = 1;
export const OUTPUT_CHANNELS = 1;

// Buffering
export const BITS_BUFFER_REPEAT_COUNT = 2; // Should be enough
export const CONTROL_BUFFER_REPEAT_COUNT = 1; //3
