// VCP constants and monitor state model. Pure — no hardware, no Shell imports.

export const VCP = {
    BRIGHTNESS: 0x10,
    CONTRAST: 0x12,
    PRESET: 0x14,
    INPUT: 0x60,
    MODE: 0xDC,
    POWER: 0xD6,
};

export const INPUT = { DP1: 0x0F, HDMI1: 0x11, USBC: 0x1B };
export const PRESET = { K6500: 0x05, K9300: 0x08, USER1: 0x0B, USER2: 0x0C };
export const MODE = { STANDARD: 0x00, MOVIE: 0x03, GAMES: 0x05 };
export const POWER_OFF = 0x04;

export const INPUT_LABELS = {
    [INPUT.DP1]: 'DisplayPort',
    [INPUT.HDMI1]: 'HDMI',
    [INPUT.USBC]: 'USB-C (laptop)',
};

export const PRESET_LABELS = {
    [PRESET.K6500]: '6500 K',
    [PRESET.K9300]: '9300 K',
    [PRESET.USER1]: 'User 1',
    [PRESET.USER2]: 'User 2',
};

export const MODE_LABELS = {
    [MODE.STANDARD]: 'Standard',
    [MODE.MOVIE]: 'Movie',
    [MODE.GAMES]: 'Games',
};

export function labelFor(labels, value) {
    return labels[value] ?? `Unknown (0x${value.toString(16)})`;
}

export function createModel() {
    return {
        bus: null,
        model: '',
        brightness: null,
        contrast: null,
        input: null,
        preset: null,
        mode: null,
        available: false,
        error: null,
    };
}
