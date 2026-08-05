# Dell Monitor Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GNOME Shell 50 panel extension that controls a Dell P3421W over DDC/CI (`ddcutil`): switch input source, adjust brightness/contrast, pick color preset and display mode, and power off — all async so the shell never blocks.

**Architecture:** Three isolated units. `ddcutil.js` is the only unit touching hardware (async `Gio.Subprocess`, serial command queue, bus pinning, pure output parsers). `monitor.js` holds VCP constants and a plain state model. `extension.js` is thin Shell wiring (`PanelMenu.Button` + PopupMenu) with no hardware logic. Pure logic (parsers, model, queue, error mapping) is unit-tested with standalone `gjs`; the Shell UI is verified manually.

**Tech Stack:** GJS (GNOME JavaScript) with ESM modules, GNOME Shell 50.3 extension API, `ddcutil` 2.2.7 CLI, `gjs` standalone test runner (no external test deps).

## Global Constraints

- GNOME Shell target: `metadata.json` `"shell-version": ["50"]`.
- All modules are ESM (`import x from 'gi://X'`); tests run with `gjs -m`.
- **Never spawn `ddcutil` synchronously** — always async `Gio.Subprocess` with `communicate_utf8_async`. Blocking freezes the shell.
- **Only one `ddcutil` process at a time** — serialize through a promise queue (shared i2c bus).
- `ddcutil` is on PATH at `/usr/bin/ddcutil` and needs no `sudo` (user is in `i2c` group).
- UUID: `dell-monitor-control@eboye.github`.
- Verified VCP codes (P3421W, MCCS 2.1): Brightness `0x10`, Contrast `0x12`, Preset `0x14`, Input `0x60`, Mode `0xDC`, Power `0xD6`.
- Verified value codes — Input: DP-1 `0x0F`, HDMI-1 `0x11`, USB-C `0x1B`. Preset: 6500K `0x05`, 9300K `0x08`, User1 `0x0B`, User2 `0x0C`. Mode: Standard `0x00`, Movie `0x03`, Games `0x05`. Power off `0x04`.
- Verified `--terse` formats:
  - `detect --terse` → multi-line block containing `   I2C bus:          /dev/i2c-6` and `   Monitor:          DEL:DELL P3421W:DHDJJ53`.
  - Continuous read → `VCP 10 C 100 100` (code, `C`, current, max).
  - Non-continuous read → `VCP 60 SNC x0f` (code, `SNC`, hex value prefixed `x`).
- Writes use `setvcp --noverify`; reads/writes after startup pass `--bus <N>`.

## File Structure

```
dell-monitor-control/
  metadata.json      # extension manifest
  monitor.js         # VCP constants + state model (pure, tested)
  ddcutil.js         # parsers + async service with serial queue (tested via injected spawn)
  extension.js       # PanelMenu.Button + menu wiring (manual verification)
  stylesheet.css     # slider/label styling
  README.md          # install / symlink / usage
  tests/
    harness.js       # tiny assert + async test runner, no deps
    run.js           # imports all *.test.js, runs, exits nonzero on failure
    monitor.test.js
    ddcutil.test.js
```

---

### Task 1: Scaffold, manifest, and test harness

**Files:**
- Create: `metadata.json`
- Create: `tests/harness.js`
- Create: `tests/run.js`
- Create: `tests/harness.test.js` (throwaway sanity test, deleted in Task 2 — see step)

**Interfaces:**
- Consumes: nothing.
- Produces: `harness.js` exports `test(name, fn)`, `assertEqual(actual, expected, msg?)`, `assertDeepEqual(actual, expected, msg?)`, `assertThrows(fn, msg?)`, and `run(): Promise<number>` (returns failure count). `fn` may be sync or return a Promise. `run.js` is the runnable entry: `gjs -m tests/run.js`.

- [ ] **Step 1: Write `metadata.json`**

