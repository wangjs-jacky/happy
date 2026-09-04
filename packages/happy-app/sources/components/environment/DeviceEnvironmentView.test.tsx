import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer is only used for this component harness.
import TestRenderer from 'react-test-renderer';
import type { ComponentObservation, ComponentPlan } from '@slopus/happy-wire';
import type { DeviceEnvironmentController } from '@/hooks/useDeviceEnvironment';
import type { FleetRow } from '@/environment/fleetModel';
import type { Machine } from '@/sync/storageTypes';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), allMachines: vi.fn(), useController: vi.fn() }));
vi.mock('react-native', () => ({
    View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default },
}));
vi.mock('react-native-unistyles', async () => {
    const { appThemes } = await import('@/themePacks');
    return {
        StyleSheet: { hairlineWidth: 1, create: (factory: any) => factory(appThemes.ginghamDark, { insets: { top: 0 } }) },
        useUnistyles: () => ({ theme: appThemes.ginghamDark }),
    };
});
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 800 } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/components/haptics', () => ({ hapticsLight: vi.fn() }));
vi.mock('@/modal', () => ({ Modal: { confirm: mocks.confirm, alert: vi.fn() } }));
vi.mock('@/text', async () => {
    const { en } = await import('@/text/_default');
    return { t: (key: string, params?: unknown) => {
        const value = key.split('.').reduce((obj: any, part) => obj?.[part], en);
        return typeof value === 'function' ? value(params) : value ?? key;
    } };
});
vi.mock('@/sync/storage', () => ({ useAllMachines: mocks.allMachines }));
vi.mock('@/hooks/useDeviceEnvironment', () => ({ useDeviceEnvironment: mocks.useController }));

import { DeviceEnvironmentView } from './DeviceEnvironmentView';
import { appThemes } from '@/themePacks';

function machine(id: string, online = true): Machine {
    return { id, seq: 1, active: online, activeAt: 1, createdAt: 1, updatedAt: 1, metadataVersion: 1,
        metadata: null, daemonState: null, daemonStateVersion: 1 };
}
function observation(version: string | null = '2.80.0', auth: 'authenticated' | 'missing' | 'unknown' = 'authenticated'): ComponentObservation {
    return { componentId: 'github-cli', platform: 'darwin', architecture: 'arm64', support: 'supported',
        installed: version !== null, installedVersion: version, resolvedExecutable: version ? '/opt/homebrew/bin/gh' : null,
        packageManager: { kind: 'homebrew', available: true, stableVersion: '2.80.0' },
        authentication: { provider: 'github.com', status: auth }, inspectedAt: 1 };
}
function row(id: string, overrides: Partial<FleetRow> = {}): FleetRow {
    return { machine: machine(id), machineId: id, online: true, observation: observation(), status: 'ready', ...overrides };
}
function plan(action: ComponentPlan['action'], fromVersion: string | null): ComponentPlan {
    return { componentId: 'github-cli', action, fromVersion, targetVersion: '2.80.0',
        planFingerprint: 'a'.repeat(64), expiresAt: Date.now() + 60_000 };
}
function previewRows(): FleetRow[] {
    return [
        row('install-mac', { observation: observation(null, 'missing'), status: 'install', plan: plan('install', null) }),
        row('upgrade-mac', { observation: observation('2.79.0'), status: 'upgrade', plan: plan('upgrade', '2.79.0') }),
        row('ready-mac', { plan: plan('none', '2.80.0') }),
        row('offline-mac', { online: false, machine: machine('offline-mac', false), observation: undefined, status: 'offline' }),
    ];
}
function textOf(node: any): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    return (node?.children ?? []).map(textOf).join(' ');
}

