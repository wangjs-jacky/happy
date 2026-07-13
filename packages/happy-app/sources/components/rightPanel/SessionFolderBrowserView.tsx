import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { FileIcon } from '@/components/FileIcon';
import { sessionListDirectory } from '@/sync/ops';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { t } from '@/text';
import { hapticsLight } from '../haptics';
import { useRightSwipePanel } from '../RightSwipePanelHost';
import { canGoUp, getParentPath, joinChild, resolveBack } from './folderBrowserNav';

type Entry = { name: string; type: 'file' | 'directory' | 'other'; size?: number; modified?: number };

// 逐层懒加载的目录浏览器:根 = 会话工作目录,可上爬到 HOME;点文件跳现有查看器。
export const SessionFolderBrowserView = React.memo(function SessionFolderBrowserView(props: {
    sessionId: string;
    rootPath: string;
    homeDir: string;
    onExit: () => void;
}) {
    const { sessionId, rootPath, homeDir, onExit } = props;
    const { theme } = useUnistyles();
    const router = useRouter();
    const panel = useRightSwipePanel();
    const [currentPath, setCurrentPath] = React.useState(rootPath);
    const [entries, setEntries] = React.useState<Entry[]>([]);
    const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
    const [reloadTick, setReloadTick] = React.useState(0);

    // 路径变化(或手动重试)时拉取当前目录列表。
    React.useEffect(() => {
        let cancelled = false;
        setStatus('loading');
        (async () => {
            const res = await sessionListDirectory(sessionId, currentPath);
            if (cancelled) return;
            if (res.success && Array.isArray(res.entries)) {
                setEntries(res.entries as Entry[]);
                setStatus('ready');
            } else {
                setStatus('error');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [sessionId, currentPath, reloadTick]);

    const handleBack = React.useCallback(() => {
        const target = resolveBack(currentPath, rootPath, homeDir);
        if (target.kind === 'up') {
            setCurrentPath(target.path);
        } else {
            onExit();
        }
        return true;
    }, [currentPath, rootPath, homeDir, onExit]);

    // 把面板返回手势也接到同一套逻辑;路径变化时重挂,保证读到最新位置。
    React.useEffect(() => {
        return panel?.registerBackHandler(handleBack);
    }, [panel, handleBack]);

    const goUp = React.useCallback(() => {
        if (!canGoUp(currentPath, homeDir)) return;
        hapticsLight();
        setCurrentPath(getParentPath(currentPath));
    }, [currentPath, homeDir]);

    const openEntry = React.useCallback((entry: Entry) => {
        hapticsLight();
        const childPath = joinChild(currentPath, entry.name);
        if (entry.type === 'directory') {
            setCurrentPath(childPath);
        } else {
            router.push(`/session/${sessionId}/file?path=${btoa(childPath)}` as any);
            panel?.closePanel();
        }
    }, [currentPath, router, sessionId, panel]);

    const upEnabled = canGoUp(currentPath, homeDir);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Pressable hitSlop={8} onPress={handleBack} style={styles.headerButton}>
                    <Ionicons color={theme.colors.text} name="chevron-back" size={20} />
                </Pressable>
                <Text numberOfLines={1} style={[styles.headerPath, { color: theme.colors.text }]}>
                    {formatPathRelativeToHome(currentPath, homeDir)}
                </Text>
                <Pressable
                    accessibilityLabel={t('rightPanelCapabilityHub.folderBrowser.upOneLevel')}
                    disabled={!upEnabled}
                    hitSlop={8}
                    onPress={goUp}
                    style={styles.headerButton}
                >
                    <Ionicons
                        color={upEnabled ? theme.colors.text : theme.colors.textSecondary}
                        name="arrow-up"
                        size={20}
                    />
                </Pressable>
            </View>

            {status === 'loading' ? (
                <View style={styles.center}>
                    <ActivityIndicator color={theme.colors.textSecondary} size="small" />
                </View>
            ) : status === 'error' ? (
                <View style={styles.center}>
                    <Text style={[styles.muted, { color: theme.colors.textSecondary }]}>
                        {t('rightPanelCapabilityHub.folderBrowser.loadError')}
                    </Text>
                    <Pressable onPress={() => setReloadTick((n) => n + 1)} style={styles.retryButton}>
                        <Text style={[styles.retryText, { color: theme.colors.textLink }]}>
                            {t('rightPanelCapabilityHub.folderBrowser.retry')}
                        </Text>
                    </Pressable>
                </View>
            ) : entries.length === 0 ? (
                <View style={styles.center}>
                    <Text style={[styles.muted, { color: theme.colors.textSecondary }]}>
                        {t('rightPanelCapabilityHub.empty.folderBrowser')}
                    </Text>
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                    {entries.map((entry) => (
                        <Pressable
                            key={entry.name}
                            onPress={() => openEntry(entry)}
                            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
                        >
                            {entry.type === 'directory' ? (
                                <Ionicons color={theme.colors.textLink} name="folder" size={18} style={styles.rowIcon} />
                            ) : (
                                <View style={styles.rowIcon}>
                                    <FileIcon fileName={entry.name} size={18} />
                                </View>
                            )}
                            <Text numberOfLines={1} style={[styles.rowName, { color: theme.colors.text }]}>
                                {entry.name}
                            </Text>
                            {entry.type === 'directory' && (
                                <Ionicons color={theme.colors.textSecondary} name="chevron-forward" size={16} />
                            )}
                        </Pressable>
                    ))}
                </ScrollView>
            )}
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
    },
    header: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
        paddingBottom: 10,
        paddingHorizontal: 4,
        paddingTop: 6,
    },
    headerButton: {
        alignItems: 'center',
        height: 32,
        justifyContent: 'center',
        width: 32,
    },
    headerPath: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
    },
    center: {
        alignItems: 'center',
        flex: 1,
        gap: 10,
        justifyContent: 'center',
        paddingVertical: 40,
    },
    muted: {
        fontSize: 13,
    },
    retryButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    retryText: {
        fontSize: 14,
        fontWeight: '600',
    },
    listContent: {
        paddingBottom: 24,
    },
    row: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 4,
        paddingVertical: 10,
    },
    rowIcon: {
        alignItems: 'center',
        height: 20,
        justifyContent: 'center',
        width: 20,
    },
    rowName: {
        flex: 1,
        fontSize: 14,
    },
}));
