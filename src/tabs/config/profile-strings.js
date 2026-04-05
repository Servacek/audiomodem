// Lokalizovane retazce pre tab Nastavenia - profily.

export const PARAM_LABELS = {
    sample_rate:        'Vzorkovacia frekvencia (Hz)',
    channel_size:       'Šírka kanála (Hz)',
    bits_per_lane:      'Počet bitov na jednu linku',
    symbols_per_marker: 'Dĺžka markera v symboloch',
    tones_in_marker:    'Počet tónov v markeri',
    lanes_per_symbol:   'Počet liniek v symbole',
    symbol_repeats:     'Počet opakovaní symbolu',
    ecc_percent:        'Podiel samoopravných bajtov',
    dss_enabled:        'DSS (rozptyl spektra)',
    squelch_thresh:     'Squelch',
    cphase:             'Spojitá fáza',
    max_tx_amp:         'Hlasitosť vysielača',
    samples_per_symbol: 'Počet vzorkov na jeden symbol',
    channel_count:      'Počet kanálov',
};

export const HELP = {
    samples_per_symbol: 'Počet vzoriek na jeden symbol (mocnina 2)',
    bits_per_lane:      'Koľko bitov má jedna linka reprezentovať.',
    lanes_per_symbol:   'Koľko liniek má jeden symbol obsahovať.',
    symbol_repeats:     'Koľkokrát sa má každý symbol zopakovať.',
    channel_count:      'Na koľko rovnako veľkých časti máme rozdeliť spektrum frekvencií.',
    max_tx_amp:         'Maximálna amplitúda vysielaného signálu',
    symbols_per_marker: 'Koľko dĺžok symbolu má jeden marker trvať.',
    tones_in_marker:    'Koľko tónov má marker obsahovať.',
    ecc_percent:        'Podiel ECC bajtov (0% = žiadne, 100% = max ochrana)',
    squelch_thresh:     'Prahová hodnota squelchu',
    cphase:             'Vyhladzovanie prechodov medzi symbolmi.',
    dss_enabled:        'Vynásob prenášané bajty pseudonáhodnými číslami pre rovnomernejšie rozloženie energie.',
};

export const SECTIONS = {
    basic:      'Základné parametre',
    tx:         'TX parametre (vysielanie)',
    advanced:   'Pokročilé nastavenia',
    markers:    'Markery',
    markerDesc: 'Markery sú špeciálne tóny, ktoré označujú začiatok alebo koniec dátového prenosu.',
};

export const WAVE_INFO_LABELS = {
    symbolRate: 'Symbolová rýchlosť:',
    period:     'Perioda symbolu:',
    nyquist:    'Nyquist frekvencia:',
};

export const SPEED_LABEL = 'Rýchlosť';

export const PROFILE_CARD = {
    defaultName:      'Predvolený profil',
    namePlaceholder:  'Názov profilu',
    useActive:        '<i class="fas fa-check"></i> Používa sa',
    use:              'Použiť',
    readonlyNote:     'Tento profil je preddefinovaný a nedá sa upravovať ani zdieľať.',
    sameAsDefaultNote:'Profil je zhodný s predvoleným profilom, preto sa nedá zdieľať.',
    emptyState:       'Žiadne vlastné profily. Kliknite na "Pridať profil" pre vytvorenie nového.',
};

export const USB_SELECTOR = {
    keepCurrent:    'Ponechať aktuálny profil',
    defaultProfile: 'Predvolený profil',
};

export const VALIDATION = {
    invalidValue: 'Neplatná hodnota.',
    notANumber:   'Hodnota musí byť číslo.',
    outOfRange:   (min, max) => `Hodnota musí byť v rozsahu ${min} - ${max}.`,
    notPow2:      'Hodnota musí byť mocnina 2.',
};

export const STORE = {
    tooManyProfiles: max => `Maximálny počet profilov je ${max}. Odstráňte niektorý z existujúcich profilov.`,
    unknownProfile:  'Neznámy profil',
    defaultProfile:  'Predvolený profil',
};