```json
{
  "uuid": "dell-monitor-control@eboye.github",
  "name": "Dell Monitor Control",
  "description": "Control a DDC/CI Dell monitor (input source, brightness, contrast, color preset, display mode, power) from the top bar via ddcutil.",
  "shell-version": ["50"],
  "version": 1,
  "settings-schema": null,
  "url": "https://github.com/eboye/dell-monitor-control"
}
```

- [ ] **Step 2: Write the test harness**

`tests/harness.js`:

```js
// Minimal dependency-free test harness for gjs -m.
const tests = [];

export function test(name, fn) {
    tests.push({ name, fn });
}

export function assertEqual(actual, expected, msg = '') {
    if (actual !== expected)
        throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function assertDeepEqual(actual, expected, msg = '') {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`${msg} expected ${e}, got ${a}`);
}

export function assertThrows(fn, msg = '') {
    let threw = false;
    try { fn(); } catch { threw = true; }
    if (!threw)
        throw new Error(`${msg} expected function to throw`);
}

// Runs all registered tests; returns the number of failures.
export async function run() {
    let failures = 0;
    for (const { name, fn } of tests) {
        try {
            await fn();
            print(`ok - ${name}`);
        } catch (e) {
            failures++;
            printerr(`not ok - ${name}: ${e.message ?? e}`);
        }
    }
    print(`# ${tests.length - failures}/${tests.length} passed`);
    return failures;
}
```

- [ ] **Step 3: Write the runner**

`tests/run.js`:

```js
import GLib from 'gi://GLib';
import system from 'system';
import { run } from './harness.js';

// Import test modules for their side effect of registering tests.
import './harness.test.js';

const loop = GLib.MainLoop.new(null, false);
let exitCode = 0;

run()
    .then(failures => { exitCode = failures > 0 ? 1 : 0; })
    .catch(e => { printerr(`runner error: ${e.message ?? e}`); exitCode = 2; })
    .finally(() => loop.quit());

loop.run();
system.exit(exitCode);
```

- [ ] **Step 4: Write a sanity test**

`tests/harness.test.js`:

```js
import { test, assertEqual } from './harness.js';

test('harness runs a passing test', () => {
    assertEqual(1 + 1, 2);
});

test('harness supports async tests', async () => {
    const v = await Promise.resolve(42);
    assertEqual(v, 42);
});
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `cd ~/GitHub/dell-monitor-control && gjs -m tests/run.js; echo "exit=$?"`
Expected: two `ok -` lines, `# 2/2 passed`, `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add metadata.json tests/
git commit -m "feat: scaffold extension manifest and gjs test harness"
```

---

### Task 2: VCP constants and monitor state model

**Files:**
- Create: `monitor.js`
- Create: `tests/monitor.test.js`
- Modify: `tests/run.js` (add `import './monitor.test.js';`)
- Delete: `tests/harness.test.js` (sanity test no longer needed)
- Modify: `tests/run.js` (remove `import './harness.test.js';`)

**Interfaces:**
- Consumes: harness from Task 1.
- Produces: `monitor.js` exports:
  - `VCP` = `{ BRIGHTNESS: 0x10, CONTRAST: 0x12, PRESET: 0x14, INPUT: 0x60, MODE: 0xDC, POWER: 0xD6 }`
  - `INPUT` = `{ DP1: 0x0F, HDMI1: 0x11, USBC: 0x1B }`
  - `PRESET` = `{ K6500: 0x05, K9300: 0x08, USER1: 0x0B, USER2: 0x0C }`
  - `MODE` = `{ STANDARD: 0x00, MOVIE: 0x03, GAMES: 0x05 }`
  - `POWER_OFF` = `0x04`
  - `INPUT_LABELS`, `PRESET_LABELS`, `MODE_LABELS` — `Map`-like plain objects from numeric value → display string, e.g. `INPUT_LABELS[0x1B] === 'USB-C (laptop)'`.
  - `createModel()` → returns a fresh state object `{ bus: null, model: '', brightness: null, contrast: null, input: null, preset: null, mode: null, available: false, error: null }`.
  - `labelFor(labels, value)` → returns `labels[value]` or `` `Unknown (0x${value.toString(16)})` ``.

