/** Vitest process settings. Package scripts build the CLI once before tests. */

export async function setup() {
    process.env.VITEST_POOL_TIMEOUT = '60000'
    process.env.HAPPY_RUN_SANDBOX_NETWORK_TESTS = '1'
}

export async function teardown() {
    // Per-suite integration environments clean themselves up.
}
