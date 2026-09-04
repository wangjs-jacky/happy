import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { EnvironmentReasonCode } from '@slopus/happy-wire';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import type { FleetRow, FleetTarget } from '@/environment/fleetModel';
import { useDeviceEnvironment, type DeviceEnvironmentController } from '@/hooks/useDeviceEnvironment';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
import { useAllMachines } from '@/sync/storage';
import { t } from '@/text';

function machineName(row: FleetRow): string {
    return row.machine.metadata?.displayName || row.machine.metadata?.host || row.machineId;
}

function reasonLabel(reason?: EnvironmentReasonCode): string | undefined {
    switch (reason) {
        case 'machine-offline': return t('deviceEnvironment.daemonOffline');
        case 'unsupported-platform':
        case 'unsupported-architecture': return t('deviceEnvironment.unsupportedMachine');
        case 'homebrew-missing': return t('deviceEnvironment.homebrewMissing');
        case 'formula-unavailable': return t('deviceEnvironment.formulaUnavailable');
        case 'version-source-mismatch': return t('deviceEnvironment.versionSourceMismatch');
        case 'version-ahead': return t('deviceEnvironment.versionAhead');
        case 'authentication-missing': return t('deviceEnvironment.authMissing');
        case 'operation-in-progress': return t('deviceEnvironment.operationInProgress');
        case 'plan-stale': return t('deviceEnvironment.planExpired');
        case 'install-failed':
        case 'verification-failed': return t('deviceEnvironment.alignmentFailed');
        case 'rpc-timeout':
        case 'unexpected-error': return t('deviceEnvironment.stateUnknown');
        default: return undefined;
    }
}

function actionLabel(row: FleetRow, target: FleetTarget): string {
    if (!row.online) return t('deviceEnvironment.daemonOffline');
    if (row.status === 'rpc-timeout' || row.status === 'rpc-error') return t('deviceEnvironment.stateUnknown');
    if (row.status === 'stale-plan') return t('deviceEnvironment.planExpired');
    if (row.status === 'failed' || row.status === 'succeeded') {
        const failed = row.status === 'failed';
        const outcome = t(failed ? 'deviceEnvironment.alignmentFailed' : 'deviceEnvironment.completed');
        if (!row.result) return outcome;
        const { before, after, changed } = row.result;
        // A failed operation may leave the installed version unchanged. The
        // retained fleet target identifies what was attempted after plan cleanup.
        const version = (failed && target.kind === 'ready' ? target.targetVersion : after.installedVersion) ?? t('common.unknown');
        const action = !failed && !changed ? t('deviceEnvironment.actionNone')
            : before.installed ? t('deviceEnvironment.actionUpgrade', { from: before.installedVersion ?? t('common.unknown'), version })
                : t('deviceEnvironment.actionInstall', { version });
        return `${outcome} · ${action}`;
    }
    if (row.plan) {
        switch (row.plan.action) {
            case 'install': return t('deviceEnvironment.actionInstall', { version: row.plan.targetVersion ?? t('common.unknown') });
            case 'upgrade': return t('deviceEnvironment.actionUpgrade', {
                from: row.plan.fromVersion ?? t('common.unknown'), version: row.plan.targetVersion ?? t('common.unknown'),
            });
            case 'none': return t('deviceEnvironment.actionNone');
            case 'manual-repair': return t('deviceEnvironment.actionManualRepair');
        }
    }
    if (row.status === 'manual-repair') return t('deviceEnvironment.actionManualRepair');
    return t(row.status === 'pending' ? 'deviceEnvironment.scanAgain' : 'deviceEnvironment.previewRequired');
}

function atTarget(row: FleetRow, target: FleetTarget): boolean {
    return target.kind === 'ready' && row.online && !row.requiresScan
        && !['pending', 'failed', 'rpc-timeout', 'rpc-error', 'stale-plan'].includes(row.status)
        && row.observation?.support === 'supported' && row.observation.installed
        && row.observation.installedVersion === target.targetVersion;
}

