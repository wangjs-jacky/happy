import * as React from 'react';
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { environmentRepairCommands, type ComponentObservation, type EnvironmentComponentId, type EnvironmentReasonCode } from '@slopus/happy-wire';
import { ItemList } from '@/components/ItemList';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { FLEET_COMPONENT_IDS, type FleetComponentRow, type FleetRow, type FleetTarget } from '@/environment/fleetModel';
import { useDeviceEnvironment, type DeviceEnvironmentController } from '@/hooks/useDeviceEnvironment';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
import { useAllMachines } from '@/sync/storage';
import { t } from '@/text';

function machineName(row: FleetRow): string {
    return row.machine.metadata?.displayName || row.machine.metadata?.host || row.machineId;
}

function componentName(componentId: EnvironmentComponentId): string {
    switch (componentId) {
        case 'github-cli': return t('deviceEnvironment.githubCli');
        case 'paws-cli': return t('deviceEnvironment.pawsCli');
        case 'ego-browser': return t('deviceEnvironment.egoBrowser');
        case 'cloudflare-wrangler': return t('deviceEnvironment.cloudflareWrangler');
        case 'cloudflared': return t('deviceEnvironment.cloudflared');
    }
}

function componentIcon(componentId: EnvironmentComponentId): React.ComponentProps<typeof Ionicons>['name'] {
    switch (componentId) {
        case 'github-cli': return 'logo-github';
        case 'paws-cli': return 'paw-outline';
        case 'ego-browser': return 'globe-outline';
        case 'cloudflare-wrangler': return 'cloud-outline';
        case 'cloudflared': return 'git-network-outline';
    }
}

function reasonLabel(componentId: EnvironmentComponentId, reason?: EnvironmentReasonCode): string | undefined {
    switch (reason) {
        case 'machine-offline': return t('deviceEnvironment.daemonOffline');
        case 'unsupported-platform':
        case 'unsupported-architecture': return t(componentId === 'github-cli' ? 'deviceEnvironment.unsupportedMachine'
            : componentId === 'paws-cli' ? 'deviceEnvironment.pawsUnsupported'
                : componentId === 'ego-browser' ? 'deviceEnvironment.egoUnsupported' : 'deviceEnvironment.componentUnsupported');
        case 'homebrew-missing': return t(componentId === 'github-cli' ? 'deviceEnvironment.homebrewMissing'
            : componentId === 'cloudflared' ? 'deviceEnvironment.cloudflaredHomebrewMissing' : 'deviceEnvironment.stateUnknown');
        case 'formula-unavailable': return t(componentId === 'github-cli' ? 'deviceEnvironment.formulaUnavailable'
            : componentId === 'cloudflared' ? 'deviceEnvironment.cloudflaredFormulaUnavailable' : 'deviceEnvironment.stateUnknown');
        case 'version-source-mismatch': return t(componentId === 'paws-cli'
            ? 'deviceEnvironment.pawsOwnershipMismatch' : componentId === 'github-cli' ? 'deviceEnvironment.versionSourceMismatch'
                : componentId === 'ego-browser' ? 'deviceEnvironment.egoMismatch' : 'deviceEnvironment.componentVersionSourceMismatch');
        case 'version-ahead': return t('deviceEnvironment.versionAhead');
        case 'authentication-missing': return t(componentId === 'cloudflare-wrangler'
            ? 'deviceEnvironment.cloudflareAuthMissing' : componentId === 'cloudflared'
                ? 'deviceEnvironment.tunnelCertificateMissing' : 'deviceEnvironment.authMissing');
        case 'operation-in-progress': return t('deviceEnvironment.operationInProgress');
        case 'plan-stale': return t('deviceEnvironment.planExpired');
        case 'install-failed':
        case 'verification-failed': return t('deviceEnvironment.alignmentFailed');
        case 'process-timeout':
        case 'rpc-timeout':
        case 'unexpected-error': return t('deviceEnvironment.stateUnknown');
        case undefined: return undefined;
        default: return reason satisfies never;
    }
}

function isAlignable(component: FleetComponentRow): boolean {
    const observation = component.observation;
    return observation?.capability === 'alignable'
        && observation.source.ownership !== 'unverified';
}

function failedProbe(observation?: ComponentObservation): boolean {
    return observation?.support === 'unsupported' && observation.reasonCode === 'unexpected-error';
}

