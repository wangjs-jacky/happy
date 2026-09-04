const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    applyExpoCameraScannerTransitionPatch,
} = require('./fix-expo-camera-scanner-transitions.cjs');

const unpatchedCameraModule = `    AsyncFunction("launchScanner") { (options: VisionScannerOptions?) in
      if #available(iOS 16.0, *) {
        try await MainActor.run {
          guard DataScannerViewController.isSupported, DataScannerViewController.isAvailable else {
            throw CameraScannerUnavailableException()
          }
          let delegate = VisionScannerDelegate(handler: self)
          scannerContext = ScannerContext(delegate: delegate)
          launchScanner(with: options)
        }
      }
    }

    AsyncFunction("dismissScanner") {
      if #available(iOS 16.0, *) {
        await MainActor.run {
          dismissScanner()
        }
      }
    }

  @available(iOS 16.0, *)
  @MainActor
  private func launchScanner(with options: VisionScannerOptions?) {
    let symbologies = options?.toSymbology() ?? []
    let controller = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: symbologies)],
      isPinchToZoomEnabled: options?.isPinchToZoomEnabled ?? true,
      isGuidanceEnabled: options?.isGuidanceEnabled ?? true,
      isHighlightingEnabled: options?.isHighlightingEnabled ?? false
    )

    scannerContext?.controller = controller
    if let delegate = scannerContext?.delegate as? VisionScannerDelegate {
      controller.delegate = delegate
    }

    appContext?.utilities?.currentViewController()?.present(controller, animated: true) {
      try? controller.startScanning()
    }
  }

  @available(iOS 16.0, *)
  @MainActor
  private func dismissScanner() {
    guard let controller = scannerContext?.controller as? DataScannerViewController else {
      return
    }
    controller.stopScanning()
    controller.dismiss(animated: true)
  }
`;

function createExpoCameraFixture(t, { source = unpatchedCameraModule, version = '55.0.10' } = {}) {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'paws-expo-camera-patch-'));
    const packageRoot = path.join(repositoryRoot, 'node_modules', 'expo-camera');
    const sourcePath = path.join(packageRoot, 'ios', 'CameraViewModule.swift');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ version }));
    fs.writeFileSync(sourcePath, source);
    t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
    return { repositoryRoot, sourcePath };
}

test('makes Expo Camera scanner promises settle from UIKit transition completions', (t) => {
    const fixture = createExpoCameraFixture(t);

    const result = applyExpoCameraScannerTransitionPatch({
        repositoryRoot: fixture.repositoryRoot,
        log: null,
        warn: null,
    });
    const patched = fs.readFileSync(fixture.sourcePath, 'utf8');

    assert.deepEqual(result, { found: 1, patched: 1 });
    assert.match(patched, /try await launchScanner\(with: options\)/);
    assert.match(patched, /private func launchScanner\(with options: VisionScannerOptions\?\) async throws/);
    assert.match(patched, /guard let currentViewController = appContext\?\.utilities\?\.currentViewController\(\) else \{\s+throw InitScannerFailed\(\)/);
    assert.match(patched, /guard controller\.presentingViewController != nil else \{\s+continuation\.resume\(throwing: InitScannerFailed\(\)\)\s+return/);
    assert.match(patched, /currentViewController\.present\(controller, animated: true\)/);
    assert.match(patched, /do \{\s+try controller\.startScanning\(\)\s+continuation\.resume\(\)/);
    assert.match(patched, /catch \{\s+controller\.dismiss\(animated: true\) \{\s+continuation\.resume\(throwing: error\)/);
    assert.match(patched, /private func dismissScanner\(\) async/);
    assert.match(patched, /controller\.dismiss\(animated: true\) \{\s+continuation\.resume\(\)\s+\}/);
    assert.doesNotMatch(patched, /try\? controller\.startScanning\(\)/);
});

test('is idempotent after Expo Camera has already been patched', (t) => {
    const fixture = createExpoCameraFixture(t);
    applyExpoCameraScannerTransitionPatch({
        repositoryRoot: fixture.repositoryRoot,
        log: null,
        warn: null,
    });
    const once = fs.readFileSync(fixture.sourcePath, 'utf8');

    const result = applyExpoCameraScannerTransitionPatch({
        repositoryRoot: fixture.repositoryRoot,
        log: null,
        warn: null,
    });

    assert.deepEqual(result, { found: 1, patched: 0 });
    assert.equal(fs.readFileSync(fixture.sourcePath, 'utf8'), once);
});

test('fails closed without modifying files when the installed Expo Camera source drifts', (t) => {
    const driftedSource = unpatchedCameraModule.replace(
        'private func dismissScanner() {',
        'private func dismissScanner(animated: Bool) {',
    );
    const fixture = createExpoCameraFixture(t, { source: driftedSource });

    assert.throws(
        () => applyExpoCameraScannerTransitionPatch({
            repositoryRoot: fixture.repositoryRoot,
            log: null,
            warn: null,
        }),
        /Expo Camera 55\.0\.10 source does not match the expected scanner transition implementation/,
    );
    assert.equal(fs.readFileSync(fixture.sourcePath, 'utf8'), driftedSource);
});

test('fails closed for an unverified Expo Camera version', (t) => {
    const fixture = createExpoCameraFixture(t, { version: '55.0.11' });

    assert.throws(
        () => applyExpoCameraScannerTransitionPatch({
            repositoryRoot: fixture.repositoryRoot,
            log: null,
            warn: null,
        }),
        /supports expo-camera 55\.0\.10, found 55\.0\.11/,
    );
    assert.equal(fs.readFileSync(fixture.sourcePath, 'utf8'), unpatchedCameraModule);
});