const MachineEnvironmentRow = React.memo(({ row, target, applying }: { row: FleetRow; target: FleetTarget; applying: boolean }) => {
    const { theme } = useUnistyles();
    const observed = row.observation;
    const installed = observed
        ? observed.installed ? observed.installedVersion ?? t('common.unknown') : t('deviceEnvironment.notInstalled')
        : t('common.unknown');
    const targetVersion = row.plan?.targetVersion ?? (target.kind === 'ready' ? target.targetVersion : observed?.packageManager.stableVersion);
    const auth = observed?.authentication.status;
    const authLabel = t(auth === 'authenticated' ? 'deviceEnvironment.authReady'
        : auth === 'missing' ? 'deviceEnvironment.authMissing' : 'deviceEnvironment.authUnknown');
    const reason = reasonLabel(row.reasonCode ?? row.plan?.reasonCode ?? observed?.reasonCode);
    const repair = row.result?.repairGuide;
    const needsRepair = repair || row.status === 'manual-repair' || row.status === 'failed' || auth === 'missing';
    const pendingApply = applying && (row.plan?.action === 'install' || row.plan?.action === 'upgrade');
    const action = actionLabel(row, target);

    return (
        <ItemGroup>
            <View testID={`environment-machine-${row.machineId}`}>
                <Item
                    title={machineName(row)}
                    subtitle={t(row.online ? 'deviceEnvironment.daemonOnline' : 'deviceEnvironment.daemonOffline')}
                    icon={<Ionicons name="desktop-outline" size={26} color={row.online ? theme.colors.status.connected : theme.colors.status.disconnected} />}
                    showChevron={false}
                />
                <View style={styles.machineDetails}>
                    <View style={styles.versions}>
                        <Text style={styles.secondary}>{t('deviceEnvironment.versionInstalled', { version: installed })}</Text>
                        <Text style={atTarget(row, target) ? styles.ready : styles.secondary}>
                            {t('deviceEnvironment.versionTarget', { version: targetVersion ?? t('common.unknown') })}
                        </Text>
                    </View>
                    <Text style={auth === 'authenticated' ? styles.ready : styles.secondary}>{authLabel}</Text>
                    <Text style={styles.actionText}>{pendingApply ? `${t('deviceEnvironment.applying')} · ${action}` : action}</Text>
                    {reason && !action.includes(reason) ? <Text style={styles.guidance}>{reason}</Text> : null}
                    {!row.online ? <Text style={styles.guidance}>{t('deviceEnvironment.offlineRecovery')}</Text> : null}
                    {needsRepair ? <Text style={styles.guidance}>
                        {t(repair?.channel === 'local-terminal' ? 'deviceEnvironment.repairLocally' : 'deviceEnvironment.repairWithSsh')}
                    </Text> : null}
                    {repair?.commands.map((command, index) => <Text key={index} selectable style={styles.command}>{command}</Text>)}
                </View>
            </View>
        </ItemGroup>
    );
});

// Item supplies the shared content layout; the outer control adds keyboard and
// pointer feedback using the same semantic surfaces on desktop and native.
const EnvironmentAction = React.memo(({ testID, title, disabled, loading, onPress }: {
    testID: string; title: string; disabled: boolean; loading?: boolean; onPress(): void;
}) => {
    const [hovered, setHovered] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    React.useEffect(() => {
        // Disabling a focused web control can suppress its blur callback.
        // Do not restore that obsolete focus when an operation finishes.
        if (disabled) setFocused(false);
    }, [disabled]);
    return (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityState={{ disabled, busy: Boolean(loading) }}
            disabled={disabled}
            onPress={onPress}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={({ pressed }) => [styles.action, !disabled && (hovered || pressed) && styles.actionPressed,
                !disabled && focused && styles.actionFocused, disabled && styles.actionDisabled]}
        >
            <Item title={title} loading={loading} showChevron={false} titleStyle={styles.actionTitle} />
        </Pressable>
    );
});