- [ ] **Step 1: Write the failing test**

`tests/monitor.test.js`:

```js
import { test, assertEqual, assertDeepEqual } from './harness.js';
import { VCP, INPUT, INPUT_LABELS, createModel, labelFor } from '../monitor.js';

test('VCP codes match verified values', () => {
    assertEqual(VCP.INPUT, 0x60);
    assertEqual(VCP.BRIGHTNESS, 0x10);
    assertEqual(INPUT.USBC, 0x1B);
});

test('labelFor returns known label', () => {
    assertEqual(labelFor(INPUT_LABELS, INPUT.USBC), 'USB-C (laptop)');
});

test('labelFor falls back for unknown value', () => {
    assertEqual(labelFor(INPUT_LABELS, 0x99), 'Unknown (0x99)');
});

test('createModel returns fresh unavailable state', () => {
    assertDeepEqual(createModel(), {
        bus: null, model: '', brightness: null, contrast: null,
        input: null, preset: null, mode: null, available: false, error: null,
    });
});
```

- [ ] **Step 2: Wire the test into the runner and run to verify it fails**

Edit `tests/run.js`: replace `import './harness.test.js';` with `import './monitor.test.js';`. Then delete `tests/harness.test.js`.

Run: `gjs -m tests/run.js; echo "exit=$?"`
Expected: FAIL — `not ok` lines / import error for `../monitor.js` (module not found), `exit` nonzero.

- [ ] **Step 3: Write `monitor.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `gjs -m tests/run.js; echo "exit=$?"`
Expected: four `ok -` lines from monitor.test.js, `# 4/4 passed`, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add monitor.js tests/monitor.test.js tests/run.js
git rm tests/harness.test.js
git commit -m "feat: add VCP constants and monitor state model"
```

---

### Task 3: ddcutil output parsers

**Files:**
- Create: `ddcutil.js` (parsers only in this task)
- Create: `tests/ddcutil.test.js`
- Modify: `tests/run.js` (add `import './ddcutil.test.js';`)

**Interfaces:**
- Consumes: harness from Task 1.
- Produces: `ddcutil.js` exports two pure functions:
  - `parseDetect(text)` → `{ bus: number, model: string } | null`. `bus` is the integer after `/dev/i2c-`; `model` is the middle field of the `Monitor:` line (`DEL:DELL P3421W:DHDJJ53` → `DELL P3421W`). Returns `null` if no `I2C bus:` line found.
  - `parseGetvcp(text)` → for continuous: `{ type: 'C', current: number, max: number }`; for non-continuous: `{ type: 'SNC', value: number }` (value parsed from hex `x0f` → 15). Returns `null` if the line doesn't match `VCP ...`.

- [ ] **Step 1: Write the failing test**

`tests/ddcutil.test.js`:

```js
import { test, assertDeepEqual, assertEqual } from './harness.js';
import { parseDetect, parseGetvcp } from '../ddcutil.js';

const DETECT = `Display 1
   I2C bus:          /dev/i2c-6
   DRM connector:    card1-DP-1
   drm_connector_id: 497
   Monitor:          DEL:DELL P3421W:DHDJJ53
`;

test('parseDetect extracts bus and model', () => {
    assertDeepEqual(parseDetect(DETECT), { bus: 6, model: 'DELL P3421W' });
});

test('parseDetect returns null when no monitor', () => {
    assertEqual(parseDetect('Invalid display\n'), null);
});

test('parseGetvcp parses continuous value', () => {
    assertDeepEqual(parseGetvcp('VCP 10 C 100 100'), { type: 'C', current: 100, max: 100 });
});

test('parseGetvcp parses non-continuous hex value', () => {
    assertDeepEqual(parseGetvcp('VCP 60 SNC x0f'), { type: 'SNC', value: 15 });
});