function egoReadinessLabel(observation: Extract<ComponentObservation, { componentId: 'ego-browser' }>): string {
    if (failedProbe(observation)) return t('deviceEnvironment.stateUnknown');
    if (observation.support === 'unsupported') return t('deviceEnvironment.egoUnsupported');
    if (!observation.installed) return t('deviceEnvironment.egoCliMissing');
    if (observation.details.appVersion === null) return t('deviceEnvironment.egoAppMissing');
    if (!observation.details.pathReady) return t('deviceEnvironment.egoPathMissing');
    if (observation.installedVersion === null) return t('deviceEnvironment.stateUnknown');
    return t(observation.details.paired ? 'deviceEnvironment.egoPaired' : 'deviceEnvironment.egoMismatch');
}

function actionLabel(component: FleetComponentRow, target: FleetTarget): string {
    if (component.status === 'offline') return t('deviceEnvironment.daemonOffline');
    if (component.status === 'rpc-timeout' || component.status === 'process-timeout' || component.status === 'rpc-error') return t('deviceEnvironment.stateUnknown');
    if (component.status === 'stale-plan') return t('deviceEnvironment.planExpired');
    const installLabel = (version: string) => {
        switch (component.componentId) {
            case 'github-cli': return t('deviceEnvironment.actionInstall', { version });
            case 'paws-cli': return t('deviceEnvironment.actionPawsInstall', { version });
            case 'ego-browser': return t('deviceEnvironment.actionEgoUpgrade', { from: t('common.unknown'), version });
            case 'cloudflare-wrangler': return t('deviceEnvironment.actionWranglerInstall', { version });
            case 'cloudflared': return t('deviceEnvironment.actionCloudflaredInstall', { version });
        }
    };
    const upgradeLabel = (from: string, version: string) => {
        switch (component.componentId) {
            case 'github-cli': return t('deviceEnvironment.actionUpgrade', { from, version });
            case 'paws-cli': return t('deviceEnvironment.actionPawsUpgrade', { from, version });
            case 'ego-browser': return t('deviceEnvironment.actionEgoUpgrade', { from, version });
            case 'cloudflare-wrangler': return t('deviceEnvironment.actionWranglerUpgrade', { from, version });
            case 'cloudflared': return t('deviceEnvironment.actionCloudflaredUpgrade', { from, version });
        }
    };
    const authenticateLabel = () => component.componentId === 'cloudflared'
        ? t('deviceEnvironment.actionCloudflaredAuthenticate') : t('deviceEnvironment.actionWranglerAuthenticate');
    if (component.status === 'failed' || component.status === 'succeeded') {
        const failed = component.status === 'failed';
        const outcome = t(failed ? 'deviceEnvironment.alignmentFailed' : 'deviceEnvironment.completed');
        if (!component.result) return outcome;
        const { before, after, changed } = component.result;
        const version = (failed && target.kind === 'ready' ? target.targetVersion : after.installedVersion) ?? t('common.unknown');
        const authenticated = component.componentId === 'cloudflare-wrangler'
            && before.authentication?.status !== 'authenticated' && after.authentication?.status === 'authenticated';
        const tunnelAuthenticated = component.componentId === 'cloudflared'
            && before.details.kind === 'cloudflared' && after.details.kind === 'cloudflared'
            && !before.details.tunnelCertificatePresent && after.details.tunnelCertificatePresent;
        const onboarded = component.componentId === 'ego-browser'
            && before.details.kind === 'ego-browser' && after.details.kind === 'ego-browser'
            && (!before.details.pathReady || !before.details.paired) && after.details.pathReady && after.details.paired
            && before.installedVersion === after.installedVersion;
        const action = !failed && (authenticated || tunnelAuthenticated) ? authenticateLabel()
            : !failed && onboarded ? t('deviceEnvironment.actionEgoOnboard')
                : !failed && !changed ? t('deviceEnvironment.actionNone')
                    : before.installed ? upgradeLabel(before.installedVersion ?? t('common.unknown'), version)
                        : installLabel(version);
        return `${outcome} · ${action}`;
    }
    const plannedAction = component.dispatchedAction ?? component.plan;
    if (plannedAction) {
        switch (plannedAction.action) {
            case 'install': return installLabel(plannedAction.targetVersion ?? t('common.unknown'));
            case 'upgrade': return upgradeLabel(plannedAction.fromVersion ?? t('common.unknown'),
                plannedAction.targetVersion ?? t('common.unknown'));
            case 'authenticate': return authenticateLabel();
            case 'onboard': return t('deviceEnvironment.actionEgoOnboard');
            case 'none': return t('deviceEnvironment.actionNone');
            case 'manual-repair': return t('deviceEnvironment.actionManualRepair');
        }
    }
    if (component.status === 'manual-repair') return t('deviceEnvironment.actionManualRepair');
    return t(component.status === 'pending' ? 'deviceEnvironment.scanAgain' : 'deviceEnvironment.previewRequired');
}

