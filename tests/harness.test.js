import { test, assertEqual } from './harness.js';

test('harness runs a passing test', () => {
    assertEqual(1 + 1, 2);
});

test('harness supports async tests', async () => {
    const v = await Promise.resolve(42);
    assertEqual(v, 42);
});