test('parseGetvcp returns null on garbage', () => {
    assertEqual(parseGetvcp('DDC communication failed'), null);
});
```

- [ ] **Step 2: Wire into runner and run to verify it fails**

Add `import './ddcutil.test.js';` to `tests/run.js`.
Run: `gjs -m tests/run.js; echo "exit=$?"`
Expected: FAIL — module `../ddcutil.js` not found, `exit` nonzero.

- [ ] **Step 3: Write the parsers in `ddcutil.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `gjs -m tests/run.js; echo "exit=$?"`
Expected: five `ok -` lines from ddcutil.test.js, total passed count increased, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add ddcutil.js tests/ddcutil.test.js tests/run.js
git commit -m "feat: add ddcutil terse output parsers"
```

---

### Task 4: Async ddcutil service (queue, bus pinning, error mapping)

**Files:**
- Modify: `ddcutil.js` (append the real spawn runner and `Ddcutil` class)
- Modify: `tests/ddcutil.test.js` (append service tests using an injected fake spawn)

**Interfaces:**
- Consumes: `parseDetect`, `parseGetvcp` from Task 3; `VCP` from `monitor.js`.
- Produces: `ddcutil.js` additionally exports:
  - `DdcError` class with `.code` in `{ 'NO_DDCUTIL', 'NO_MONITOR', 'COMM_FAILED', 'UNKNOWN' }`.
  - `spawnDdcutil(argv)` → `Promise<{ stdout: string, stderr: string, status: number }>`; rejects with `DdcError('NO_DDCUTIL')` when the binary is missing.
  - `class Ddcutil`:
    - `constructor(spawn = spawnDdcutil)` — `spawn` is injectable for tests.
    - `async detect()` → `{ bus, model }`; pins `this._bus`; throws `DdcError('NO_MONITOR')` if `parseDetect` returns null.
    - `async getVcp(code)` → parsed result of `parseGetvcp` (the object), or throws `DdcError('COMM_FAILED')`.
    - `async setVcp(code, value)` → resolves `undefined` on success; throws `DdcError('COMM_FAILED')` on nonzero status.
    - `async getAll()` → `{ brightness, contrast, input, preset, mode }` (numbers), reading each code sequentially.
    - All hardware calls are serialized through an internal promise chain (`_enqueue`).

- [ ] **Step 1: Write the failing tests (service via injected fake spawn)**

Append to `tests/ddcutil.test.js`:

```js
import { Ddcutil, DdcError } from '../ddcutil.js';
import { VCP } from '../monitor.js';

// Fake spawn: records argv, returns canned terse output per subcommand.
function makeFakeSpawn(responses) {
    const calls = [];
    const spawn = (argv) => {
        calls.push(argv);
        const key = argv.find(a => a === 'detect' || a === 'getvcp' || a === 'setvcp');
        const r = responses[key] ?? { stdout: '', stderr: '', status: 0 };
        return Promise.resolve(r);
    };
    spawn.calls = calls;
    return spawn;
}

test('detect pins bus and returns model', async () => {
    const spawn = makeFakeSpawn({
        detect: { stdout: 'Display 1\n   I2C bus:          /dev/i2c-6\n   Monitor:          DEL:DELL P3421W:DHDJJ53\n', stderr: '', status: 0 },
    });
    const d = new Ddcutil(spawn);
    const info = await d.detect();
    assertDeepEqual(info, { bus: 6, model: 'DELL P3421W' });
});

test('detect throws NO_MONITOR when none found', async () => {
    const spawn = makeFakeSpawn({ detect: { stdout: 'Invalid display\n', stderr: '', status: 0 } });
    const d = new Ddcutil(spawn);
    let code = null;
    try { await d.detect(); } catch (e) { code = e.code; }
    assertEqual(code, 'NO_MONITOR');
});

test('setVcp passes --bus and --noverify after detect', async () => {
    const spawn = makeFakeSpawn({
        detect: { stdout: '   I2C bus:          /dev/i2c-6\n   Monitor:          DEL:x:y\n', stderr: '', status: 0 },
        setvcp: { stdout: '', stderr: '', status: 0 },
    });
    const d = new Ddcutil(spawn);
    await d.detect();
    await d.setVcp(VCP.BRIGHTNESS, 50);
    const setCall = spawn.calls.find(c => c.includes('setvcp'));
    assertEqual(setCall.includes('--noverify'), true);
    assertEqual(setCall.includes('6'), true, 'bus number present');
});