const DeviceEnvironmentContent = React.memo(({ controller }: { controller: DeviceEnvironmentController }) => {
    const latest = React.useRef(controller);
    latest.current = controller;
    const mounted = React.useRef(true);
    React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const busyPhase = ['scanning', 'previewing', 'applying'].includes(controller.phase);
    const canPreview = !busyPhase && controller.target.kind === 'ready'
        && (controller.phase === 'scanned' || controller.phase === 'previewed');
    const canConfirm = !busyPhase && controller.phase === 'previewed' && controller.target.kind === 'ready'
        && controller.rows.some((row) => row.online && row.observation?.support === 'supported'
            && (row.status === 'ready' || row.status === 'install' || row.status === 'upgrade')
            && (row.plan?.action === 'none' || row.plan?.action === 'install' || row.plan?.action === 'upgrade'));
    const [working, runAction] = useHappyAction(async (action: 'scan' | 'preview' | 'confirm') => {
        if (busyPhase) return;
        if (action === 'scan') {
            await controller.scan();
        } else if (action === 'preview' && canPreview) {
            await controller.preview();
        } else if (action === 'confirm' && canConfirm) {
            const approved = await Modal.confirm(
                t('deviceEnvironment.confirmTitle'),
                t('deviceEnvironment.confirmMessage', {
                    actions: controller.rows.map((row) => `${machineName(row)}: ${actionLabel(row, controller.target)}`).join('\n'),
                }),
                { confirmText: t('deviceEnvironment.confirmAction'), cancelText: t('common.cancel') },
            );
            // A registry change or unmount invalidates the exact list shown in the dialog.
            if (approved && mounted.current && latest.current.phase === 'previewed'
                && latest.current.rows === controller.rows && latest.current.target === controller.target) {
                await controller.applyApproved();
            }
        }
    });
    const busy = busyPhase || working;
    const ready = controller.rows.filter((row) => atTarget(row, controller.target)).length;
    const needsAttention = controller.phase === 'completed' && controller.rows.some((row) =>
        !atTarget(row, controller.target) || row.observation?.authentication.status !== 'authenticated');

    return (
        <ItemList containerStyle={styles.container}>
            <ItemGroup footer={t('deviceEnvironment.authenticationNote')}>
                <View style={styles.summary} accessibilityLiveRegion="polite">
                    <Text style={styles.heading}>{t('deviceEnvironment.githubCli')}</Text>
                    <Text testID="environment-summary" style={styles.summaryCount}>
                        {t('deviceEnvironment.fleetReady', { ready, total: controller.rows.length })}
                    </Text>
                    <Text style={styles.secondary}>{t('deviceEnvironment.subtitle')}</Text>
                    {controller.rows.length === 0 ? <Text style={styles.secondary}>{t('deviceEnvironment.emptyFleet')}</Text> : null}
                    {controller.target.kind === 'blocked' ? <Text style={styles.guidance}>{t('deviceEnvironment.versionSourceMismatch')}</Text> : null}
                    {needsAttention ? <Text style={styles.guidance}>{t('deviceEnvironment.partialFailure')}</Text> : null}
                </View>
            </ItemGroup>
            <ItemGroup>
                <EnvironmentAction testID="environment-scan-all"
                    title={t(controller.phase === 'scanning' ? 'deviceEnvironment.scanning' : 'deviceEnvironment.scanAll')}
                    disabled={busy || controller.rows.length === 0} loading={controller.phase === 'scanning'} onPress={() => runAction('scan')} />
                <EnvironmentAction testID="environment-preview-alignment"
                    title={t(controller.phase === 'previewing' ? 'deviceEnvironment.previewing' : 'deviceEnvironment.previewAlignment')}
                    disabled={busy || !canPreview} loading={controller.phase === 'previewing'} onPress={() => runAction('preview')} />
                <EnvironmentAction testID="environment-confirm-alignment"
                    title={t(controller.phase === 'applying' ? 'deviceEnvironment.applying' : 'deviceEnvironment.confirmAction')}
                    disabled={busy || !canConfirm} loading={controller.phase === 'applying'} onPress={() => runAction('confirm')} />
            </ItemGroup>
            {controller.rows.map((row) => <MachineEnvironmentRow key={row.machineId} row={row} target={controller.target} applying={controller.phase === 'applying'} />)}
        </ItemList>
    );
});

const ConnectedDeviceEnvironment = React.memo(() => {
    const machines = useAllMachines({ includeOffline: true });
    const controller = useDeviceEnvironment(machines);
    return <DeviceEnvironmentContent controller={controller} />;
});

/** The optional controller keeps previews and component tests independent of live RPCs. */
export const DeviceEnvironmentView = React.memo(({ controller }: { controller?: DeviceEnvironmentController }) => (
    controller ? <DeviceEnvironmentContent controller={controller} /> : <ConnectedDeviceEnvironment />
));

const styles = StyleSheet.create((theme) => ({
    container: { width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center', paddingBottom: 32 },
    summary: { padding: 20, gap: 8 },
    heading: { color: theme.colors.text, fontSize: 20, ...Typography.default('semiBold') },
    summaryCount: { color: theme.colors.text, fontSize: 17, ...Typography.default('semiBold') },
    secondary: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, ...Typography.default() },
    ready: { color: theme.colors.status.connected, fontSize: 14, lineHeight: 21, ...Typography.default() },
    guidance: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, ...Typography.default() },
    machineDetails: { paddingHorizontal: 16, paddingBottom: 18, gap: 8 },
    versions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 24, rowGap: 4 },
    actionText: { color: theme.colors.text, fontSize: 14, lineHeight: 21, ...Typography.default('semiBold') },
    command: { color: theme.colors.text, backgroundColor: theme.colors.surfaceSelected, padding: 10, borderRadius: 6, fontSize: 13, ...Typography.mono() },
    action: { backgroundColor: theme.colors.surface },
    actionPressed: { backgroundColor: theme.colors.surfacePressed },
    actionFocused: { backgroundColor: theme.colors.surfaceSelected },
    actionDisabled: { opacity: 0.5 },
    actionTitle: { color: theme.colors.textLink },
}));
