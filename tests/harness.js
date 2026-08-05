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