describe('DeviceEnvironmentView', () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    let confirmation: { resolve(value: boolean): void };
    let controller: DeviceEnvironmentController;

    function renderEnvironmentView(state: Partial<DeviceEnvironmentController> = {}) {
        controller = { phase: 'scanned', rows: [row('mac')], target: { kind: 'ready', targetVersion: '2.80.0' },
            scan: vi.fn().mockResolvedValue(undefined), preview: vi.fn().mockResolvedValue(undefined),
            applyApproved: vi.fn().mockResolvedValue(undefined), reset: vi.fn(), ...state };
        act(() => { renderer = TestRenderer.create(<DeviceEnvironmentView controller={controller} />); });
        return renderer!;
    }
    async function press(id: string) {
        await act(async () => { renderer!.root.findByProps({ testID: id }).props.onPress(); });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        mocks.confirm.mockImplementation(() => new Promise<boolean>((resolve) => { confirmation = { resolve }; }));
    });
    afterEach(() => { act(() => renderer?.unmount()); });

    it('shows version readiness independently from authentication and includes offline machines', () => {
        const view = renderEnvironmentView({ rows: [row('auth'), row('missing', { observation: observation('2.80.0', 'missing'),
            status: 'manual-repair', reasonCode: 'authentication-missing' }),
        row('offline', { online: false, observation: undefined, status: 'offline' })] });
        expect(textOf(view.root.findByProps({ testID: 'environment-summary' }))).toContain('2/3');
        const ready = textOf(view.root.findByProps({ testID: 'environment-machine-auth' }));
        expect(ready).toContain('Daemon online');
        expect(ready).toContain('Installed: 2.80.0');
        expect(ready).toContain('Target: 2.80.0');
        expect(ready).toContain('GitHub authenticated');
        expect(textOf(view.root.findByProps({ testID: 'environment-machine-missing' }))).toContain('GitHub sign-in required');
        expect(textOf(view.root.findByProps({ testID: 'environment-machine-offline' }))).toContain('Daemon offline');
    });

    it('gives offline machines restore or SSH inspection guidance while keeping them skipped', () => {
        const view = renderEnvironmentView({ rows: [row('online'),
            row('offline', { machine: machine('offline', false), online: false, observation: undefined, status: 'offline' })] });
        const offline = view.root.findByProps({ testID: 'environment-machine-offline' });
        expect(textOf(offline)).toContain('Daemon offline — skipped');
        expect(textOf(offline)).toContain('Restore this machine’s connection, or use SSH to inspect it. Then scan again.');
        expect(offline.findAllByType('Text').filter((node: any) => node.props.selectable)).toHaveLength(0);
        expect(textOf(view.root.findByProps({ testID: 'environment-machine-online' }))).not.toContain('Restore this machine’s connection');
    });

    it.each(['unsupported-architecture', 'unsupported-platform'] as const)('states the Apple Silicon-only support boundary for %s', (reasonCode) => {
        const view = renderEnvironmentView({ rows: [row('unsupported', {
            observation: { ...observation(), platform: reasonCode === 'unsupported-platform' ? 'linux' : 'darwin',
                architecture: 'x64', support: 'unsupported', reasonCode },
            status: 'manual-repair', reasonCode,
        })] });
        const unsupported = textOf(view.root.findByProps({ testID: 'environment-machine-unsupported' }));
        expect(unsupported).not.toMatch(/Intel/i);
        expect(unsupported).toContain('requires an Apple Silicon Mac with Homebrew installed');
    });

    it('shows wait-then-rescan guidance only for rpc-timeout rows', () => {
        const view = renderEnvironmentView({ rows: [
            row('timeout', { status: 'rpc-timeout', reasonCode: 'rpc-timeout', requiresScan: true }),
            row('timeout-without-reason', { status: 'rpc-timeout', requiresScan: true }),
            row('healthy'),
            row('offline', { machine: machine('offline', false), online: false, observation: undefined, status: 'offline' }),
            row('error', { status: 'rpc-error', reasonCode: 'unexpected-error', requiresScan: true }),
            row('failed', { status: 'failed', reasonCode: 'install-failed', requiresScan: true }),
        ] });
        const guidance = 'Wait for Homebrew or the current operation to finish, then scan again before retrying.';
        for (const id of ['timeout', 'timeout-without-reason']) {
            const timeout = textOf(view.root.findByProps({ testID: `environment-machine-${id}` }));
            expect(timeout).toContain('State unknown; scan again');
            expect(timeout).toContain(guidance);
            expect(timeout).not.toMatch(/failed|did not complete/i);
        }
        for (const id of ['healthy', 'offline', 'error', 'failed']) {
            expect(textOf(view.root.findByProps({ testID: `environment-machine-${id}` }))).not.toContain(guidance);
        }
    });

    it('connects the registered fleet including offline machines without automatically scanning', () => {
        const fleet = [machine('online'), machine('offline', false)];
        mocks.allMachines.mockReturnValue(fleet);
        const scan = vi.fn();
        mocks.useController.mockReturnValue({ phase: 'idle', rows: [], target: { kind: 'unavailable' }, scan,
            preview: vi.fn(), applyApproved: vi.fn(), reset: vi.fn() });
        act(() => { renderer = TestRenderer.create(<DeviceEnvironmentView />); });
        expect(mocks.allMachines).toHaveBeenCalledWith({ includeOffline: true });
        expect(mocks.useController).toHaveBeenCalledWith(fleet);
        expect(scan).not.toHaveBeenCalled();
    });

    it('previews without applying, then requires explicit approval of exact machine actions', async () => {
        renderEnvironmentView({ rows: previewRows() });
        await press('environment-preview-alignment');
        expect(controller.preview).toHaveBeenCalledOnce();
        expect(controller.applyApproved).not.toHaveBeenCalled();
        expect(mocks.confirm).not.toHaveBeenCalled();
        controller = { ...controller, phase: 'previewed' };
        act(() => renderer!.update(<DeviceEnvironmentView controller={controller} />));
        await press('environment-confirm-alignment');
        const [title, message, options] = mocks.confirm.mock.calls[0];
        expect(title).toBe('Align GitHub CLI?');
        expect(message).toContain('install-mac: Install gh 2.80.0');
        expect(message).toContain('upgrade-mac: Upgrade gh 2.79.0 → 2.80.0');
        expect(message).toContain('ready-mac: No version change');
        expect(message).toContain('offline-mac: Daemon offline');
        expect(options).toMatchObject({ cancelText: 'Cancel', confirmText: 'Apply alignment' });
        expect(controller.applyApproved).not.toHaveBeenCalled();
        await act(async () => confirmation.resolve(false));
        expect(controller.applyApproved).not.toHaveBeenCalled();
        await press('environment-confirm-alignment');
        await act(async () => confirmation.resolve(true));
        expect(controller.applyApproved).toHaveBeenCalledOnce();
    });

    it('blocks a second confirmation and ignores approval after its fleet snapshot changes', async () => {
        renderEnvironmentView({ phase: 'previewed', rows: previewRows() });
        await act(async () => {
            const button = renderer!.root.findByProps({ testID: 'environment-confirm-alignment' });
            button.props.onPress();
            button.props.onPress();
        });
        expect(mocks.confirm).toHaveBeenCalledOnce();
        controller = { ...controller, phase: 'idle', rows: [] };
        act(() => renderer!.update(<DeviceEnvironmentView controller={controller} />));
        await act(async () => confirmation.resolve(true));
        expect(controller.applyApproved).not.toHaveBeenCalled();
    });

    it('confirms an all-aligned three-machine no-op broadcast only after explicit approval', async () => {
        renderEnvironmentView({ phase: 'previewed', rows: [
            row('aligned-one', { plan: plan('none', '2.80.0') }),
            row('aligned-two', { plan: plan('none', '2.80.0') }),
            row('aligned-three', { plan: plan('none', '2.80.0') }),
        ] });
        expect(renderer!.root.findByProps({ testID: 'environment-confirm-alignment' }).props.disabled).toBe(false);
        await press('environment-confirm-alignment');
        const message = mocks.confirm.mock.calls[0][1];
        expect(message).toContain('aligned-one: No version change');
        expect(message).toContain('aligned-two: No version change');
        expect(message).toContain('aligned-three: No version change');
        expect(controller.applyApproved).not.toHaveBeenCalled();
        await act(async () => confirmation.resolve(false));
        expect(controller.applyApproved).not.toHaveBeenCalled();

        await act(async () => {
            const button = renderer!.root.findByProps({ testID: 'environment-confirm-alignment' });
            button.props.onPress();
            button.props.onPress();
        });
        expect(mocks.confirm).toHaveBeenCalledTimes(2);
        await act(async () => confirmation.resolve(true));
        expect(controller.applyApproved).toHaveBeenCalledOnce();
    });

    it.each([
        ['no plans', () => [row('unplanned')]],
        ['offline only', () => [row('offline', { online: false, status: 'offline', plan: plan('none', '2.80.0') })]],
        ['manual repair only', () => [row('manual', { status: 'manual-repair', plan: plan('manual-repair', '2.79.0') })]],
        ['ineligible no-op', () => [row('manual-noop', { status: 'manual-repair', plan: plan('none', '2.80.0'), reasonCode: 'authentication-missing' })]],
        ['error only', () => [row('error', { status: 'rpc-error', plan: plan('none', '2.80.0') })]],
        ['unsupported only', () => [row('unsupported', { observation: { ...observation(), support: 'unsupported' }, plan: plan('none', '2.80.0') })]],
    ] as const)('keeps confirmation disabled for %s', async (_name, rows) => {
        renderEnvironmentView({ phase: 'previewed', rows: rows() });
        expect(renderer!.root.findByProps({ testID: 'environment-confirm-alignment' }).props.disabled).toBe(true);
        await press('environment-confirm-alignment');
        expect(mocks.confirm).not.toHaveBeenCalled();
        expect(controller.applyApproved).not.toHaveBeenCalled();
    });

    it.each(['scanning', 'previewing', 'applying'] as const)('disables all duplicate actions during %s', async (phase) => {
        renderEnvironmentView({ phase, rows: previewRows() });
        for (const id of ['environment-scan-all', 'environment-preview-alignment', 'environment-confirm-alignment']) {
            expect(renderer!.root.findByProps({ testID: id }).props.disabled).toBe(true);
            await press(id);
        }
        expect(controller.scan).not.toHaveBeenCalled();
        expect(controller.preview).not.toHaveBeenCalled();
        expect(mocks.confirm).not.toHaveBeenCalled();
        expect(controller.applyApproved).not.toHaveBeenCalled();
    });

    it('preserves mixed results and presents timeout as unknown with scan guidance', () => {
        const after = observation();
        const unchanged = observation('2.79.0');
        const notInstalled = observation(null, 'missing');
        const view = renderEnvironmentView({ phase: 'completed', rows: [
            row('done', { status: 'succeeded', result: { componentId: 'github-cli', status: 'succeeded', before: observation('2.79.0'), after, changed: true } }),
            row('repair', { status: 'failed', observation: unchanged, reasonCode: 'verification-failed', result: { componentId: 'github-cli', status: 'failed', before: unchanged, after: unchanged, changed: false,
                repairGuide: { channel: 'ssh', reasonCode: 'verification-failed', commands: ['gh --version'] } } }),
            row('install-repair', { status: 'failed', observation: notInstalled, reasonCode: 'install-failed', result: { componentId: 'github-cli', status: 'failed', before: notInstalled, after: notInstalled, changed: false } }),
            row('timeout', { status: 'rpc-timeout', reasonCode: 'rpc-timeout', requiresScan: true }),
        ] });
        expect(textOf(view.root.findByProps({ testID: 'environment-machine-done' }))).toContain('Completed');
        expect(textOf(view.root.findByProps({ testID: 'environment-machine-done' }))).toContain('Upgrade gh 2.79.0 → 2.80.0');
        const repair = textOf(view.root.findByProps({ testID: 'environment-machine-repair' }));
        expect(repair).toContain('Alignment did not complete');
        expect(repair).toContain('Upgrade gh 2.79.0 → 2.80.0');
        expect(repair).toContain('gh --version');
        const installRepair = textOf(view.root.findByProps({ testID: 'environment-machine-install-repair' }));
        expect(installRepair).toContain('Alignment did not complete');
        expect(installRepair).toContain('Install gh 2.80.0');
        const timeout = textOf(view.root.findByProps({ testID: 'environment-machine-timeout' }));
        expect(timeout).toContain('State unknown; scan again');
        expect(timeout).not.toMatch(/failed/i);
        expect(textOf(view.root)).toContain('Some machines still need attention');
    });

    it('blocks alignment when version sources disagree', async () => {
        renderEnvironmentView({ phase: 'previewed', rows: previewRows(), target: { kind: 'blocked', reasonCode: 'version-source-mismatch' } });
        expect(textOf(renderer!.root)).toContain('Version sources disagree');
        expect(renderer!.root.findByProps({ testID: 'environment-confirm-alignment' }).props.disabled).toBe(true);
        await press('environment-confirm-alignment');
        expect(mocks.confirm).not.toHaveBeenCalled();
    });

    it('uses ginghamDark semantic resting, pressed, hover, and focus surfaces', () => {
        renderEnvironmentView();
        const button = renderer!.root.findAllByType('Pressable').find((node: any) => node.props.testID === 'environment-scan-all');
        function background(pressed: boolean) {
            return Object.assign({}, ...button.props.style({ pressed }).flat()).backgroundColor;
        }
        expect(background(false)).toBe(appThemes.ginghamDark.colors.surface);
        expect(background(true)).toBe(appThemes.ginghamDark.colors.surfacePressed);
        act(() => button.props.onHoverIn());
        expect(background(false)).toBe(appThemes.ginghamDark.colors.surfacePressed);
        act(() => { button.props.onHoverOut(); button.props.onFocus(); });
        expect(background(false)).toBe(appThemes.ginghamDark.colors.surfaceSelected);
    });

    it('clears Scan focus across disabled scanning even when no blur event arrives', async () => {
        renderEnvironmentView();
        const button = (id: string) => renderer!.root.findAllByType('Pressable')
            .find((node: any) => node.props.testID === id);
        const scan = button('environment-scan-all');
        const preview = button('environment-preview-alignment');
        const background = (node: any) => Object.assign({}, ...node.props.style({ pressed: false }).flat()).backgroundColor;

        act(() => scan.props.onFocus());
        expect(background(scan)).toBe(appThemes.ginghamDark.colors.surfaceSelected);
        await act(async () => {
            scan.props.onPress();
            controller = { ...controller, phase: 'scanning' };
            renderer!.update(<DeviceEnvironmentView controller={controller} />);
        });
        expect(controller.scan).toHaveBeenCalledOnce();
        expect(scan.props.disabled).toBe(true);
        expect(background(scan)).toBe(appThemes.ginghamDark.colors.surface);

        // A focused web control can be disabled without its blur callback firing.
        // Re-enabling must not revive that obsolete focus after Tab moves elsewhere.
        controller = { ...controller, phase: 'scanned' };
        act(() => renderer!.update(<DeviceEnvironmentView controller={controller} />));
        act(() => preview.props.onFocus());
        expect(background(scan)).toBe(appThemes.ginghamDark.colors.surface);
        expect(background(preview)).toBe(appThemes.ginghamDark.colors.surfaceSelected);
        act(() => preview.props.onBlur());
        expect(background(scan)).toBe(appThemes.ginghamDark.colors.surface);
        expect(background(preview)).toBe(appThemes.ginghamDark.colors.surface);
    });
});
