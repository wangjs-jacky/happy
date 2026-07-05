import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { useUnistyles } from 'react-native-unistyles';
import { useOtaVersions, OtaVersion } from '@/hooks/useOtaVersions';
import { useOtaTarget } from '@/hooks/useOtaTarget';
import {
    compactOtaMessage,
    formatOtaVersionLine,
    getOtaVersionState,
    getRecommendedOtaVersion,
} from '@/hooks/otaVersionDisplay';
import { t } from '@/text';

// OTA 版本选择器（dev 页，preview 频道专用）。
// 解决「回归验收时不知道真机当前跑哪个 commit 的 OTA」：列出 preview 频道全部历史版本，
// 高亮当前运行 / 当前锁定项，点选即把本设备锁定到该版本（reload 生效），可一键解除锁定回到最新。
// production 包拉的是 production 频道，FC 忽略锁定参数，故此页只对 preview 包有意义。

export default function OtaVersionsScreen() {
    const { theme } = useUnistyles();
    const { versions, loading: listLoading, error, debug, refresh } = useOtaVersions('preview');
    const { lockedStamp, currentUpdateId, channel, loading: targetLoading, lockTo, unlock } = useOtaTarget();
    const recommendedVersion = React.useMemo(() => getRecommendedOtaVersion(versions), [versions]);

    const formatLine = React.useCallback((v: OtaVersion) => formatOtaVersionLine(v, {
        noCommitInfo: (id) => t('devTools.noCommitInfo', { id }),
    }), []);

    const handleLock = React.useCallback((v: OtaVersion) => {
        (async () => {
            const line = formatLine(v);
            const message = compactOtaMessage(line.message);
            const confirmed = await Modal.confirm(
                t('devTools.switchToThisVersion'),
                t('devTools.lockToVersionMessage', { title: line.title, subtitle: line.subtitle, message }),
                { confirmText: t('devTools.switchAndReload'), cancelText: t('common.cancel') },
            );
            if (confirmed) {
                await lockTo(v.stamp); // 内部会 reloadAsync，调用后 App 重启
            }
        })();
    }, [lockTo]);

    const handleUnlock = React.useCallback(() => {
        (async () => {
            const confirmed = await Modal.confirm(
                t('devTools.unlockVersion'),
                t('devTools.unlockVersionMessage'),
                { confirmText: t('devTools.unlockAndReload'), cancelText: t('common.cancel') },
            );
            if (confirmed) {
                await unlock();
            }
        })();
    }, [unlock]);

    const renderRecommendation = () => {
        if (listLoading || error || !recommendedVersion) {
            return null;
        }

        const line = formatLine(recommendedVersion);
        const state = getOtaVersionState(recommendedVersion, currentUpdateId, lockedStamp);
        const message = compactOtaMessage(line.message, 220);
        const canSwitch = channel === 'preview' && !state.isRunning;
        const subtitle = [
            line.title,
            line.subtitle,
            message,
        ].filter(Boolean).join('\n');

        return (
            <ItemGroup title={t('devTools.recommendedOtaTitle')} footer={t('devTools.recommendedOtaFooter')}>
                <Item
                    title={state.isRunning ? t('devTools.recommendedOtaRunning') : t('devTools.recommendedLatestPreview')}
                    subtitle={subtitle}
                    subtitleLines={0}
                    selected={state.isLocked}
                    leftElement={
                        <Ionicons
                            name={state.isRunning ? 'checkmark-circle' : 'sparkles-outline'}
                            size={20}
                            color={state.isRunning ? (theme.colors.success ?? '#34C759') : (theme.colors.status?.connecting ?? theme.colors.text)}
                        />
                    }
                    rightElement={state.isRunning ? <Ionicons name="checkmark" size={20} color={theme.colors.success ?? '#34C759'} /> : undefined}
                    showChevron={canSwitch}
                    onPress={canSwitch ? () => handleLock(recommendedVersion) : undefined}
                />
            </ItemGroup>
        );
    };

    return (
        <ItemList>
            {/* 当前状态：直接回答「我在看哪个版本」 */}
            <ItemGroup
                title={t('devTools.currentStatus')}
                footer={channel !== 'preview' ? t('devTools.notPreviewWarning') : undefined}
            >
                <Item
                    title={t('devTools.channel')}
                    detail={channel || t('common.unknown')}
                    icon={<Ionicons name="git-branch-outline" size={29} color={theme.colors.status?.connecting ?? theme.colors.text} />}
                />
                <Item
                    title={t('devTools.currentRunningUpdateId')}
                    detail={currentUpdateId ? currentUpdateId.slice(0, 8) : t('devTools.embeddedBundle')}
                    copy={currentUpdateId || undefined}
                    icon={<Ionicons name="cube-outline" size={29} color={theme.colors.text} />}
                />
                <Item
                    title={t('devTools.lockStatus')}
                    detail={lockedStamp ? t('devTools.locked') : t('devTools.followLatest')}
                    icon={<Ionicons name={lockedStamp ? 'lock-closed-outline' : 'lock-open-outline'} size={29} color={lockedStamp ? theme.colors.text : theme.colors.textSecondary} />}
                />
                {lockedStamp ? (
                    <Item
                        title={t('devTools.unlockToLatest')}
                        destructive
                        loading={targetLoading}
                        icon={<Ionicons name="refresh-outline" size={29} color={theme.colors.textDestructive ?? '#FF3B30'} />}
                        onPress={handleUnlock}
                    />
                ) : null}
            </ItemGroup>

            {renderRecommendation()}

            {/* 版本列表 */}
            <ItemGroup title={t('devTools.previewHistoryTitle')} footer={t('devTools.previewHistoryFooter')}>
                {listLoading ? (
                    <View style={{ padding: theme.margins.lg, alignItems: 'center' }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : error ? (
                    <Item
                        title={t('devTools.loadFailedRetry')}
                        subtitle={error}
                        icon={<Ionicons name="alert-circle-outline" size={29} color={theme.colors.textDestructive ?? '#FF3B30'} />}
                        onPress={() => refresh()}
                    />
                ) : versions.length === 0 ? (
                    <Item title={t('devTools.noVersions')} subtitle={t('devTools.noVersionsSubtitle')} />
                ) : (
                    versions.map((v) => {
                        const line = formatLine(v);
                        const { isRunning, isLocked } = getOtaVersionState(v, currentUpdateId, lockedStamp);
                        const isLatest = v === recommendedVersion;
                        return (
                            <Item
                                key={v.stamp}
                                title={line.title}
                                subtitle={line.subtitle}
                                subtitleLines={2}
                                detail={isLatest && !isLocked ? t('devTools.latestPreview') : undefined}
                                selected={isLocked}
                                leftElement={
                                    <Ionicons
                                        name={isRunning ? 'ellipse' : 'ellipse-outline'}
                                        size={14}
                                        color={isRunning ? (theme.colors.success ?? '#34C759') : theme.colors.textSecondary}
                                    />
                                }
                                rightElement={isLocked ? <Ionicons name="checkmark" size={20} color={theme.colors.success ?? '#34C759'} /> : undefined}
                                onPress={() => handleLock(v)}
                            />
                        );
                    })
                )}
            </ItemGroup>

            <ItemGroup title={t('devTools.diagnostics')} footer={debug || t('devTools.diagnosticsFooter')}>
                <Item
                    title={t('devTools.refreshVersionList')}
                    loading={listLoading}
                    icon={<Ionicons name="reload-outline" size={29} color={theme.colors.text} />}
                    onPress={() => refresh()}
                />
                <Item
                    title={t('devTools.copyDiagnostics')}
                    detail={versions.length ? t('devTools.versionsCount', { count: versions.length }) : t('devTools.empty')}
                    copy={debug || 'no-debug'}
                    icon={<Ionicons name="bug-outline" size={29} color={theme.colors.textSecondary} />}
                />
            </ItemGroup>
        </ItemList>
    );
}
