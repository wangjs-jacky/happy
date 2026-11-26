const origin = process.argv[2];
const key = process.env.PAWS_PROJECT_CANVAS_TLDRAW_LICENSE?.trim();

async function verify() {
    if (!key || key.length > 4096) {
        throw new Error('Missing or malformed PAWS_PROJECT_CANVAS_TLDRAW_LICENSE.');
    }
    const location = new URL(origin);
    if (location.protocol !== 'https:' || location.origin !== origin) {
        throw new Error('Expected the exact production HTTPS origin.');
    }

    const { LicenseManager } = await import('tldraw');
    globalThis.window = { location };
    // License signatures are verified locally. The build preflight should not
    // emit the SDK's browser watermark telemetry.
    globalThis.fetch = async () => new Response();
    const manager = new LicenseManager(key);
    manager.verbose = false;
    const result = await manager.getLicenseFromKey(key);
    if (manager.isDevelopment || !result.isLicenseParseable || !result.isDomainValid
        || result.isAnnualLicenseExpired || result.isPerpetualLicenseExpired || result.isEvaluationLicenseExpired) {
        throw new Error('The tldraw license must be valid for the production hostname and the bundled SDK version.');
    }
    console.log('tldraw production license verified for the configured hostname.');
}

try {
    process.env.NODE_ENV = 'production';
    await verify();
    // The browser SDK starts background timers when imported.
    process.exit(0);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
