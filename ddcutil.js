// ddcutil service. Parsers are pure; the service class spawns async subprocesses.

// --- Pure parsers -----------------------------------------------------------

export function parseDetect(text) {
    const busMatch = text.match(/I2C bus:\s*\/dev\/i2c-(\d+)/);
    if (!busMatch)
        return null;
    const bus = parseInt(busMatch[1], 10);

    const monMatch = text.match(/Monitor:\s*[^:\n]*:([^:\n]*):/);
    const model = monMatch ? monMatch[1].trim() : '';
    return { bus, model };
}

export function parseGetvcp(text) {
    const line = text.trim();
    const m = line.match(/^VCP\s+[0-9A-Fa-f]{1,2}\s+(\S+)\s+(.*)$/);
    if (!m)
        return null;
    const type = m[1];
    const rest = m[2].trim().split(/\s+/);
    if (type === 'C') {
        return { type: 'C', current: parseInt(rest[0], 10), max: parseInt(rest[1], 10) };
    }
    // Non-continuous: value like "x0f".
    const hex = rest[0].replace(/^x/i, '');
    return { type, value: parseInt(hex, 16) };
}