function componentReady(component: FleetComponentRow, target?: FleetTarget): boolean {
    const observation = component.status === 'succeeded' && component.result?.status === 'succeeded'
        ? component.result.after : component.observation;
    if ((component.status !== 'ready' && component.status !== 'succeeded') || !observation?.installed || observation.support !== 'supported') return false;
    const atTarget = target?.kind !== 'ready' || observation.installedVersion === target.targetVersion;
    if (component.componentId === 'ego-browser' && observation.details.kind === 'ego-browser') return observation.details.pathReady && observation.details.paired && atTarget;
    if (component.componentId === 'cloudflare-wrangler') return observation.authentication?.status === 'authenticated' && atTarget;
    if (component.componentId === 'cloudflared' && observation.details.kind === 'cloudflared') return observation.details.tunnelCertificatePresent && atTarget;
    if (component.componentId === 'github-cli' && observation.authentication?.status !== 'authenticated') return false;
    return atTarget;
}

function componentState(component: FleetComponentRow, target?: FleetTarget): 'ready' | 'warning' | 'unknown' {
    if (failedProbe(component.observation)) return 'unknown';
    if (component.status === 'offline' || component.status === 'pending' || component.status.includes('timeout') || component.status === 'rpc-error') return 'unknown';
    return componentReady(component, target) ? 'ready' : 'warning';
}

function componentStateLabel(state: ReturnType<typeof componentState>): string {
    return t(state === 'ready' ? 'deviceEnvironment.componentReady'
        : state === 'warning' ? 'deviceEnvironment.componentWarning' : 'deviceEnvironment.componentUnknown');
}

function timeoutRecoveryLabel(componentId: EnvironmentComponentId): string {
    return t(componentId === 'github-cli' ? 'deviceEnvironment.timeoutRecovery'
        : componentId === 'paws-cli' ? 'deviceEnvironment.pawsTimeoutRecovery' : 'deviceEnvironment.componentTimeoutRecovery');
}

function componentTarget(controller: DeviceEnvironmentController, componentId: EnvironmentComponentId): FleetTarget | undefined {
    return componentId === controller.selectedComponent ? controller.target : controller.targets[componentId];
}

