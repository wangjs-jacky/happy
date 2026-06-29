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

// OTA 版本选择器（dev 页，preview 频道专用）。
// 解决「回归验收时不知道真机当前跑哪个 commit 的 OTA」：列出 preview 频道全部历史版本，
// 高亮当前运行 / 当前锁定项，点选即把本设备锁定到该版本（reload 生效），可一键解除锁定回到最新。
// production 包拉的是 production 频道，FC 忽略锁定参数，故此页只对 preview 包有意义。

// 把一个版本渲染成一行的文案：标题用 commit subject，副标题给 sha + 分支 + 时间。
function shortLine(v: OtaVersion): { title: string; subtitle: string } {
    const sha = v.git?.sha ? `${v.git.sha}${v.git.dirty ? '*' : ''}` : v.id.slice(0, 8);
    const when = v.createdAt ? new Date(v.createdAt).toLocaleString() : v.stamp;
    const branch = v.git?.branch ? ` · ${v.git.branch}` : '';
    return {
        title: v.git?.subject || `(无 commit 信息) ${v.id.slice(0, 8)}`,
        subtitle: `${sha}${branch} · ${when}`,
    };
}

export default function OtaVersionsScreen() {
    const { theme } = useUnistyles();
    const { versions, loading: listLoading, error, refresh } = useOtaVersions('preview');
    const { lockedStamp, currentUpdateId, channel, loading: targetLoading, lockTo, unlock } = useOtaTarget();

    const handleLock = React.useCallback((v: OtaVersion) => {
        (async () => {
            const line = shortLine(v);
            const confirmed = await Modal.confirm(
                '切换到此版本？',
                `${line.title}\n${line.subtitle}\n\n本设备将锁定到该 OTA 版本并立即重载。其他设备不受影响。`,
                { confirmText: '切换并重载', cancelText: '取消' },
            );
            if (confirmed) {
                await lockTo(v.stamp); // 内部会 reloadAsync，调用后 App 重启
            }
        })();
    }, [lockTo]);

    const handleUnlock = React.useCallback(() => {
        (async () => {
            const confirmed = await Modal.confirm(
                '解除版本锁定？',
                '解除后本设备回到「跟随最新」，重载即拉取 preview 频道最新版本。',
                { confirmText: '解除并重载', cancelText: '取消' },
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
                title="当前状态"
                footer={channel !== 'preview' ? '注意：当前不是 preview 包，定向锁定对本包无效（production 永远跟随最新）。' : undefined}
            >
                <Item
                    title="频道"
                    detail={channel || '未知'}
                    icon={<Ionicons name="git-branch-outline" size={29} color={theme.colors.status?.connecting ?? theme.colors.text} />}
                />
                <Item
                    title="当前运行 Update ID"
                    detail={currentUpdateId ? currentUpdateId.slice(0, 8) : '内置包'}
                    copy={currentUpdateId || undefined}
                    icon={<Ionicons name="cube-outline" size={29} color={theme.colors.text} />}
                />
                <Item
                    title="锁定状态"
                    detail={lockedStamp ? '已锁定' : '跟随最新'}
                    icon={<Ionicons name={lockedStamp ? 'lock-closed-outline' : 'lock-open-outline'} size={29} color={lockedStamp ? theme.colors.text : theme.colors.textSecondary} />}
                />
                {lockedStamp ? (
                    <Item
                        title="解除锁定，回到最新"
                        destructive
                        loading={targetLoading}
                        icon={<Ionicons name="refresh-outline" size={29} color={theme.colors.textDestructive ?? '#FF3B30'} />}
                        onPress={handleUnlock}
                    />
                ) : null}
            </ItemGroup>

            {/* 版本列表 */}
            <ItemGroup title="preview 频道历史版本" footer="点选某版本即把本设备锁定到它并重载。绿点 = 当前运行，钩 = 当前锁定。">
                {listLoading ? (
                    <View style={{ padding: theme.margins.lg, alignItems: 'center' }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : error ? (
                    <Item
                        title="加载失败，点此重试"
                        subtitle={error}
                        icon={<Ionicons name="alert-circle-outline" size={29} color={theme.colors.textDestructive ?? '#FF3B30'} />}
                        onPress={() => refresh()}
                    />
                ) : versions.length === 0 ? (
                    <Item title="暂无版本" subtitle="该频道还没有发布过 OTA" />
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

            <ItemGroup>
                <Item
                    title="刷新版本列表"
                    loading={listLoading}
                    icon={<Ionicons name="reload-outline" size={29} color={theme.colors.text} />}
                    onPress={() => refresh()}
                />
            </ItemGroup>
        </ItemList>
    );
}
