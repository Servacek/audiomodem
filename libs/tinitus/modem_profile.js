
const MODEM_PROFILE_FIELDS = [
    "param",
    "min_rx_freq",
    "max_rx_freq",
    "car_freq",
    "sample_rate",
    "bps",
    "bits_per_symbol",
    "min_tx_freq",
    "max_tx_freq",
    "min_tx_amp",
    "max_tx_amp",
    "min_tx_phs",
    "max_tx_phs"
];

export class ModemProfile {
    // constructor({
    //     param,
    //     min_rx_freq,
    //     max_rx_freq,
    //     car_freq,
    //     sample_rate,
    //     bps,
    //     bits_per_symbol,
    //     min_tx_freq,
    //     max_tx_freq,
    //     min_tx_amp,
    //     max_tx_amp,
    //     min_tx_phs,
    //     max_tx_phs
    // }) {
    //     this.param = param;
    //     this.min_rx_freq = min_rx_freq;
    //     this.max_rx_freq = max_rx_freq;
    //     this.car_freq = car_freq;
    //     this.sample_rate = sample_rate;
    //     this.bps = bps;
    //     this.bits_per_symbol = bits_per_symbol;
    //     this.min_tx_freq = min_tx_freq;
    //     this.max_tx_freq = max_tx_freq;
    //     this.min_tx_amp = min_tx_amp;
    //     this.max_tx_amp = max_tx_amp;
    //     this.min_tx_phs = min_tx_phs;
    //     this.max_tx_phs = max_tx_phs;
    // }

    constructor(config) {
        Object.assign(this, config);

        this.samples_per_bit  = this.bps >= 0 ? this.sample_rate / this.bps : 0;
        this.sample_period    = this.sample_rate > 0 ? 1.0 / this.sample_rate : 0;
    }

    getParametersOrderedArray() {
        return MODEM_PROFILE_FIELDS.map(k => this[k]);
    }
}
