// ddcutil service. Parsers are pure; the service class spawns async subprocesses.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { VCP } from './monitor.js';

// Resolve ddcutil to an absolute path once, so a PATH-order hijack can't
// substitute a fake binary in the shell's privileged process. Falls back to the
// bare name if it can't be found (spawn then surfaces NO_DDCUTIL).
let _ddcutilPath = null;
function ddcutilPath() {
    if (_ddcutilPath === null)
        _ddcutilPath = GLib.find_program_in_path('ddcutil') ?? 'ddcutil';
    return _ddcutilPath;
}

const hex = (code) => code.toString(16).toUpperCase();

// Kill a ddcutil call that hasn't returned in this long — DDC/CI over a wedged
// i2c bus can hang indefinitely, which would otherwise deadlock the serial queue.
const CALL_TIMEOUT_MS = 5000;

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
    const raw = rest[0].replace(/^x/i, '');
    const value = parseInt(raw, 16);
    if (!Number.isFinite(value))
        return null;
    return { type, value };
}

// Parse a multi-code `getvcp` --terse reply (one "VCP <code> ..." line per
// requested feature) into a Map from numeric VCP code to its parsed value.
// Lines that don't parse (ERR, garbage) are simply omitted.
export function parseGetvcpLines(text) {
    const out = new Map();
    for (const line of text.split('\n')) {
        const m = line.trim().match(/^VCP\s+([0-9A-Fa-f]{1,2})\s+/);
        if (!m)
            continue;
        const parsed = parseGetvcp(line);
        if (parsed)
            out.set(parseInt(m[1], 16), parsed);
    }
    return out;
}

// --- Async service -----------------------------------------------------------

export class DdcError extends Error {
    constructor(code, message) {
        super(message ?? code);
        this.code = code;
    }
}

// Real async runner. Resolves { stdout, stderr, status }. A watchdog force-kills
// a call that exceeds CALL_TIMEOUT_MS so a hung i2c bus can't wedge the queue;
// the cancellable lets disable() abort an in-flight call immediately.
export function spawnDdcutil(argv, cancellable = null) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                [ddcutilPath(), ...argv],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (e) {
            reject(new DdcError('NO_DDCUTIL', e.message));
            return;
        }

        let timedOut = false;
        let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CALL_TIMEOUT_MS, () => {
            timedOut = true;
            timeoutId = 0;
            proc.force_exit();
            return GLib.SOURCE_REMOVE;
        });

        proc.communicate_utf8_async(null, cancellable, (p, res) => {
            if (timeoutId) {
                GLib.Source.remove(timeoutId);
                timeoutId = 0;
            }
            if (timedOut) {
                reject(new DdcError('COMM_FAILED', 'ddcutil timed out'));
                return;
            }
            try {
                const [, stdout, stderr] = p.communicate_utf8_finish(res);
                resolve({ stdout: stdout ?? '', stderr: stderr ?? '', status: p.get_exit_status() });
            } catch (e) {
                reject(new DdcError('UNKNOWN', e.message));
            }
        });
    });
}

// Codes fetched by getAll(), and how each maps onto the model field.
const ALL_VCP = [
    { code: VCP.BRIGHTNESS, key: 'brightness', field: 'current' },
    { code: VCP.CONTRAST, key: 'contrast', field: 'current' },
    { code: VCP.INPUT, key: 'input', field: 'value' },
    { code: VCP.PRESET, key: 'preset', field: 'value' },
    { code: VCP.MODE, key: 'mode', field: 'value' },
];

export class Ddcutil {
    constructor(spawn = spawnDdcutil) {
        this._spawn = spawn;
        this._bus = null;
        this._queue = Promise.resolve();
        this._cancellable = new Gio.Cancellable();
    }

    // Abort any in-flight call and refuse further ones. Called from disable().
    cancel() {
        this._cancellable.cancel();
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
            const { stdout } = await this._spawn(['detect', '--terse'], this._cancellable);
            const info = parseDetect(stdout);
            if (!info)
                throw new DdcError('NO_MONITOR');
            this._bus = info.bus;
            return info;
        });
    }

    async getVcp(code) {
        return this._enqueue(async () => {
            const { stdout, status } = await this._spawn(
                [...this._busArgs(), 'getvcp', hex(code), '--terse'], this._cancellable);
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
            const { status } = await this._spawn(
                [...this._busArgs(), 'setvcp', '--noverify', hex(code), String(value)], this._cancellable);
            if (status !== 0)
                throw new DdcError('COMM_FAILED');
        });
    }

    // Read every control in ONE ddcutil invocation. Values for codes missing
    // from the reply come back as null so the caller can keep last-known-good
    // rather than blanking the whole menu on one flaky read. Throws only when
    // nothing at all parsed (wedged bus / no monitor on this --bus).
    async getAll() {
        return this._enqueue(async () => {
            const codes = ALL_VCP.map(v => hex(v.code));
            const { stdout } = await this._spawn(
                [...this._busArgs(), 'getvcp', ...codes, '--terse'], this._cancellable);
            const parsed = parseGetvcpLines(stdout);
            if (parsed.size === 0)
                throw new DdcError('COMM_FAILED');
            const result = {};
            for (const { code, key, field } of ALL_VCP) {
                const p = parsed.get(code);
                result[key] = p ? p[field] : null;
            }
            return result;
        });
    }
}
