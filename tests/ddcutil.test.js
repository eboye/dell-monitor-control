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