const ComponentEnvironmentRow = React.memo(({ machineId, machineLabel, component, target, applying, stretch }: {
    machineId: string; machineLabel: string; component: FleetComponentRow; target?: FleetTarget; applying: boolean; stretch: boolean;
}) => {
    const { theme } = useUnistyles();
    const observation = component.observation;
    const state = componentState(component, target);
    const icon = state === 'ready' ? 'checkmark-circle-outline' : state === 'warning' ? 'alert-circle-outline' : 'help-circle-outline';
    const color = state === 'ready' ? theme.colors.status.connected : state === 'warning' ? theme.colors.status.connecting : theme.colors.status.disconnected;
    const installed = !observation || failedProbe(observation) ? t('common.unknown')
        : observation.installed ? observation.installedVersion ?? t('common.unknown') : t('deviceEnvironment.notInstalled');
    const latest = observation?.source.available ? observation.source.latestVersion : null;
    const reasonCode = component.reasonCode ?? component.plan?.reasonCode ?? observation?.reasonCode ?? component.result?.reasonCode;
    const reason = reasonLabel(component.componentId, reasonCode);
    const action = actionLabel(component, target ?? { kind: 'unavailable' });
    const pendingApply = applying && component.dispatchedAction?.action !== undefined
        && component.dispatchedAction.action !== 'none' && component.dispatchedAction.action !== 'manual-repair';
    // Inspection and apply failures share the same static component/reason allowlist.
    const commands = environmentRepairCommands(component.componentId, reasonCode);
    const details = observation?.details;
    const [expanded, setExpanded] = React.useState(false);
    const [detailsFocused, setDetailsFocused] = React.useState(false);
    const hasDetails = component.status === 'offline' || details?.kind === 'ego-browser'
        || Boolean(observation?.authentication?.accountLabels?.length) || Boolean(reason)
        || component.status === 'rpc-timeout' || component.status === 'process-timeout' || commands.length > 0;

    return (
        <View testID={`environment-component-${machineId}-${component.componentId}`} style={[styles.component, stretch && styles.componentStretch]}>
            <View style={styles.componentHeader}>
                <View style={[styles.componentIcon, { backgroundColor: `${color}18` }]}>
                    <Ionicons name={componentIcon(component.componentId)} size={18} color={color} />
                </View>
                <Text numberOfLines={2} style={styles.componentTitle}>{componentName(component.componentId)}</Text>
                <View style={[styles.statusBadge, { backgroundColor: `${color}18` }]}>
                    <Ionicons name={icon} size={14} color={color} />
                    <Text style={styles.statusBadgeText}>{componentStateLabel(state)}</Text>
                </View>
            </View>
            {component.status === 'offline' ? <>
                <Text style={styles.actionText}>{t('deviceEnvironment.daemonOffline')}</Text>
                <View style={!expanded && styles.collapsedDetails}>
                    <Text style={styles.guidance}>{t('deviceEnvironment.offlineRecovery')}</Text>
                </View>
            </> : <>
                <View style={styles.versions}>
                    <Text style={styles.secondary}>{t('deviceEnvironment.versionInstalled', { version: installed })}</Text>
                    {latest !== null ? <Text style={styles.secondary}>{t('deviceEnvironment.versionLatest', { version: latest })}</Text> : null}
                </View>
                {component.componentId === 'github-cli' ? <Text style={observation?.authentication?.status === 'authenticated' ? styles.ready : styles.secondary}>
                    {t(observation?.authentication?.status === 'authenticated' ? 'deviceEnvironment.authReady'
                        : observation?.authentication?.status === 'missing' ? 'deviceEnvironment.authMissing' : 'deviceEnvironment.authUnknown')}
                </Text> : null}
                {component.componentId === 'paws-cli' && observation?.source.ownership === 'verified' ? <Text style={styles.ready}>
                    {t('deviceEnvironment.pawsOwnershipVerified')}
                </Text> : null}
                {component.componentId === 'paws-cli' && observation?.source.ownership === 'unverified' ? <Text style={styles.secondary}>
                    {t('deviceEnvironment.pawsOwnershipUnverified')}
                </Text> : null}
                {details?.kind === 'ego-browser' && observation?.componentId === 'ego-browser' ? <Text style={details.paired ? styles.ready : styles.guidance}>
                    {egoReadinessLabel(observation)}
                </Text> : null}
                {component.componentId === 'cloudflare-wrangler' ? <>
                    <Text style={observation?.authentication?.status === 'authenticated' ? styles.ready : styles.secondary}>{t(
                        observation?.authentication?.status === 'authenticated' ? 'deviceEnvironment.cloudflareAuthReady'
                            : observation?.authentication?.status === 'missing' ? 'deviceEnvironment.cloudflareAuthMissing' : 'deviceEnvironment.cloudflareAuthUnknown')}</Text>
                </> : null}
                {details?.kind === 'cloudflared' ? <Text style={details.tunnelCertificatePresent ? styles.ready : styles.guidance}>
                    {t(details.tunnelCertificatePresent ? 'deviceEnvironment.tunnelCertificatePresent' : 'deviceEnvironment.tunnelCertificateMissing')}
                </Text> : null}
                <Text style={styles.actionText}>{observation?.capability === 'inspect-only' ? t('deviceEnvironment.inspectOnly')
                    : pendingApply ? `${t('deviceEnvironment.applying')} · ${action}` : action}</Text>
                <View style={[styles.detailList, !expanded && styles.collapsedDetails]}>
                    {details?.kind === 'ego-browser' ? <>
                        <Text style={styles.secondary}>{t('deviceEnvironment.egoAppVersion', { version: details.appVersion ?? t('common.unknown') })}</Text>
                        <Text style={styles.secondary}>{t('deviceEnvironment.egoCliVersion', { version: observation?.installedVersion ?? t('common.unknown') })}</Text>
                        <Text style={styles.secondary}>{t('deviceEnvironment.egoChromiumVersion', { version: details.chromiumVersion ?? t('common.unknown') })}</Text>
                        <Text style={styles.secondary}>{t('deviceEnvironment.egoNodeVersion', { version: details.nodeVersion ?? t('common.unknown') })}</Text>
                        {details.pathReady ? <Text style={styles.ready}>{t('deviceEnvironment.egoPathReady')}</Text> : null}
                    </> : null}
                    {component.componentId === 'cloudflare-wrangler' && observation?.authentication?.accountLabels?.length ? <Text style={styles.secondary}>
                        {t('deviceEnvironment.cloudflareAccounts', { accounts: observation.authentication.accountLabels.join(', ') })}
                    </Text> : null}
                    {reason && !action.includes(reason) ? <Text style={styles.guidance}>{reason}</Text> : null}
                    {component.status === 'rpc-timeout' || component.status === 'process-timeout'
                        ? <Text style={styles.guidance}>{component.requiresScan
                            ? timeoutRecoveryLabel(component.componentId) : t('deviceEnvironment.scanAgain')}</Text> : null}
                    {commands.map((command) => <Text key={command} selectable style={styles.command}>{command}</Text>)}
                </View>
            </>}
            {hasDetails ? <Pressable testID={`environment-details-${machineId}-${component.componentId}`} accessibilityRole="button"
                accessibilityLabel={`${machineLabel} · ${componentName(component.componentId)} · ${t('profile.details')}`} accessibilityState={{ expanded }}
                hitSlop={4}
                onPress={() => setExpanded((value) => !value)} onFocus={() => setDetailsFocused(true)} onBlur={() => setDetailsFocused(false)}
                style={[styles.detailsToggle, stretch ? styles.detailsToggleStretch : styles.detailsToggleCompact,
                    detailsFocused && styles.detailsToggleFocused]}>
                <Text style={styles.detailsToggleText}>{t('profile.details')}</Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={theme.colors.textLink} />
            </Pressable> : null}
        </View>
    );
});

