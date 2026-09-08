import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer is only used for this component harness.
import TestRenderer from 'react-test-renderer';
import type { ComponentObservation, ComponentPlan, EnvironmentComponentId } from '@slopus/happy-wire';
import type { FleetComponentRow, FleetRow } from '@/environment/fleetModel';
import { buildFleetRows, fleetComponents, FLEET_COMPONENT_IDS } from '@/environment/fleetModel';
import type { DeviceEnvironmentController } from '@/hooks/useDeviceEnvironment';
import type { Machine } from '@/sync/storageTypes';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), allMachines: vi.fn(), useController: vi.fn(), windowWidth: 1440 }));
vi.mock('react-native', () => ({
    View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
    useWindowDimensions: () => ({ width: mocks.windowWidth, height: 900, scale: 1, fontScale: 1 }),
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

function machine(id: string, online = true): Machine {
    return { id, seq: 1, active: online, activeAt: 1, createdAt: 1, updatedAt: 1, metadataVersion: 1,
        metadata: null, daemonState: null, daemonStateVersion: 1 };
}

function observation(componentId: EnvironmentComponentId, overrides: Partial<ComponentObservation> = {}): ComponentObservation {
    const common = { platform: 'darwin', architecture: 'arm64', support: 'supported' as const, installed: true,
        installedVersion: '1.0.0', resolvedExecutable: `/opt/homebrew/bin/${componentId}`, source: {
            kind: 'homebrew' as const, available: true, latestVersion: '1.0.0', ownership: 'verified' as const,
        }, inspectedAt: 1 };
    switch (componentId) {
        case 'github-cli': return { ...common, componentId, installedVersion: '2.80.0', source: { ...common.source, latestVersion: '2.80.0' },
            capability: 'alignable', details: { kind: componentId }, authentication: { provider: 'github.com', status: 'authenticated' }, ...overrides } as ComponentObservation;
        case 'paws-cli': return { ...common, componentId, source: { kind: 'npm-global', available: true, latestVersion: '1.1.0', ownership: 'verified' },
            capability: 'alignable', details: { kind: componentId }, ...overrides } as ComponentObservation;
        case 'ego-browser': return { ...common, componentId, capability: 'inspect-only', details: {
            kind: componentId, appVersion: '1.0.0', chromiumVersion: '128.0.0', nodeVersion: '22.0.0', pathReady: true, paired: true,
        }, ...overrides } as ComponentObservation;
        case 'cloudflare-wrangler': return { ...common, componentId, source: { kind: 'npm-global', available: true, latestVersion: '4.1.0', ownership: 'unverified' },
            capability: 'inspect-only', details: { kind: componentId }, authentication: { provider: 'cloudflare', status: 'authenticated', accountLabels: ['Team Alpha'] }, ...overrides } as ComponentObservation;
        case 'cloudflared': return { ...common, componentId, installedVersion: '2026.1.0', source: { ...common.source, latestVersion: '2026.2.0' },
            capability: 'inspect-only', details: { kind: componentId, tunnelCertificatePresent: true }, ...overrides } as ComponentObservation;
    }
}

function component(componentId: EnvironmentComponentId, overrides: Partial<FleetComponentRow> = {}): FleetComponentRow {
    return { componentId, status: 'ready', observation: observation(componentId), ...overrides };
}

function row(id: string, componentOverrides: Partial<Record<EnvironmentComponentId, Partial<FleetComponentRow>>> = {}, online = true): FleetRow {
    return { machine: machine(id, online), machineId: id, online, components: fleetComponents((componentId) => component(componentId, {
        ...componentOverrides[componentId],
        ...(!online ? { status: 'offline', reasonCode: 'machine-offline', observation: undefined } : {}),
    })) };
}

function plan(componentId: 'github-cli' | 'paws-cli', action: ComponentPlan['action'], fromVersion: string | null, targetVersion: string): ComponentPlan {
    return { componentId, action, fromVersion, targetVersion, planFingerprint: 'a'.repeat(64), expiresAt: Date.now() + 60_000 };
}

function textOf(node: any): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    return (node?.children ?? []).map(textOf).join(' ');
}

function flattenedStyle(style: any): Record<string, unknown> {
    if (!Array.isArray(style)) return style && typeof style === 'object' ? style : {};
    return Object.assign({}, ...style.map(flattenedStyle));
}

describe('DeviceEnvironmentView', () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    let confirmation: { resolve(value: boolean): void };
    let controller: DeviceEnvironmentController;

    function renderEnvironmentView(state: Partial<DeviceEnvironmentController> = {}) {
        const target = { kind: 'ready' as const, targetVersion: '2.80.0' };
        controller = { phase: 'scanned', rows: [row('mac')], target, targets: { 'github-cli': target, 'paws-cli': { kind: 'ready', targetVersion: '1.1.0' } },
            selectedComponent: 'github-cli', selectComponent: vi.fn(), scan: vi.fn().mockResolvedValue(undefined),
            preview: vi.fn().mockResolvedValue(undefined), applyApproved: vi.fn().mockResolvedValue(undefined), reset: vi.fn(), ...state };
        act(() => { renderer = TestRenderer.create(<DeviceEnvironmentView controller={controller} />); });
        return renderer!;
    }
    async function press(id: string) {
        await act(async () => { renderer!.root.findByProps({ testID: id }).props.onPress(); });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.windowWidth = 1440;
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        mocks.confirm.mockImplementation(() => new Promise<boolean>((resolve) => { confirmation = { resolve }; }));
    });
    afterEach(() => { act(() => renderer?.unmount()); });

    it.each([
        ['path', { pathReady: false }, {}, 'Add ~/.local/bin to PATH'],
        ['cli', {}, { installed: false, installedVersion: null }, 'Ego CLI is missing'],
        ['app', { appVersion: null }, {}, 'Ego Lite app is missing'],
        ['platform', { appVersion: null }, { support: 'unsupported', platform: 'linux', reasonCode: 'unsupported-platform' }, 'Ego Lite app checks require macOS'],
    ])('shows the specific Ego %s readiness failure after scan conversion', (_name, detailPatch, patch, expected) => {
        const ego = observation('ego-browser', patch as Partial<ComponentObservation>);
        if (ego.details.kind !== 'ego-browser') throw new Error('incorrect fixture');
        ego.details = { ...ego.details, pathReady: true, paired: false, ...detailPatch };
        const rows = buildFleetRows([machine('ego')], [{ status: 'fulfilled', value: {
            machineId: 'ego', online: true, observations: [ego],
        } }]);
        const view = renderEnvironmentView({ rows });
        const text = textOf(view.root.findByProps({ testID: 'environment-component-ego-ego-browser' }));
        expect(text).toContain(expected);
        expect(text).not.toContain('versions do not match');
        expect(text).not.toContain('Homebrew');
        expect(text).toContain('Needs attention');
    });

    it('renders a daemon read timeout as unknown through real scan conversion', () => {
        const rows = buildFleetRows([machine('timeout')], [{ status: 'fulfilled', value: {
            machineId: 'timeout', online: true,
            observations: [observation('paws-cli', { reasonCode: 'process-timeout' })],
        } }]);
        const view = renderEnvironmentView({ rows });
        const text = textOf(view.root.findByProps({ testID: 'environment-component-timeout-paws-cli' }));
        expect(text).toContain('Unknown');
        expect(text).not.toContain('Manual repair required');
        expect(text).not.toContain('Wait for npm');
    });

    it('does not confuse a failed Ego probe with an unsupported platform', () => {
        const rows = buildFleetRows([machine('failure')], [{ status: 'fulfilled', value: {
            machineId: 'failure', online: true, observations: [observation('ego-browser', {
                support: 'unsupported', installed: false, installedVersion: null, resolvedExecutable: null,
                source: { kind: 'none', available: false, latestVersion: null, ownership: 'not-applicable' },
                reasonCode: 'unexpected-error', details: { kind: 'ego-browser', appVersion: null,
                    chromiumVersion: null, nodeVersion: null, pathReady: false, paired: false },
            })],
        } }]);
        const view = renderEnvironmentView({ rows });
        const text = textOf(view.root.findByProps({ testID: 'environment-component-failure-ego-browser' }));
        expect(text).toContain('State unknown; scan again');
        expect(text).not.toContain('app checks require macOS');
        expect(text).toContain('Installed: Unknown');
        expect(text).not.toContain('Needs attention');
    });

    it.each(['missing', 'unknown'] as const)('does not count GitHub at target as ready when authentication is %s', (status) => {
        const rows = buildFleetRows([machine('github')], [{ status: 'fulfilled', value: {
            machineId: 'github', online: true,
            observations: [observation('github-cli', { authentication: { provider: 'github.com', status } })],
        } }]);
        const view = renderEnvironmentView({ rows });
        expect(textOf(view.root.findByProps({ testID: 'environment-component-github-github-cli' }))).toContain('Needs attention');
        expect(textOf(view.root.findByProps({ testID: 'environment-summary' }))).toContain('0/5');
    });

    it.each(['pending', 'rpc-error'] as const)('renders absent %s installation observations as unknown', (status) => {
        const rows = status === 'pending' ? [row('absent', { 'paws-cli': { status, observation: undefined } })]
            : buildFleetRows([machine('absent')], [{ status: 'rejected', reason: new Error('disconnected') }]);
        const view = renderEnvironmentView({ rows });
        const text = textOf(view.root.findByProps({ testID: 'environment-component-absent-paws-cli' }));
        expect(text).toContain('Installed: Unknown');
        expect(text).not.toContain('Not installed');
    });

    it.each([
        ['paws-cli', 'unsupported-platform', 'Paws CLI alignment requires an Apple Silicon Mac'],
        ['cloudflared', 'formula-unavailable', 'cloudflared formula is unavailable'],
        ['ego-browser', 'version-source-mismatch', 'Ego Lite and CLI versions do not match'],
    ] as const)('keeps %s repair copy specific to its component', (componentId, reasonCode, expected) => {
        const view = renderEnvironmentView({ rows: [row('repair', { [componentId]: {
            status: 'manual-repair', reasonCode, observation: observation(componentId, { reasonCode }),
        } })] });
        const text = textOf(view.root.findByProps({ testID: `environment-component-repair-${componentId}` }));
        expect(text).toContain(expected);
        expect(text).not.toMatch(/gh formula|Refresh Homebrew|Mac with Homebrew/);
    });

    it('shows safe local Paws ownership commands before any apply', () => {
        const view = renderEnvironmentView({ rows: [row('paws', { 'paws-cli': { observation: observation('paws-cli', {
            capability: 'inspect-only', reasonCode: 'version-source-mismatch',
            source: { kind: 'npm-global', available: true, latestVersion: '1.1.0', ownership: 'unverified' },
        }) } })] });
        const text = textOf(view.root.findByProps({ testID: 'environment-component-paws-paws-cli' }));
        expect(text).toContain('command -v paws');
        expect(text).toContain('paws --version');
        expect(text).toContain('npm prefix -g');
        expect(text).not.toContain('brew info gh');
    });

    it('omits inspect-only Paws machines from the mixed-fleet confirmation', async () => {
        const target = { kind: 'ready' as const, targetVersion: '1.1.0' };
        renderEnvironmentView({ phase: 'previewed', selectedComponent: 'paws-cli', target,
            rows: [row('verified', { 'paws-cli': { status: 'upgrade', plan: plan('paws-cli', 'upgrade', '1.0.0', '1.1.0') } }),
                row('unverified', { 'paws-cli': { observation: observation('paws-cli', {
                    capability: 'inspect-only', reasonCode: 'version-source-mismatch',
                    source: { kind: 'npm-global', available: true, latestVersion: '1.1.0', ownership: 'unverified' },
                }) } })] });
        await press('environment-confirm-alignment');
        expect(mocks.confirm.mock.calls[0][1]).toContain('verified: Upgrade Paws CLI 1.0.0 → 1.1.0');
        expect(mocks.confirm.mock.calls[0][1]).not.toContain('unverified:');
        await act(async () => confirmation.resolve(false));
    });

    it('omits offline machines from the Paws confirmation action list', async () => {
        const target = { kind: 'ready' as const, targetVersion: '1.1.0' };
        renderEnvironmentView({ phase: 'previewed', selectedComponent: 'paws-cli', target,
            rows: [row('verified', { 'paws-cli': { status: 'upgrade', plan: plan('paws-cli', 'upgrade', '1.0.0', '1.1.0') } }),
                row('offline', {}, false)] });
        await press('environment-confirm-alignment');
        expect(mocks.confirm.mock.calls[0][1]).toContain('verified: Upgrade Paws CLI 1.0.0 → 1.1.0');
        expect(mocks.confirm.mock.calls[0][1]).not.toContain('offline:');
        await act(async () => confirmation.resolve(false));
    });

    it('ENV-01 renders every component in registry order and keeps offline machines skipped', () => {
        const view = renderEnvironmentView({ rows: [row('online'), row('offline', {}, false)] });
        for (const machineId of ['online', 'offline']) {
            expect(view.root.findByProps({ testID: `environment-machine-${machineId}` })).toBeDefined();
            for (const componentId of FLEET_COMPONENT_IDS) {
                expect(view.root.findByProps({ testID: `environment-component-${machineId}-${componentId}` })).toBeDefined();
            }
        }
        const offline = textOf(view.root.findByProps({ testID: 'environment-component-offline-github-cli' }));
        expect(offline).toContain('Daemon offline — skipped');
    });

    it('ENV-02 shows Paws installed and npm latest versions without an authentication flow', () => {
        const view = renderEnvironmentView({ rows: [row('paws', { 'paws-cli': { observation: observation('paws-cli', {
            installedVersion: '1.0.0', source: { kind: 'npm-global', available: true, latestVersion: '1.1.0', ownership: 'verified' },
        }) } })] });
        const paws = textOf(view.root.findByProps({ testID: 'environment-component-paws-paws-cli' }));
        expect(paws).toContain('Installed: 1.0.0');
        expect(paws).toContain('Latest: 1.1.0');
        expect(paws).not.toMatch(/authentication unknown|sign-in required/i);
    });

    it('ENV-03 selects verified Paws for component-scoped preview and manual guidance stays non-actionable', async () => {
        renderEnvironmentView({ rows: [row('verified')], selectedComponent: 'paws-cli', target: { kind: 'ready', targetVersion: '1.1.0' } });
        await press('environment-preview-alignment');
        expect(controller.preview).toHaveBeenCalledWith('paws-cli');
        const manual = renderEnvironmentView({ rows: [row('manual', { 'paws-cli': {
            status: 'manual-repair', reasonCode: 'version-source-mismatch', observation: observation('paws-cli', {
                source: { kind: 'npm-global', available: true, latestVersion: '1.1.0', ownership: 'unverified' },
            }),
        } })] });
        expect(textOf(manual.root.findByProps({ testID: 'environment-component-manual-paws-cli' }))).toContain('Manual repair required');
        expect(manual.root.findAll((node: any) => node.props.testID === 'environment-select-paws-cli')).toHaveLength(0);
    });

    it('ENV-04 shows Ego Lite, CLI, Chromium, Node, and a pairing mismatch', () => {
        const view = renderEnvironmentView({ rows: [row('ego', { 'ego-browser': { observation: observation('ego-browser', {
            installedVersion: '1.2.0', source: { kind: 'app-managed', available: true, latestVersion: '1.3.0', ownership: 'not-applicable' },
            details: { kind: 'ego-browser', appVersion: '1.3.0', chromiumVersion: '128.0.0', nodeVersion: '22.0.0', pathReady: true, paired: false }, reasonCode: 'version-source-mismatch',
        }), status: 'manual-repair', reasonCode: 'version-source-mismatch' } })] });
        const ego = textOf(view.root.findByProps({ testID: 'environment-component-ego-ego-browser' }));
        for (const value of ['Ego Lite: 1.3.0', 'Ego CLI: 1.2.0', 'Chromium: 128.0.0', 'Node: 22.0.0', 'do not match']) expect(ego).toContain(value);
    });

    it('ENV-05 shows only sanitized Wrangler account labels and authentication state', () => {
        const view = renderEnvironmentView({ rows: [row('wrangler', { 'cloudflare-wrangler': { observation: observation('cloudflare-wrangler', {
            authentication: { provider: 'cloudflare', status: 'authenticated', accountLabels: ['Team Alpha', 'Preview Lab'] },
        }) } })] });
        const wrangler = textOf(view.root.findByProps({ testID: 'environment-component-wrangler-cloudflare-wrangler' }));
        expect(wrangler).toContain('Cloudflare authenticated');
        expect(wrangler).toContain('Team Alpha, Preview Lab');
        expect(wrangler).not.toMatch(/token|cookie|@[\w.-]+|[a-f0-9]{32}/i);
    });

    it('ENV-06 distinguishes a present cloudflared tunnel certificate without claiming tunnel health', () => {
        const view = renderEnvironmentView();
        const cloudflared = textOf(view.root.findByProps({ testID: 'environment-component-mac-cloudflared' }));
        expect(cloudflared).toContain('Installed: 2026.1.0');
        expect(cloudflared).toContain('Tunnel login certificate present');
        expect(cloudflared).not.toMatch(/tunnel healthy|tunnel connected/i);
    });

    it('ENV-07 isolates a component timeout while keeping sibling observations visible', () => {
        const view = renderEnvironmentView({ rows: [row('partial', { 'ego-browser': {
            status: 'process-timeout', reasonCode: 'process-timeout', requiresScan: true, observation: undefined,
        } })] });
        expect(textOf(view.root.findByProps({ testID: 'environment-component-partial-ego-browser' }))).toContain('State unknown; scan again');
        const cloudflared = textOf(view.root.findByProps({ testID: 'environment-component-partial-cloudflared' }));
        expect(cloudflared).toContain('Tunnel login certificate present');
        expect(cloudflared).toContain('Inspection only');
    });

    it('ENV-08 preserves GitHub confirmation and excludes inspect-only components from controls and dialog', async () => {
        renderEnvironmentView({ phase: 'previewed', rows: [row('github', { 'github-cli': {
            status: 'upgrade', plan: plan('github-cli', 'upgrade', '2.79.0', '2.80.0'), observation: observation('github-cli', { installedVersion: '2.79.0' }),
        } })] });
        await press('environment-confirm-alignment');
        const [title, message] = mocks.confirm.mock.calls[0];
        expect(title).toBe('Align GitHub CLI?');
        expect(message).toContain('github: Upgrade gh 2.79.0 → 2.80.0');
        expect(message).not.toMatch(/Ego|Wrangler|cloudflared/i);
        for (const componentId of ['ego-browser', 'cloudflare-wrangler', 'cloudflared']) {
            expect(renderer!.root.findAll((node: any) => node.props.testID === `environment-select-${componentId}`)).toHaveLength(0);
        }
        await act(async () => confirmation.resolve(true));
        expect(controller.applyApproved).toHaveBeenCalledWith('github-cli');
    });

    it('uses each component target for pre-preview warnings and verified successful applies', () => {
        const outdated = row('versions', {
            'github-cli': { observation: observation('github-cli', { installedVersion: '2.79.0' }) },
            'paws-cli': { observation: observation('paws-cli', { installedVersion: '1.0.0' }) },
        });
        const view = renderEnvironmentView({ rows: [outdated] });
        expect(textOf(view.root.findByProps({ testID: 'environment-component-versions-github-cli' }))).toContain('Needs attention');
        expect(textOf(view.root.findByProps({ testID: 'environment-component-versions-paws-cli' }))).toContain('Needs attention');
        expect(textOf(view.root.findByProps({ testID: 'environment-summary' }))).toContain('3/5');

        const before = observation('github-cli', { installedVersion: '2.79.0' });
        const after = observation('github-cli', { installedVersion: '2.80.0' });
        const applied = row('versions', {
            'github-cli': { status: 'succeeded', observation: before, result: { componentId: 'github-cli', status: 'succeeded', before, after, changed: true } },
            'paws-cli': { observation: observation('paws-cli', { installedVersion: '1.0.0' }) },
        });
        controller = { ...controller, phase: 'completed', rows: [applied] };
        act(() => renderer!.update(<DeviceEnvironmentView controller={controller} />));
        expect(textOf(renderer!.root.findByProps({ testID: 'environment-component-versions-github-cli' }))).toContain('Ready');
        expect(textOf(renderer!.root.findByProps({ testID: 'environment-summary' }))).toContain('4/5');
    });

    it('uses component-aware Paws and timeout guidance without mislabeling missing observations', () => {
        const view = renderEnvironmentView({ rows: [row('guidance', {
            'paws-cli': { status: 'manual-repair', reasonCode: 'version-source-mismatch', observation: observation('paws-cli', {
                source: { kind: 'npm-global', available: true, latestVersion: '1.1.0', ownership: 'unverified' },
            }) },
            'ego-browser': { status: 'process-timeout', reasonCode: 'process-timeout', requiresScan: true, observation: undefined },
            'cloudflare-wrangler': { status: 'process-timeout', reasonCode: 'process-timeout', requiresScan: true, observation: undefined },
        })] });
        const paws = textOf(view.root.findByProps({ testID: 'environment-component-guidance-paws-cli' }));
        expect(paws).toContain('Check the npm global prefix');
        const ego = textOf(view.root.findByProps({ testID: 'environment-component-guidance-ego-browser' }));
        const wrangler = textOf(view.root.findByProps({ testID: 'environment-component-guidance-cloudflare-wrangler' }));
        expect(ego).not.toContain('Homebrew');
        expect(wrangler).not.toContain('Homebrew');

        const missing = renderEnvironmentView({ rows: [row('missing', {
            'paws-cli': { status: 'rpc-timeout', reasonCode: 'rpc-timeout', requiresScan: true, observation: undefined },
        })] });
        const missingPaws = textOf(missing.root.findByProps({ testID: 'environment-component-missing-paws-cli' }));
        expect(missingPaws).toContain('State unknown; scan again');
        expect(missingPaws).not.toContain('not owned by this npm global installation');
    });

    it('uses Paws-only confirmation copy and applies the selected Paws component', async () => {
        renderEnvironmentView({ phase: 'previewed', selectedComponent: 'paws-cli', target: { kind: 'ready', targetVersion: '1.1.0' }, rows: [row('paws', {
            'paws-cli': { status: 'upgrade', plan: plan('paws-cli', 'upgrade', '1.0.0', '1.1.0'), observation: observation('paws-cli', { installedVersion: '1.0.0' }) },
        })] });
        await press('environment-confirm-alignment');
        const [title, message] = mocks.confirm.mock.calls[0];
        expect(title).toBe('Align Paws CLI?');
        expect(message).toContain('npm');
        expect(message).not.toMatch(/GitHub|authentication requires sign-in/i);
        await act(async () => confirmation.resolve(true));
        expect(controller.applyApproved).toHaveBeenCalledWith('paws-cli');
    });

    it('uses npm ownership guidance for a blocked Paws summary without Homebrew copy', () => {
        const view = renderEnvironmentView({ selectedComponent: 'paws-cli', target: { kind: 'blocked', reasonCode: 'version-source-mismatch' } });
        const panel = textOf(view.root);
        expect(panel).toContain('Paws CLI ownership could not be verified');
        expect(panel).toContain('npm global prefix');
        expect(panel).not.toContain('Homebrew');
    });

    it('keeps diagnostic details hidden until a named component toggle expands them', async () => {
        const view = renderEnvironmentView();
        const component = view.root.findByProps({ testID: 'environment-component-mac-ego-browser' });
        const hidden = component.find((node: any) => textOf(node).includes('Chromium: 128.0.0')
            && flattenedStyle(node.props.style).display === 'none');
        expect(hidden).toBeDefined();

        const toggle = view.root.findByProps({ testID: 'environment-details-mac-ego-browser' });
        expect(toggle.props.accessibilityLabel).toBe('mac · Ego Lite and CLI · Details');
        expect(toggle.props.hitSlop).toBe(4);
        expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
        await act(async () => toggle.props.onPress());

        const expandedToggle = view.root.findByProps({ testID: 'environment-details-mac-ego-browser' });
        expect(expandedToggle.props.accessibilityState).toMatchObject({ expanded: true });
        expect(component.findAll((node: any) => textOf(node).includes('Chromium: 128.0.0')
            && flattenedStyle(node.props.style).display === 'none')).toHaveLength(0);
    });

    it('uses measured panel width for the tool grid and exposes the selected alignment tool', () => {
        mocks.windowWidth = 1024;
        const view = renderEnvironmentView();
        const cell = () => view.root.findByProps({ testID: 'environment-component-cell-mac-github-cli' });
        expect(flattenedStyle(cell().props.style).flexBasis).toBe('50%');
        const selected = view.root.findAllByProps({ testID: 'environment-select-github-cli' })
            .find((node: any) => node.props.accessibilityState);
        expect(selected?.props.accessibilityState).toMatchObject({ selected: true });

        const scrollView = view.root.findByType('ScrollView' as any);
        act(() => scrollView.props.onLayout({ nativeEvent: { layout: { width: 1180 } } }));
        expect(flattenedStyle(cell().props.style).flexBasis).toBe('20%');
    });

    it('shows only the action for the current alignment stage', () => {
        const hasAction = (view: TestRenderer.ReactTestRenderer, testID: string) =>
            view.root.findAll((node: any) => node.props.testID === testID).length > 0;
        const actionCount = (view: TestRenderer.ReactTestRenderer) =>
            ['environment-scan-all', 'environment-preview-alignment', 'environment-confirm-alignment']
                .filter((testID) => hasAction(view, testID)).length;
        const scanning = renderEnvironmentView({ phase: 'scanning' });
        expect(actionCount(scanning)).toBe(1);
        expect(hasAction(scanning, 'environment-scan-all')).toBe(true);
        expect(hasAction(scanning, 'environment-preview-alignment')).toBe(false);
        expect(hasAction(scanning, 'environment-confirm-alignment')).toBe(false);

        const scanned = renderEnvironmentView({ phase: 'scanned' });
        expect(actionCount(scanned)).toBe(1);
        expect(hasAction(scanned, 'environment-scan-all')).toBe(false);
        expect(hasAction(scanned, 'environment-preview-alignment')).toBe(true);
        expect(hasAction(scanned, 'environment-confirm-alignment')).toBe(false);
        expect(textOf(scanned.root.findByProps({ testID: 'environment-preview-alignment' }))).toContain('Preview alignment');
        expect(textOf(scanned.root.findByProps({ testID: 'environment-preview-alignment' }))).not.toContain('GitHub CLI');

        const previewed = renderEnvironmentView({ phase: 'previewed', rows: [row('mac', { 'github-cli': {
            status: 'upgrade', plan: plan('github-cli', 'upgrade', '2.79.0', '2.80.0'),
        } })] });
        expect(actionCount(previewed)).toBe(1);
        expect(hasAction(previewed, 'environment-scan-all')).toBe(false);
        expect(hasAction(previewed, 'environment-preview-alignment')).toBe(false);
        expect(hasAction(previewed, 'environment-confirm-alignment')).toBe(true);
        expect(textOf(previewed.root.findByProps({ testID: 'environment-confirm-alignment' }))).toContain('Apply alignment');
        expect(textOf(previewed.root.findByProps({ testID: 'environment-confirm-alignment' }))).not.toContain('GitHub CLI');

        for (const phase of ['scanned', 'previewed'] as const) {
            const blocked = renderEnvironmentView({ phase, target: { kind: 'unavailable' } });
            expect(actionCount(blocked)).toBe(1);
            expect(hasAction(blocked, 'environment-scan-all')).toBe(true);
            expect(hasAction(blocked, 'environment-preview-alignment')).toBe(false);
            expect(hasAction(blocked, 'environment-confirm-alignment')).toBe(false);
        }
    });

    it('keeps narrow component cards content-sized instead of stretching to the viewport', () => {
        mocks.windowWidth = 390;
        const view = renderEnvironmentView();
        const cell = view.root.findByProps({ testID: 'environment-component-cell-mac-github-cli' });
        const card = view.root.findByProps({ testID: 'environment-component-mac-github-cli' });
        expect(flattenedStyle((cell.children[0] as any).props.style).height).toBeUndefined();
        expect(flattenedStyle(card.props.style).flex).toBeUndefined();
    });

    it('keeps component cards equal-height in a multi-column layout', () => {
        mocks.windowWidth = 1024;
        const view = renderEnvironmentView();
        const cell = view.root.findByProps({ testID: 'environment-component-cell-mac-github-cli' });
        const card = view.root.findByProps({ testID: 'environment-component-mac-github-cli' });
        expect(flattenedStyle((cell.children[0] as any).props.style).height).toBe('100%');
        expect(flattenedStyle(card.props.style).flex).toBe(1);
    });

    it('does not present an empty fleet as fully healthy', () => {
        const view = renderEnvironmentView({ rows: [] });
        const healthIcon = view.root.findByProps({ testID: 'environment-health-icon' });
        expect(healthIcon.findByType('Ionicons' as any).props.name).toBe('pulse');
        expect(textOf(view.root)).toContain('No machines registered yet');
    });

    it('distinguishes matching component detail controls across machines', () => {
        const view = renderEnvironmentView({ rows: [row('office'), row('studio')] });
        const labels = ['office', 'studio'].map((machineId) => view.root
            .findByProps({ testID: `environment-details-${machineId}-ego-browser` }).props.accessibilityLabel);
        expect(labels).toEqual(['office · Ego Lite and CLI · Details', 'studio · Ego Lite and CLI · Details']);
    });
});
