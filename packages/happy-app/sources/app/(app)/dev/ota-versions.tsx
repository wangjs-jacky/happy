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
import { t } from '@/text';

// OTA 版本选择器（dev 页，preview 频道专用）。
// 解决「回归验收时不知道真机当前跑哪个 commit 的 OTA」：列出 preview 频道全部历史版本，
// 高亮当前运行 / 当前锁定项，点选即把本设备锁定到该版本（reload 生效），可一键解除锁定回到最新。
// production 包拉的是 production 频道，FC 忽略锁定参数，故此页只对 preview 包有意义。

// 把一个版本渲染成一行的文案：PR 预览 OTA 优先展示发布时记录的中文标题，
// 没有 display 元数据的历史版本继续退回 commit subject。
function shortLine(v: OtaVersion): { title: string; subtitle: string; message?: string } {
    const sha = v.git?.sha ? `${v.git.sha}${v.git.dirty ? '*' : ''}` : v.id.slice(0, 8);
    const when = v.createdAt ? new Date(v.createdAt).toLocaleString() : v.stamp;
    const branch = v.git?.branch ? ` · ${v.git.branch}` : '';
    const title = v.display?.title || v.git?.subject || `(无 commit 信息) ${v.id.slice(0, 8)}`;
    const source = v.display?.source?.number ? `PR #${v.display.source.number} · ` : '';
    const commitSubject = v.display?.title && v.git?.subject ? `${v.git.subject} · ` : '';
    return {
        title,
        subtitle: `${source}${commitSubject}${sha}${branch} · ${when}`,
        message: v.display?.message,
    };
}

function previewMessage(message: string | undefined): string {
    if (!message) return '';
    const compact = message.replace(/\n{3,}/g, '\n\n').trim();
    return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
}

export default function OtaVersionsScreen() {
    const { theme } = useUnistyles();
    const { versions, loading: listLoading, error, debug, refresh } = useOtaVersions('preview');
    const { lockedStamp, currentUpdateId, channel, loading: targetLoading, lockTo, unlock } = useOtaTarget();

    const handleLock = React.useCallback((v: OtaVersion) => {
        (async () => {
            const line = shortLine(v);
            const message = previewMessage(line.message);
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
                        const line = shortLine(v);
                        const isRunning = !!currentUpdateId && v.id === currentUpdateId;
                        const isLocked = v.stamp === lockedStamp;
                        return (
                            <Item
                                key={v.stamp}
                                title={line.title}
                                subtitle={line.subtitle}
                                subtitleLines={2}
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