const MachineEnvironmentRow = React.memo(({ row, controller, columns }: { row: FleetRow; controller: DeviceEnvironmentController; columns: number }) => {
    const { theme } = useUnistyles();
    const ready = FLEET_COMPONENT_IDS.filter((componentId) => componentReady(row.components[componentId], componentTarget(controller, componentId))).length;
    return <View style={styles.machineCard}>
        <View testID={`environment-machine-${row.machineId}`}>
            <View style={styles.machineHeader}>
                <View style={styles.machineIdentity}>
                    <View style={styles.machineIcon}>
                        <Ionicons name="desktop-outline" size={21} color={row.online ? theme.colors.status.connected : theme.colors.status.disconnected} />
                    </View>
                    <View style={styles.machineTitleBlock}>
                        <Text numberOfLines={1} style={styles.machineTitle}>{machineName(row)}</Text>
                        <Text style={styles.machineSubtitle}>{t(row.online ? 'deviceEnvironment.daemonOnline' : 'deviceEnvironment.daemonOffline')}</Text>
                    </View>
                </View>
                <View style={styles.machineScore}>
                    <Text style={styles.machineScoreValue}>{ready}/{FLEET_COMPONENT_IDS.length}</Text>
                    <Text style={styles.machineScoreLabel}>{t('deviceEnvironment.componentReady')}</Text>
                </View>
            </View>
            <View style={styles.machineDetails}>
                {FLEET_COMPONENT_IDS.map((componentId) => <View key={componentId} testID={`environment-component-cell-${row.machineId}-${componentId}`}
                    style={{ flexBasis: `${100 / columns}%`, flexGrow: 0, flexShrink: 0 }}>
                    <View style={[styles.componentCell, columns > 1 && styles.componentCellStretch]}>
                        <ComponentEnvironmentRow machineId={row.machineId} machineLabel={machineName(row)} component={row.components[componentId]}
                            target={componentTarget(controller, componentId)} applying={controller.phase === 'applying'} stretch={columns > 1} />
                    </View>
                </View>)}
            </View>
        </View>
    </View>;
});

const EnvironmentAction = React.memo(({ testID, title, disabled, loading, active, icon, primary, onPress }: {
    testID: string; title: string; disabled: boolean; loading?: boolean; active?: boolean;
    icon: React.ComponentProps<typeof Ionicons>['name']; primary?: boolean; onPress(): void;
}) => {
    const { theme } = useUnistyles();
    const primaryTint = theme.colors.button?.primary.tint ?? theme.colors.text;
    const [hovered, setHovered] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    React.useEffect(() => { if (disabled) setFocused(false); }, [disabled]);
    return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title}
        accessibilityState={{ disabled, busy: Boolean(loading), selected: Boolean(active) }}
        disabled={disabled} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={({ pressed }) => [styles.action, primary && styles.actionPrimary, active && styles.actionActive,
            !disabled && (hovered || pressed) && styles.actionPressed, primary && !disabled && (hovered || pressed) && styles.actionPrimaryPressed,
            !disabled && focused && styles.actionFocused, primary && !disabled && focused && styles.actionPrimaryFocused,
            disabled && !active && styles.actionDisabled]}>
        {loading ? <ActivityIndicator size="small" color={primary ? primaryTint : theme.colors.textLink} />
            : <Ionicons name={icon} size={17} color={primary ? primaryTint : theme.colors.textLink} />}
        <Text numberOfLines={1} style={[styles.actionTitle, primary && { color: primaryTint }]}>{title}</Text>
    </Pressable>;
});

