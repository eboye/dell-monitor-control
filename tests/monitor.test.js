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
