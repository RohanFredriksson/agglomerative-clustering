// A test's own time limit, scaled by TEST_TIMEOUT_SCALE for slow builds: scripts/asan-test.sh runs the suite against a
// sanitized WebAssembly several times slower than the release build and sets it, since vitest's --testTimeout doesn't
// raise a limit a test gives itself. Without the variable the limits are as written.
export const timeLimit = (ms) => ms * (Number(process.env.TEST_TIMEOUT_SCALE) || 1);