test('getVcp maps nonzero status to COMM_FAILED', async () => {
    const spawn = makeFakeSpawn({
        detect: { stdout: '   I2C bus:          /dev/i2c-6\n   Monitor:          DEL:x:y\n', stderr: '', status: 0 },
        getvcp: { stdout: '', stderr: 'DDC communication failed', status: 1 },
    });
    const d = new Ddcutil(spawn);
    await d.detect();
    let code = null;
    try { await d.getVcp(VCP.INPUT); } catch (e) { code = e.code; }
    assertEqual(code, 'COMM_FAILED');
});

test('calls are serialized (one in flight at a time)', async () => {
    let active = 0, maxActive = 0;
    const spawn = () => {
        active++;
        maxActive = Math.max(maxActive, active);
        return new Promise(resolve => {
            imports.gi.GLib.idle_add(imports.gi.GLib.PRIORITY_DEFAULT, () => {
                active--;
                resolve({ stdout: '   I2C bus:          /dev/i2c-6\n   Monitor:          DEL:x:y\n', stderr: '', status: 0 });
                return false;
            });
        });
    };
    const d = new Ddcutil(spawn);
    await Promise.all([d.detect(), d.detect(), d.detect()]);
    assertEqual(maxActive, 1, 'never more than one spawn concurrently');
});
```

Note: the serialization test uses `imports.gi.GLib` (legacy accessor) so the fake can defer without an extra import; this is test-only.

- [ ] **Step 2: Run to verify new tests fail**

Run: `gjs -m tests/run.js; echo "exit=$?"`
Expected: FAIL — `Ddcutil`/`DdcError` not exported, `exit` nonzero.

- [ ] **Step 3: Append the service to `ddcutil.js`**

```js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { VCP } from './monitor.js';

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
        const run = this._queue.then(job, job);
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
```

Note: move the `import` lines to the top of `ddcutil.js` (ESM requires imports at module top). The parsers from Task 3 stay above/below as convenient, but all `import` statements must be at the very top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `gjs -m tests/run.js; echo "exit=$?"`
Expected: all ddcutil service tests `ok`, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add ddcutil.js tests/ddcutil.test.js
git commit -m "feat: add async ddcutil service with serial queue and bus pinning"
```

---

### Task 5: Panel indicator and menu wiring (manual verification)

**Files:**
- Create: `extension.js`
- Create: `stylesheet.css`

**Interfaces:**
- Consumes: `Ddcutil`, `DdcError` from `ddcutil.js`; `VCP`, `INPUT`, `PRESET`, `MODE`, `POWER_OFF`, `INPUT_LABELS`, `PRESET_LABELS`, `MODE_LABELS`, `labelFor`, `createModel` from `monitor.js`.
- Produces: default-exported `Extension` subclass with `enable()`/`disable()`.

This task is UI wiring against the live Shell; it is verified manually (no unit tests — Shell resource imports only resolve inside a running gnome-shell).

- [ ] **Step 1: Write `extension.js`**

