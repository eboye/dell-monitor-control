import GLib from 'gi://GLib';
import system from 'system';
import { run } from './harness.js';

// Import test modules for their side effect of registering tests.
import './monitor.test.js';
import './ddcutil.test.js';

const loop = GLib.MainLoop.new(null, false);
let exitCode = 0;

run()
    .then(failures => { exitCode = failures > 0 ? 1 : 0; })
    .catch(e => { printerr(`runner error: ${e.message ?? e}`); exitCode = 2; })
    .finally(() => loop.quit());

loop.run();
system.exit(exitCode);