const DeviceEnvironmentContent = React.memo(({ controller }: { controller: DeviceEnvironmentController }) => {
    const { theme } = useUnistyles();
    const { width } = useWindowDimensions();
    const [contentWidth, setContentWidth] = React.useState(Math.min(width, 1180));
    const latest = React.useRef(controller);
    latest.current = controller;
    const mounted = React.useRef(true);
    React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const busyPhase = ['scanning', 'previewing', 'applying'].includes(controller.phase);
    const selected = controller.selectedComponent;
    const canPreview = !busyPhase && controller.target.kind === 'ready' && (controller.phase === 'scanned' || controller.phase === 'previewed');
    const actionableRows = controller.rows.filter((row) => row.online && isAlignable(row.components[selected])
        && ['ready', 'install', 'upgrade', 'authenticate', 'onboard'].includes(row.components[selected].status)
        && row.components[selected].plan?.action !== 'manual-repair');
    const canConfirm = !busyPhase && controller.phase === 'previewed' && controller.target.kind === 'ready'
        && actionableRows.length > 0;
    const [working, runAction] = useHappyAction(async (action: 'scan' | 'preview' | 'confirm' | 'select', componentId?: EnvironmentComponentId) => {
        if (busyPhase) return;
        if (action === 'scan') await controller.scan();
        if (action === 'select' && componentId) controller.selectComponent(componentId);
        if (action === 'preview' && canPreview) await controller.preview(selected);
        if (action === 'confirm' && canConfirm) {
            const title = selected === 'github-cli' ? t('deviceEnvironment.confirmTitle')
                : selected === 'paws-cli' ? t('deviceEnvironment.confirmPawsTitle')
                    : t('deviceEnvironment.confirmToolTitle', { component: componentName(selected) });
            const messageKey = selected === 'github-cli' ? 'deviceEnvironment.confirmMessage'
                : selected === 'paws-cli' ? 'deviceEnvironment.confirmPawsMessage' : 'deviceEnvironment.confirmToolMessage';
            const approved = await Modal.confirm(
                title,
                t(messageKey, {
                    actions: actionableRows.map((row) => `${machineName(row)}: ${actionLabel(row.components[selected], controller.target)}`).join('\n'),
                }),
                { confirmText: t('deviceEnvironment.confirmAction'), cancelText: t('common.cancel') },
            );
            if (approved && mounted.current && latest.current.phase === 'previewed' && latest.current.rows === controller.rows
                && latest.current.target === controller.target && latest.current.selectedComponent === selected) await controller.applyApproved(selected);
        }
    });
    const busy = busyPhase || working;
    const components = controller.rows.flatMap((row) => FLEET_COMPONENT_IDS.map((id) => ({ component: row.components[id], target: componentTarget(controller, id) })));
    const ready = components.filter(({ component, target }) => componentReady(component, target)).length;
    const warning = components.filter(({ component, target }) => componentState(component, target) === 'warning').length;
    const unknown = components.length - ready - warning;
    const alignable = FLEET_COMPONENT_IDS.filter((componentId) => controller.rows.some((row) => isAlignable(row.components[componentId])));
    const columns = contentWidth >= 1120 ? 5 : contentWidth >= 640 ? 2 : 1;
    const fullyReady = components.length > 0 && ready === components.length;
    const healthColor = fullyReady ? styles.healthGood : warning > 0 ? styles.healthWarning : styles.healthUnknown;
    const showPreview = (controller.phase === 'scanned' && canPreview) || controller.phase === 'previewing';
    const showConfirm = (controller.phase === 'previewed' && canConfirm) || controller.phase === 'applying';
    const showScan = !showPreview && !showConfirm;

    return <ItemList containerStyle={styles.container} onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
        <View style={styles.summaryCard}>
            <View style={styles.summary} accessibilityLiveRegion="polite">
                <View style={styles.summaryMain}>
                    <View testID="environment-health-icon" style={[styles.healthIcon, healthColor]}>
                        <Ionicons name={fullyReady ? 'shield-checkmark' : 'pulse'} size={25} color={theme.colors.text} />
                    </View>
                    <View style={styles.summaryCopy}>
                        <Text style={styles.heading}>{t('deviceEnvironment.developmentEnvironmentHealth')}</Text>
                        <Text style={styles.secondary}>{t('deviceEnvironment.subtitle')}</Text>
                    </View>
                    <Text testID="environment-summary" style={styles.summaryCount}>{t('deviceEnvironment.componentReadyCount', { ready, total: components.length })}</Text>
                </View>
                <View style={styles.healthTrack}><View style={[styles.healthTrackFill, { width: components.length ? `${ready / components.length * 100}%` : '0%' }]} /></View>
                <View style={styles.summaryStates}>
                    <View style={styles.stateChip}><View style={[styles.stateDot, { backgroundColor: theme.colors.status.connected }]} /><Text style={styles.stateChipText}>{ready} {componentStateLabel('ready')}</Text></View>
                    <View style={styles.stateChip}><View style={[styles.stateDot, { backgroundColor: theme.colors.status.connecting }]} /><Text style={styles.stateChipText}>{warning} {componentStateLabel('warning')}</Text></View>
                    <View style={styles.stateChip}><View style={[styles.stateDot, { backgroundColor: theme.colors.status.disconnected }]} /><Text style={styles.stateChipText}>{unknown} {componentStateLabel('unknown')}</Text></View>
                </View>
                {controller.rows.length === 0 ? <Text style={styles.secondary}>{t('deviceEnvironment.emptyFleet')}</Text> : null}
                {controller.target.kind === 'blocked' ? <Text style={styles.guidance}>{t(selected === 'paws-cli'
                    ? 'deviceEnvironment.pawsOwnershipMismatch' : 'deviceEnvironment.versionSourceMismatch')}</Text> : null}
            </View>
        </View>
        <View style={styles.toolbarCard}>
            <View style={styles.toolbar}>
            {showScan ? <EnvironmentAction testID="environment-scan-all" title={t(controller.phase === 'scanning' ? 'deviceEnvironment.scanning' : 'deviceEnvironment.scanAll')}
                icon="scan-outline" primary disabled={busy || controller.rows.length === 0} loading={controller.phase === 'scanning'} onPress={() => runAction('scan')} /> : null}
            {alignable.length > 1 ? alignable.map((componentId) => <EnvironmentAction key={componentId} testID={`environment-select-${componentId}`}
                title={componentName(componentId)} icon={componentIcon(componentId)} active={selected === componentId} disabled={busy || selected === componentId}
                onPress={() => runAction('select', componentId)} />) : null}
            {showPreview ? <EnvironmentAction testID="environment-preview-alignment"
                title={t(controller.phase === 'previewing' ? 'deviceEnvironment.previewing' : 'deviceEnvironment.previewAlignment')}
                icon="eye-outline" disabled={busy || !canPreview} loading={controller.phase === 'previewing'} onPress={() => runAction('preview')} /> : null}
            {showConfirm ? <EnvironmentAction testID="environment-confirm-alignment"
                title={t(controller.phase === 'applying' ? 'deviceEnvironment.applying' : 'deviceEnvironment.confirmAction')}
                icon="checkmark-circle-outline" disabled={busy || !canConfirm} loading={controller.phase === 'applying'} onPress={() => runAction('confirm')} /> : null}
            </View>
        </View>
        {controller.rows.map((row) => <MachineEnvironmentRow key={row.machineId} row={row} controller={controller} columns={columns} />)}
    </ItemList>;
});

