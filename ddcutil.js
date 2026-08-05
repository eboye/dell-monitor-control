// ddcutil service. Parsers are pure; the service class spawns async subprocesses.

import Gio from 'gi://Gio';
import { VCP } from './monitor.js';

// --- Pure parsers -----------------------------------------------------------

export function parseDetect(text) {
    // `ddcutil detect` output is a sequence of blocks. Each block starts with
    // an unindented header line ("Display 1", "Invalid display", ...) followed
    // by indented fields. Parsing the whole text at once would let an earlier
    // "Invalid display" block (e.g. a laptop's internal eDP panel, which can't
    // do DDC/CI) shadow the real monitor's bus. So parse block by block and
    // keep only real "Display N" blocks.
    const blocks = [];
    let current = null;
    for (const line of text.split('\n')) {
        if (/^\S/.test(line)) {
            current = { header: line.trim(), body: [] };
            blocks.push(current);
        } else if (current) {
            current.body.push(line);
        }
    }

    const displays = [];
    for (const block of blocks) {
        if (!/^Display\s+\d+$/.test(block.header))
            continue;
        const body = block.body.join('\n');
        const busMatch = body.match(/I2C bus:\s*\/dev\/i2c-(\d+)/);
        if (!busMatch)
            continue;
        const bus = parseInt(busMatch[1], 10);
        const monMatch = body.match(/Monitor:\s*([^:\n]*):([^:\n]*):/);
        const mfg = monMatch ? monMatch[1].trim() : '';
        const model = monMatch ? monMatch[2].trim() : '';
        displays.push({ bus, mfg, model });
    }

    if (displays.length === 0)
        return null;
    // Prefer a Dell (mfg "DEL") when more than one valid display is present.
    const chosen = displays.find(d => d.mfg === 'DEL') ?? displays[0];
    return { bus: chosen.bus, model: chosen.model };
}

export function parseGetvcp(text) {
    const line = text.trim();
    const m = line.match(/^VCP\s+[0-9A-Fa-f]{1,2}\s+(\S+)\s+(.*)$/);
    if (!m)
        return null;
    const type = m[1];
    const rest = m[2].trim().split(/\s+/);
    if (type === 'C') {
        const current = parseInt(rest[0], 10);
        const max = parseInt(rest[1], 10);
        // A zero-exit "ERR"/malformed reply must not put NaN onto the sliders.
        if (!Number.isFinite(current) || !Number.isFinite(max))
            return null;
        return { type: 'C', current, max };
    }
    // Non-continuous: value like "x0f".
    const hex = rest[0].replace(/^x/i, '');
    const value = parseInt(hex, 16);
    if (!Number.isFinite(value))
        return null;
    return { type, value };
}

// --- Async service -----------------------------------------------------------

export class DdcError extends Error {
    constructor(code, message) {
        super(message ?? code);
        this.code = code;
    }
}

// Real async runner. Resolves { stdout, stderr, status }.
export function spawnDdcutil(argv) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                ['ddcutil', ...argv],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (e) {
            reject(new DdcError('NO_DDCUTIL', e.message));
            return;
        }
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, stdout, stderr] = p.communicate_utf8_finish(res);
                resolve({ stdout: stdout ?? '', stderr: stderr ?? '', status: p.get_exit_status() });
            } catch (e) {
                reject(new DdcError('UNKNOWN', e.message));
            }
        });
    });
}

export class Ddcutil {
    constructor(spawn = spawnDdcutil) {
        this._spawn = spawn;
        this._bus = null;
        this._queue = Promise.resolve();
    }

    // Serialize every hardware call through a single promise chain.
    _enqueue(job) {
        const run = this._queue.then(job);
        // Keep the chain alive even if a job rejects.
        this._queue = run.catch(() => {});
        return run;
    }

    _busArgs() {
        return this._bus === null ? [] : ['--bus', String(this._bus)];
    }

    async detect() {
        return this._enqueue(async () => {
            const { stdout } = await this._spawn(['detect', '--terse']);
            const info = parseDetect(stdout);
            if (!info)
                throw new DdcError('NO_MONITOR');
            this._bus = info.bus;
            return info;
        });
    }

    async getVcp(code) {
        return this._enqueue(async () => {
            const hex = code.toString(16).toUpperCase();
            const { stdout, status } = await this._spawn([...this._busArgs(), 'getvcp', hex, '--terse']);
            if (status !== 0)
                throw new DdcError('COMM_FAILED');
            const parsed = parseGetvcp(stdout);
            if (!parsed)
                throw new DdcError('COMM_FAILED');
            return parsed;
        });
    }

    async setVcp(code, value) {
        return this._enqueue(async () => {
            const hex = code.toString(16).toUpperCase();
            const { status } = await this._spawn([...this._busArgs(), 'setvcp', '--noverify', hex, String(value)]);
            if (status !== 0)
                throw new DdcError('COMM_FAILED');
        });
    }

    async getAll() {
        const b = await this.getVcp(VCP.BRIGHTNESS);
        const c = await this.getVcp(VCP.CONTRAST);
        const i = await this.getVcp(VCP.INPUT);
        const p = await this.getVcp(VCP.PRESET);
        const m = await this.getVcp(VCP.MODE);
        return {
            brightness: b.current,
            contrast: c.current,
            input: i.value,
            preset: p.value,
            mode: m.value,
        };
    }
}