```js
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Ddcutil } from './ddcutil.js';
import {
    VCP, INPUT, PRESET, MODE, POWER_OFF,
    INPUT_LABELS, PRESET_LABELS, MODE_LABELS,
    labelFor, createModel,
} from './monitor.js';

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(ddc) {
        super._init(0.0, 'Dell Monitor Control');
        this._ddc = ddc;
        this._model = createModel();
        this._powerConfirm = false;
        this._powerTimeoutId = 0;

        this.add_child(new St.Icon({
            icon_name: 'video-display-symbolic',
            style_class: 'system-status-icon',
        }));

        this._buildMenu();
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._refresh();
        });

        // Initial detect + populate.
        this._detectThenRefresh();
    }

    _buildMenu() {
        this.menu.removeAll();

        if (!this._model.available) {
            const item = new PopupMenu.PopupMenuItem(this._errorText(), { reactive: false });
            this.menu.addMenuItem(item);
            const retry = new PopupMenu.PopupMenuItem('Retry');
            retry.connect('activate', () => this._detectThenRefresh());
            this.menu.addMenuItem(retry);
            return;
        }

        // --- Input source ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Input'));
        this._inputItems = new Map();
        for (const code of [INPUT.DP1, INPUT.HDMI1, INPUT.USBC]) {
            const item = new PopupMenu.PopupMenuItem(labelFor(INPUT_LABELS, code));
            item.connect('activate', () => this._set(VCP.INPUT, code, 'input'));
            this._inputItems.set(code, item);
            this.menu.addMenuItem(item);
        }

        // --- Brightness slider ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Brightness'));
        this._brightnessSlider = this._addSlider(VCP.BRIGHTNESS, 'brightness');

        // --- Contrast slider ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Contrast'));
        this._contrastSlider = this._addSlider(VCP.CONTRAST, 'contrast');

        // --- Color preset submenu ---
        const presetMenu = new PopupMenu.PopupSubMenuMenuItem('Color preset');
        this._presetItems = new Map();
        for (const code of [PRESET.K6500, PRESET.K9300, PRESET.USER1, PRESET.USER2]) {
            const item = new PopupMenu.PopupMenuItem(labelFor(PRESET_LABELS, code));
            item.connect('activate', () => this._set(VCP.PRESET, code, 'preset'));
            this._presetItems.set(code, item);
            presetMenu.menu.addMenuItem(item);
        }
        this.menu.addMenuItem(presetMenu);

        // --- Display mode submenu ---
        const modeMenu = new PopupMenu.PopupSubMenuMenuItem('Display mode');
        this._modeItems = new Map();
        for (const code of [MODE.STANDARD, MODE.MOVIE, MODE.GAMES]) {
            const item = new PopupMenu.PopupMenuItem(labelFor(MODE_LABELS, code));
            item.connect('activate', () => this._set(VCP.MODE, code, 'mode'));
            this._modeItems.set(code, item);
            modeMenu.menu.addMenuItem(item);
        }
        this.menu.addMenuItem(modeMenu);

        // --- Power off (two-step confirm) ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._powerItem = new PopupMenu.PopupMenuItem('Power off display');
        this._powerItem.connect('activate', () => this._onPowerActivate());
        this.menu.addMenuItem(this._powerItem);

        // --- Refresh ---
        const refresh = new PopupMenu.PopupMenuItem('Refresh');
        refresh.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refresh);
    }

    _addSlider(code, key) {
        const item = new PopupMenu.PopupBaseMenuItem({ activate: false });
        const slider = new imports.ui.slider.Slider(0);
        // Apply only when the drag/scroll interaction settles.
        slider.connect('drag-end', () => this._applySlider(code, slider));
        slider.connect('scroll-event', () => {});
        item.add_child(slider);
        this.menu.addMenuItem(item);
        return slider;
    }

    _applySlider(code, slider) {
        const value = Math.round(slider.value * 100);
        this._set(code, value, code === VCP.BRIGHTNESS ? 'brightness' : 'contrast');
    }

    _errorText() {
        const map = {
            NO_DDCUTIL: 'ddcutil not found — install it.',
            NO_MONITOR: 'No DDC/CI monitor detected.',
            COMM_FAILED: 'Monitor not responding (check DDC/CI in OSD).',
        };
        return map[this._model.error] ?? 'Monitor unavailable.';
    }

    async _detectThenRefresh() {
        try {
            const info = await this._ddc.detect();
            this._model.available = true;
            this._model.error = null;
            this._model.bus = info.bus;
            this._model.model = info.model;
            this._buildMenu();
            await this._refresh();
        } catch (e) {
            this._model.available = false;
            this._model.error = e.code ?? 'UNKNOWN';
            this._buildMenu();
        }
    }

    async _refresh() {
        if (!this._model.available)
            return;
        try {
            const all = await this._ddc.getAll();
            Object.assign(this._model, all);
            this._render();
        } catch (e) {
            this._model.available = false;
            this._model.error = e.code ?? 'UNKNOWN';
            this._buildMenu();
        }
    }

    _render() {
        if (this._brightnessSlider && this._model.brightness !== null)
            this._brightnessSlider.value = this._model.brightness / 100;
        if (this._contrastSlider && this._model.contrast !== null)
            this._contrastSlider.value = this._model.contrast / 100;
        this._markActive(this._inputItems, this._model.input);
        this._markActive(this._presetItems, this._model.preset);
        this._markActive(this._modeItems, this._model.mode);
    }

    _markActive(items, activeCode) {
        if (!items)
            return;
        for (const [code, item] of items) {
            item.setOrnament(code === activeCode
                ? PopupMenu.Ornament.DOT
                : PopupMenu.Ornament.NONE);
        }
    }

    async _set(code, value, key) {
        try {
            await this._ddc.setVcp(code, value);
            this._model[key] = value;
            this._render();
        } catch (e) {
            Main.notify('Dell Monitor Control', 'Failed to apply change.');
        }
    }

    _onPowerActivate() {
        if (!this._powerConfirm) {
            this._powerConfirm = true;
            this._powerItem.label.text = 'Confirm power off';
            this._powerTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
                this._resetPower();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        this._resetPower();
        this._set(VCP.POWER, POWER_OFF, 'power');
    }

    _resetPower() {
        this._powerConfirm = false;
        if (this._powerItem)
            this._powerItem.label.text = 'Power off display';
        if (this._powerTimeoutId) {
            GLib.Source.remove(this._powerTimeoutId);
            this._powerTimeoutId = 0;
        }
    }

    destroy() {
        if (this._powerTimeoutId) {
            GLib.Source.remove(this._powerTimeoutId);
            this._powerTimeoutId = 0;
        }
        super.destroy();
    }
});

export default class DellMonitorControlExtension extends Extension {
    enable() {
        this._ddc = new Ddcutil();
        this._indicator = new Indicator(this._ddc);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._ddc = null;
    }
}
```