const ConnectedDeviceEnvironment = React.memo(() => {
    const machines = useAllMachines({ includeOffline: true });
    const controller = useDeviceEnvironment(machines);
    return <DeviceEnvironmentContent controller={controller} />;
});

export const DeviceEnvironmentView = React.memo(({ controller }: { controller?: DeviceEnvironmentController }) => (
    controller ? <DeviceEnvironmentContent controller={controller} /> : <ConnectedDeviceEnvironment />
));

const styles = StyleSheet.create((theme) => ({
    container: { width: '100%', maxWidth: Math.max(layout.maxWidth, 1180), alignSelf: 'center', paddingBottom: 32 },
    summaryCard: { marginHorizontal: 12, marginTop: 16, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider },
    summary: { padding: 20, gap: 14 },
    summaryMain: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
    summaryCopy: { flex: 1, minWidth: 220, gap: 3 },
    heading: { color: theme.colors.text, fontSize: 20, ...Typography.default('semiBold') },
    summaryCount: { color: theme.colors.text, fontSize: 15, ...Typography.default('semiBold') },
    healthIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    healthGood: { backgroundColor: `${theme.colors.status.connected}24` },
    healthWarning: { backgroundColor: `${theme.colors.status.connecting}24` },
    healthUnknown: { backgroundColor: `${theme.colors.status.disconnected}24` },
    healthTrack: { height: 6, overflow: 'hidden', borderRadius: 999, backgroundColor: theme.colors.surfaceSelected },
    healthTrackFill: { height: '100%', borderRadius: 999, backgroundColor: theme.colors.status.connected },
    summaryStates: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    stateChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6,
        borderRadius: 999, backgroundColor: theme.colors.surfaceHigh },
    stateDot: { width: 7, height: 7, borderRadius: 999 },
    stateChipText: { color: theme.colors.textSecondary, fontSize: 12, ...Typography.default('semiBold') },
    secondary: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, ...Typography.default() },
    ready: { color: theme.colors.status.connected, fontSize: 14, lineHeight: 21, ...Typography.default() },
    guidance: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, ...Typography.default() },
    machineCard: { marginHorizontal: 12, marginTop: 16, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider },
    machineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider },
    machineIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11 },
    machineIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceHigh },
    machineTitleBlock: { flex: 1, minWidth: 0 },
    machineTitle: { color: theme.colors.text, fontSize: 16, lineHeight: 21, ...Typography.default('semiBold') },
    machineSubtitle: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18, ...Typography.default() },
    machineScore: { alignItems: 'flex-end' },
    machineScoreValue: { color: theme.colors.text, fontSize: 17, lineHeight: 20, ...Typography.default('semiBold') },
    machineScoreLabel: { color: theme.colors.textSecondary, fontSize: 11, lineHeight: 16, ...Typography.default() },
    machineDetails: { flexDirection: 'row', flexWrap: 'wrap', padding: 9 },
    componentCell: { padding: 5 },
    componentCellStretch: { height: '100%' },
    component: { minHeight: 170, gap: 7, padding: 13, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh },
    componentStretch: { flex: 1 },
    componentHeader: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 7 },
    componentIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    componentTitle: { flex: 1, minWidth: 72, color: theme.colors.text, fontSize: 14, lineHeight: 18, ...Typography.default('semiBold') },
    statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
    statusBadgeText: { color: theme.colors.text, fontSize: 12, ...Typography.default('semiBold') },
    versions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2 },
    detailList: { gap: 2 },
    collapsedDetails: { display: 'none' },
    actionText: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20, ...Typography.default() },
    command: { color: theme.colors.text, backgroundColor: theme.colors.surfaceSelected, padding: 10, borderRadius: 6, fontSize: 13, ...Typography.mono() },
    detailsToggle: { minHeight: 36, paddingHorizontal: 6, paddingVertical: 7, marginLeft: -6,
        flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 7 },
    detailsToggleStretch: { marginTop: 'auto' },
    detailsToggleCompact: { marginTop: 4 },
    detailsToggleFocused: { backgroundColor: theme.colors.surfaceSelected },
    detailsToggleText: { color: theme.colors.textLink, fontSize: 12, ...Typography.default('semiBold') },
    toolbarCard: { marginHorizontal: 12, marginTop: 12, padding: 8, borderRadius: 14, backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider },
    toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: 38, flexGrow: 1, flexBasis: 130, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
        paddingHorizontal: 13, paddingVertical: 9, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh },
    actionPrimary: { backgroundColor: theme.colors.button?.primary.background ?? theme.colors.accent,
        borderColor: theme.colors.button?.primary.background ?? theme.colors.accent },
    actionPrimaryPressed: { backgroundColor: theme.colors.button?.primary.background ?? theme.colors.accent },
    actionPrimaryFocused: { backgroundColor: theme.colors.button?.primary.background ?? theme.colors.accent },
    actionActive: { borderColor: theme.colors.textLink, backgroundColor: theme.colors.surfaceSelected },
    actionPressed: { backgroundColor: theme.colors.surfacePressed },
    actionFocused: { backgroundColor: theme.colors.surfaceSelected },
    actionDisabled: { opacity: 0.5 },
    actionTitle: { color: theme.colors.textLink, fontSize: 13, ...Typography.default('semiBold') },
}));
