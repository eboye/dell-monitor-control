import { test, assertDeepEqual, assertEqual } from './harness.js';
import { parseDetect, parseGetvcp, parseGetvcpLines } from '../ddcutil.js';

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

// Laptop case: an "Invalid display" (internal eDP panel) is enumerated BEFORE
// the Dell. The parser must skip invalid blocks and bind to the real display's
// bus, not the first I2C bus line in the output. Regression for the bus-5 bug.
const DETECT_LAPTOP = `Invalid display
   I2C bus:          /dev/i2c-5
   DRM connector:    card1-eDP-1
   drm_connector_id: 110
   Monitor:          CSO::

Display 1
   I2C bus:          /dev/i2c-8
   DRM connector:    card2-DP-2
   drm_connector_id: 0
   Monitor:          DEL:DELL P3421W:D3M5
`;

test('parseDetect skips Invalid display blocks and binds the real display', () => {
    assertDeepEqual(parseDetect(DETECT_LAPTOP), { bus: 8, model: 'DELL P3421W' });
});

test('parseDetect prefers a Dell (DEL) display when several are valid', () => {
    const twoValid = `Display 1
   I2C bus:          /dev/i2c-3
   Monitor:          XYZ:Some Other:0001

Display 2
   I2C bus:          /dev/i2c-8
   Monitor:          DEL:DELL P3421W:D3M5
`;
    assertDeepEqual(parseDetect(twoValid), { bus: 8, model: 'DELL P3421W' });
});

test('parseDetect returns null when only invalid blocks exist', () => {
    const onlyInvalid = `Invalid display
   I2C bus:          /dev/i2c-5
   Monitor:          CSO::
`;
    assertEqual(parseDetect(onlyInvalid), null);
});

test('parseGetvcp returns null on ERR (non-finite value)', () => {
    assertEqual(parseGetvcp('VCP 10 ERR'), null);
    assertEqual(parseGetvcp('VCP 10 C x y'), null);
});

// Multi-code getvcp: one "VCP <code> ..." line per requested feature.
const MULTI = `VCP 10 C 100 100
VCP 12 C 75 100
VCP 14 SNC x05
VCP 60 SNC x1b
VCP DC SNC x00`;

test('parseGetvcpLines maps each VCP code to its parsed value', () => {
    const m = parseGetvcpLines(MULTI);
    assertDeepEqual(m.get(0x10), { type: 'C', current: 100, max: 100 });
    assertDeepEqual(m.get(0x12), { type: 'C', current: 75, max: 100 });
    assertEqual(m.get(0x14).value, 0x05);
    assertEqual(m.get(0x60).value, 0x1b);
    assertEqual(m.get(0xDC).value, 0x00);
});

test('parseGetvcpLines skips ERR/garbage lines', () => {
    const m = parseGetvcpLines('VCP 10 C 40 100\nVCP 12 ERR\ngarbage\n');
    assertEqual(m.get(0x10).current, 40);
    assertEqual(m.has(0x12), false);
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

import GLib from 'gi://GLib';
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
        detect: { stdout: 'Display 1\n   I2C bus:          /dev/i2c-6\n   Monitor:          DEL:x:y\n', stderr: '', status: 0 },
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
        detect: { stdout: 'Display 1\n   I2C bus:          /dev/i2c-6\n   Monitor:          DEL:x:y\n', stderr: '', status: 0 },
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
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                active--;
                resolve({ stdout: 'Display 1\n   I2C bus:          /dev/i2c-6\n   Monitor:          DEL:x:y\n', stderr: '', status: 0 });
                return false;
            });
        });
    };
    const d = new Ddcutil(spawn);
    await Promise.all([d.detect(), d.detect(), d.detect()]);
    assertEqual(maxActive, 1, 'never more than one spawn concurrently');
});

const DETECT_OK = { stdout: 'Display 1\n   I2C bus:          /dev/i2c-6\n   Monitor:          DEL:x:y\n', stderr: '', status: 0 };

test('getAll issues a single getvcp spawn and returns all values', async () => {
    const spawn = makeFakeSpawn({
        detect: DETECT_OK,
        getvcp: { stdout: 'VCP 10 C 40 100\nVCP 12 C 60 100\nVCP 14 SNC x08\nVCP 60 SNC x11\nVCP DC SNC x03\n', stderr: '', status: 0 },
    });
    const d = new Ddcutil(spawn);
    await d.detect();
    const before = spawn.calls.length;
    const all = await d.getAll();
    assertDeepEqual(all, { brightness: 40, contrast: 60, input: 0x11, preset: 0x08, mode: 0x03 });
    assertEqual(spawn.calls.length - before, 1, 'getAll spawns exactly once');
});

test('getAll returns null for VCP codes missing from the reply (keep last-known upstream)', async () => {
    const spawn = makeFakeSpawn({
        detect: DETECT_OK,
        getvcp: { stdout: 'VCP 10 C 40 100\nVCP 60 SNC x0f\n', stderr: '', status: 0 },
    });
    const d = new Ddcutil(spawn);
    await d.detect();
    const all = await d.getAll();
    assertEqual(all.brightness, 40);
    assertEqual(all.input, 0x0f);
    assertEqual(all.contrast, null);
    assertEqual(all.preset, null);
    assertEqual(all.mode, null);
});

test('getAll throws COMM_FAILED when no VCP lines parse', async () => {
    const spawn = makeFakeSpawn({
        detect: DETECT_OK,
        getvcp: { stdout: '', stderr: 'DDC communication failed', status: 1 },
    });
    const d = new Ddcutil(spawn);
    await d.detect();
    let code = null;
    try { await d.getAll(); } catch (e) { code = e.code; }
    assertEqual(code, 'COMM_FAILED');
});

test('cancel() is safe to call', () => {
    const d = new Ddcutil(makeFakeSpawn({}));
    d.cancel();
    assertEqual(typeof d.cancel, 'function');
});