Note: `imports.ui.slider.Slider` uses the legacy `imports` accessor available inside the shell; if the ESM path is preferred, import `* as Slider from 'resource:///org/gnome/shell/ui/slider.js'` at the top and use `new Slider.Slider(0)`. During Step 3 verification, use whichever the running shell accepts — check `journalctl` for import errors and switch to the ESM import if the legacy accessor warns.

- [ ] **Step 2: Write `stylesheet.css`**

```css
/* Give sliders room inside the popup menu. */
.popup-menu-item .slider {
    width: 220px;
    margin: 0 8px;
}
```

- [ ] **Step 3: Symlink into the extensions dir and verify manually**

```bash
UUID=dell-monitor-control@eboye.github
ln -sfn ~/GitHub/dell-monitor-control ~/.local/share/gnome-shell/extensions/$UUID
gnome-extensions enable $UUID 2>&1 || true
```

On Wayland, a full re-login is needed to load new extension code (no `Alt+F2 r`). After logging back in:

```bash
gnome-extensions info dell-monitor-control@eboye.github
journalctl --user -b -o cat /usr/bin/gnome-shell | grep -i -A3 dell-monitor | tail -40
```

Verify by hand:
1. `video-display-symbolic` icon appears in the top bar.
2. Open menu → Input / Brightness / Contrast / Color preset / Display mode / Power off / Refresh present; active input/preset/mode show a dot; sliders reflect current brightness/contrast.
3. Drag brightness slider, release → panel dims; confirm with `ddcutil getvcp 10`.
4. Switch input to USB-C then back to DisplayPort (only with the laptop attached, per the design's blackout caveat).
5. Color preset and display mode changes take effect and re-mark the active dot.
6. Power off → label becomes "Confirm power off"; second click powers the panel off; waiting >4 s reverts the label.
7. Shell stays responsive throughout (no freeze) — proof the async path works.
8. Failure path: temporarily break PATH lookup (`sudo mv /usr/bin/ddcutil /usr/bin/ddcutil.bak`), Retry → menu shows "ddcutil not found"; restore (`sudo mv /usr/bin/ddcutil.bak /usr/bin/ddcutil`).

- [ ] **Step 4: Commit**

```bash
git add extension.js stylesheet.css
git commit -m "feat: add panel indicator with input/brightness/contrast/preset/mode/power controls"
```

---

### Task 6: README and final polish

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: user-facing install/usage docs.

- [ ] **Step 1: Write `README.md`**

````markdown
# Dell Monitor Control

A GNOME Shell (50+) top-bar extension to control a DDC/CI Dell monitor via
[`ddcutil`](https://www.ddcutil.com/): switch input source (DisplayPort / HDMI /
USB-C), adjust brightness and contrast, pick a color preset or display mode, and
power the panel off.

Built for and tested with a **Dell P3421W** on Arch Linux / GNOME 50 / Wayland.

## Requirements

- GNOME Shell 50+
- `ddcutil` on `PATH`, working without `sudo`:
  ```bash
  sudo pacman -S ddcutil
  # log out/in so the i2c udev rule + group membership apply
  ddcutil detect          # should list your monitor
  ```
- DDC/CI enabled in the monitor's OSD (Menu → Others → DDC/CI → On).

## Install

```bash
git clone https://github.com/eboye/dell-monitor-control ~/GitHub/dell-monitor-control
UUID=dell-monitor-control@eboye.github
ln -sfn ~/GitHub/dell-monitor-control ~/.local/share/gnome-shell/extensions/$UUID
# Log out and back in (Wayland), then:
gnome-extensions enable $UUID
```

## Usage

Click the display icon in the top bar. Sliders apply on release; input/preset/
mode changes apply immediately and mark the active choice with a dot. Power off
requires a confirmation click.

> **USB-C caveat:** switching to an input with no active source can leave the
> screen on "No signal". If DDC stops responding over the old cable, use the
> monitor's physical OSD button to switch back.

## Development

Pure logic (parsers, model, service queue) is unit-tested without the shell:

```bash
gjs -m tests/run.js
```

The UI (`extension.js`) is verified in a live GNOME session.
````

- [ ] **Step 2: Run the test suite once more as a regression check**

Run: `gjs -m tests/run.js; echo "exit=$?"`
Expected: all tests pass, `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with install and usage"
```

---

## Self-Review

**Spec coverage:**
- Input / brightness / contrast / preset / mode / power controls → Task 5. ✓
- Async `Gio.Subprocess`, never blocking → Task 4 (`spawnDdcutil`) + async UI handlers in Task 5. ✓
- Serial command queue → Task 4 `_enqueue` + serialization test. ✓
- Bus pinning → Task 4 `detect()`/`_busArgs()` + `--bus` test. ✓
- `--terse` parsing, `--noverify` writes → Tasks 3 & 4. ✓
- Instant + background refresh → Task 5 `_buildMenu` renders model immediately; `open-state-changed`/`_refresh` update in background. ✓
- Sliders apply on release → Task 5 `drag-end`. ✓
- Power off with confirmation → Task 5 two-step `_onPowerActivate`. ✓
- Error states + Retry, no silent failures → Task 5 `_errorText`/`_buildMenu` + `DdcError` mapping in Task 4. ✓
- Single monitor, no prefs, no shortcuts (YAGNI) → honored; `settings-schema: null`. ✓
- Symlink dev→extensions dir → Task 5 Step 3. ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete. The only intentionally manual task is the live-shell UI verification (Task 5), which cannot be unit-tested and lists concrete manual checks.

**Type consistency:** `Ddcutil` methods (`detect`, `getVcp`, `setVcp`, `getAll`), `DdcError.code` values, and `monitor.js` exports (`VCP`, `INPUT`, `PRESET`, `MODE`, `POWER_OFF`, `*_LABELS`, `labelFor`, `createModel`) are referenced consistently across Tasks 3–5. `getAll()` returns `{brightness, contrast, input, preset, mode}` — the exact keys `_refresh` assigns onto the model and `_render` reads.
