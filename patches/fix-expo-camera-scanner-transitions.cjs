/**
 * Expo Camera 55.0.10 resolves the iOS modern-scanner methods as soon as it
 * schedules UIKit presentation/dismissal. That lets JS launch a replacement
 * scanner while the previous animated transition is still in flight.
 *
 * Keep the JS promises pending until the corresponding UIKit completion
 * handlers run. This patch is intentionally version- and source-pinned so an
 * Expo Camera upgrade cannot silently ship without revalidating the bridge.
 */
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_EXPO_CAMERA_VERSION = '55.0.10';
const CAMERA_MODULE_RELATIVE_PATH = 'expo-camera/ios/CameraViewModule.swift';

const originalModuleFunctions = `    AsyncFunction("launchScanner") { (options: VisionScannerOptions?) in
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
    }`;

const patchedModuleFunctions = `    AsyncFunction("launchScanner") { (options: VisionScannerOptions?) in
      if #available(iOS 16.0, *) {
        try await launchScanner(with: options)
      }
    }

    AsyncFunction("dismissScanner") {
      if #available(iOS 16.0, *) {
        await dismissScanner()
      }
    }`;

const originalPrivateFunctions = `  @available(iOS 16.0, *)
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
  }`;

const patchedPrivateFunctions = `  @available(iOS 16.0, *)
  @MainActor
  private func launchScanner(with options: VisionScannerOptions?) async throws {
    guard DataScannerViewController.isSupported, DataScannerViewController.isAvailable else {
      throw CameraScannerUnavailableException()
    }

    let delegate = VisionScannerDelegate(handler: self)
    scannerContext = ScannerContext(delegate: delegate)

    let symbologies = options?.toSymbology() ?? []
    let controller = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: symbologies)],
      isPinchToZoomEnabled: options?.isPinchToZoomEnabled ?? true,
      isGuidanceEnabled: options?.isGuidanceEnabled ?? true,
      isHighlightingEnabled: options?.isHighlightingEnabled ?? false
    )

    scannerContext?.controller = controller
    controller.delegate = delegate

    guard let currentViewController = appContext?.utilities?.currentViewController() else {
      throw InitScannerFailed()
    }

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      currentViewController.present(controller, animated: true) {
        guard controller.presentingViewController != nil else {
          continuation.resume(throwing: InitScannerFailed())
          return
        }

        do {
          try controller.startScanning()
          continuation.resume()
        } catch {
          controller.dismiss(animated: true) {
            continuation.resume(throwing: error)
          }
        }
      }
    }
  }

  @available(iOS 16.0, *)
  @MainActor
  private func dismissScanner() async {
    guard let controller = scannerContext?.controller as? DataScannerViewController else {
      return
    }
    controller.stopScanning()

    guard controller.presentingViewController != nil else {
      return
    }

    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      controller.dismiss(animated: true) {
        continuation.resume()
      }
    }
  }`;

function countOccurrences(content, fragment) {
    return content.split(fragment).length - 1;
}

function patchCameraModule(source, sourcePath) {
    const originalsMatch =
        countOccurrences(source, originalModuleFunctions) === 1
        && countOccurrences(source, originalPrivateFunctions) === 1;
    const patchedMatch =
        countOccurrences(source, patchedModuleFunctions) === 1
        && countOccurrences(source, patchedPrivateFunctions) === 1;

    if (patchedMatch && !originalsMatch) {
        return null;
    }

    if (!originalsMatch || patchedMatch) {
        throw new Error(
            `[patch] Expo Camera ${SUPPORTED_EXPO_CAMERA_VERSION} source does not match `
            + `the expected scanner transition implementation: ${sourcePath}`,
        );
    }

    return source
        .replace(originalModuleFunctions, patchedModuleFunctions)
        .replace(originalPrivateFunctions, patchedPrivateFunctions);
}

function applyExpoCameraScannerTransitionPatch({
    repositoryRoot = path.resolve(__dirname, '..'),
    log = console.log,
    warn = console.warn,
} = {}) {
    const nodeModulesRoots = [
        path.join(repositoryRoot, 'node_modules'),
        path.join(repositoryRoot, 'packages', 'happy-app', 'node_modules'),
    ];
    let found = 0;
    let patched = 0;

    for (const nodeModulesRoot of nodeModulesRoots) {
        const packageRoot = path.join(nodeModulesRoot, 'expo-camera');
        const packageJsonPath = path.join(packageRoot, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            continue;
        }
        found += 1;

        const { version } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (version !== SUPPORTED_EXPO_CAMERA_VERSION) {
            throw new Error(
                `[patch] Scanner transition patch supports expo-camera `
                + `${SUPPORTED_EXPO_CAMERA_VERSION}, found ${version} at ${packageRoot}`,
            );
        }

        const sourcePath = path.join(nodeModulesRoot, CAMERA_MODULE_RELATIVE_PATH);
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`[patch] expo-camera is missing ${sourcePath}`);
        }

        const source = fs.readFileSync(sourcePath, 'utf8');
        const updated = patchCameraModule(source, sourcePath);
        if (updated !== null) {
            fs.writeFileSync(sourcePath, updated, 'utf8');
            patched += 1;
        }
    }

    if (found === 0) {
        warn?.('[patch] expo-camera is not installed; scanner transition patch skipped');
    } else if (patched > 0) {
        log?.(`[patch] Await Expo Camera iOS scanner transitions (${patched} file(s))`);
    }

    return { found, patched };
}

if (require.main === module) {
    applyExpoCameraScannerTransitionPatch();
}

module.exports = {
    applyExpoCameraScannerTransitionPatch,
};
