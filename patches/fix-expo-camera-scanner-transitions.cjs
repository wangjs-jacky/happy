/**
 * Expo Camera 55.0.10 resolves the iOS modern-scanner methods as soon as it
 * schedules UIKit presentation/dismissal. That lets JS launch a replacement
 * scanner while the previous animated transition is still in flight.
 *
 * Keep the JS promises pending until the corresponding UIKit completion
 * handlers run. UIKit can omit those callbacks when it rejects a transition,
 * so a native single-settlement watchdog rejects and cleans up stalled work.
 * This patch is intentionally version- and source-pinned so an Expo Camera
 * upgrade cannot silently ship without revalidating the bridge.
 */
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_EXPO_CAMERA_VERSION = '55.0.10';
const CAMERA_MODULE_RELATIVE_PATH = 'expo-camera/ios/CameraViewModule.swift';

const originalSupportTypes = `struct ScannerContext {
  var controller: Any?
  var delegate: Any?
}`;

const patchedSupportTypes = `struct ScannerContext {
  var controller: Any?
  var delegate: Any?
}

@MainActor
private final class ScannerTransitionCoordinator {
  private var continuation: CheckedContinuation<Void, Error>?
  private var watchdog: Task<Void, Never>?

  init(continuation: CheckedContinuation<Void, Error>) {
    self.continuation = continuation
  }

  var isPending: Bool {
    continuation != nil
  }

  func armWatchdog(
    afterNanoseconds timeout: UInt64 = 2_000_000_000,
    onTimeout: @escaping @MainActor () -> Void
  ) {
    watchdog?.cancel()
    watchdog = Task { @MainActor [self] in
      try? await Task.sleep(nanoseconds: timeout)
      guard !Task.isCancelled, self.isPending else {
        return
      }
      onTimeout()
      self.reject(InitScannerFailed())
    }
  }

  @discardableResult
  func resolve() -> Bool {
    settle(with: .success(()))
  }

  @discardableResult
  func reject(_ error: Error) -> Bool {
    settle(with: .failure(error))
  }

  private func settle(with result: Result<Void, Error>) -> Bool {
    guard let continuation else {
      return false
    }
    self.continuation = nil
    watchdog?.cancel()
    watchdog = nil

    switch result {
    case .success:
      continuation.resume()
    case .failure(let error):
      continuation.resume(throwing: error)
    }
    return true
  }
}`;

const previousPatchedSupportTypes = patchedSupportTypes
    .replace('Task { @MainActor [self] in', 'Task { @MainActor [weak self] in')
    .replace(
        'guard !Task.isCancelled, self.isPending else {',
        'guard !Task.isCancelled, let self, self.isPending else {',
    );

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

const intermediatePrivateFunctions = `  @available(iOS 16.0, *)
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

const patchedPrivateFunctions = `  @available(iOS 16.0, *)
  @MainActor
  private func launchScanner(with options: VisionScannerOptions?) async throws {
    guard DataScannerViewController.isSupported, DataScannerViewController.isAvailable else {
      throw CameraScannerUnavailableException()
    }

    let delegate = VisionScannerDelegate(handler: self)
    let symbologies = options?.toSymbology() ?? []
    let controller = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: symbologies)],
      isPinchToZoomEnabled: options?.isPinchToZoomEnabled ?? true,
      isGuidanceEnabled: options?.isGuidanceEnabled ?? true,
      isHighlightingEnabled: options?.isHighlightingEnabled ?? false
    )
    controller.delegate = delegate

    guard let currentViewController = appContext?.utilities?.currentViewController(),
          currentViewController.viewIfLoaded?.window != nil,
          !currentViewController.isBeingPresented,
          !currentViewController.isBeingDismissed,
          currentViewController.transitionCoordinator == nil,
          currentViewController.presentedViewController == nil else {
      throw InitScannerFailed()
    }

    scannerContext = ScannerContext(controller: controller, delegate: delegate)

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      let transition = ScannerTransitionCoordinator(continuation: continuation)
      transition.armWatchdog { [weak self, weak controller] in
        guard let self, let controller else {
          return
        }
        controller.stopScanning()
        if controller.presentingViewController != nil {
          controller.dismiss(animated: false)
        }
        self.clearScannerContext(for: controller)
      }

      currentViewController.present(controller, animated: true) { [weak self, weak controller] in
        guard let self, let controller else {
          transition.reject(InitScannerFailed())
          return
        }
        guard transition.isPending else {
          controller.stopScanning()
          if controller.presentingViewController != nil {
            controller.dismiss(animated: false)
          }
          self.clearScannerContext(for: controller)
          return
        }
        guard controller.presentingViewController != nil else {
          self.clearScannerContext(for: controller)
          transition.reject(InitScannerFailed())
          return
        }

        do {
          try controller.startScanning()
          guard transition.resolve() else {
            controller.stopScanning()
            if controller.presentingViewController != nil {
              controller.dismiss(animated: false)
            }
            self.clearScannerContext(for: controller)
            return
          }
        } catch {
          controller.dismiss(animated: true) { [weak self, weak controller] in
            if let self, let controller {
              self.clearScannerContext(for: controller)
            }
            transition.reject(error)
          }
        }
      }

      guard controller.presentingViewController != nil else {
        clearScannerContext(for: controller)
        transition.reject(InitScannerFailed())
        return
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
      clearScannerContext(for: controller)
      return
    }

    try? await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      let transition = ScannerTransitionCoordinator(continuation: continuation)
      transition.armWatchdog { [weak self, weak controller] in
        guard let self, let controller else {
          return
        }
        if controller.presentingViewController != nil {
          controller.dismiss(animated: false)
        }
        self.clearScannerContext(for: controller)
      }

      controller.dismiss(animated: true) { [weak self, weak controller] in
        if let self, let controller {
          self.clearScannerContext(for: controller)
        }
        transition.resolve()
      }
    }
  }

  @available(iOS 16.0, *)
  @MainActor
  private func clearScannerContext(for controller: DataScannerViewController) {
    guard scannerContext?.controller as? DataScannerViewController === controller else {
      return
    }
    scannerContext = nil
  }`;

function countOccurrences(content, fragment) {
    return content.split(fragment).length - 1;
}

function patchCameraModule(source, sourcePath) {
    const originalSupportMatches = countOccurrences(source, originalSupportTypes) === 1;
    const previousPatchedSupportMatches = countOccurrences(source, previousPatchedSupportTypes) === 1;
    const patchedSupportMatches = countOccurrences(source, patchedSupportTypes) === 1;
    const originalModuleMatches = countOccurrences(source, originalModuleFunctions) === 1;
    const patchedModuleMatches = countOccurrences(source, patchedModuleFunctions) === 1;
    const originalPrivateMatches = countOccurrences(source, originalPrivateFunctions) === 1;
    const intermediatePrivateMatches = countOccurrences(source, intermediatePrivateFunctions) === 1;
    const patchedPrivateMatches = countOccurrences(source, patchedPrivateFunctions) === 1;

    if (patchedSupportMatches && patchedModuleMatches && patchedPrivateMatches) {
        return null;
    }

    if (previousPatchedSupportMatches && patchedModuleMatches && patchedPrivateMatches) {
        return source.replace(previousPatchedSupportTypes, patchedSupportTypes);
    }

    if (originalSupportMatches && originalModuleMatches && originalPrivateMatches) {
        return source
            .replace(originalSupportTypes, patchedSupportTypes)
            .replace(originalModuleFunctions, patchedModuleFunctions)
            .replace(originalPrivateFunctions, patchedPrivateFunctions);
    }

    if (originalSupportMatches && patchedModuleMatches && intermediatePrivateMatches) {
        return source
            .replace(originalSupportTypes, patchedSupportTypes)
            .replace(intermediatePrivateFunctions, patchedPrivateFunctions);
    }

    throw new Error(
        `[patch] Expo Camera ${SUPPORTED_EXPO_CAMERA_VERSION} source does not match `
        + `the expected scanner transition implementation: ${sourcePath}`,
    );
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
    const updates = [];

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
            updates.push({ sourcePath, updated });
        }
    }

    for (const { sourcePath, updated } of updates) {
        fs.writeFileSync(sourcePath, updated, 'utf8');
    }

    const patched = updates.length;

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
