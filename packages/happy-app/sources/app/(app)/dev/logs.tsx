import * as React from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { log, MAX_APP_LOG_ENTRIES } from '@/log';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Item } from '@/components/Item';
import * as Clipboard from 'expo-clipboard';
import { Modal } from '@/modal';
import { t } from '@/text';

export default function LogsScreen() {
    const { theme } = useUnistyles();
    const [logs, setLogs] = React.useState<string[]>([]);
    const flatListRef = React.useRef<FlatList>(null);

    // Subscribe to log changes
    React.useEffect(() => {
        // Add some sample logs if empty (for demo purposes)
        if (log.getCount() === 0) {
            log.log(t('devTools.loggerInitialized'));
            log.log(t('devTools.sampleDebugMessage'));
            log.log(t('devTools.appStartedSuccessfully'));
        }

        // Initial load
        setLogs(log.getLogs());

        // Subscribe to changes
        const unsubscribe = log.onChange(() => {
            setLogs(log.getLogs());
        });

        return unsubscribe;
    }, []);

    // Auto-scroll to bottom when new logs arrive
    React.useEffect(() => {
        if (logs.length > 0) {
            setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: false });
            }, 100);
        }
    }, [logs.length]);

    const handleClear = async () => {
        const confirmed = await Modal.confirm(
            t('devTools.clearLogs'),
            t('devTools.clearLogsConfirmMessage'),
            { confirmText: t('devTools.clearAction'), destructive: true }
        );
        if (confirmed) {
            log.clear();
        }
    };

    const handleCopyAll = async () => {
        if (logs.length === 0) {
            Modal.alert(t('devTools.noLogs'), t('devTools.noLogsToCopy'));
            return;
        }

        const allLogs = logs.join('\n');
        await Clipboard.setStringAsync(allLogs);
        Modal.alert(t('common.copied'), t('devTools.logEntriesCopied', { count: logs.length }));
    };

    const handleAddTestLog = () => {
        const timestamp = new Date().toLocaleTimeString();
        log.log(t('devTools.testLogEntryAt', { time: timestamp }));
    };

    const renderLogItem = ({ item, index }: { item: string; index: number }) => (
        <View style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: '#F0F0F0'
        }}>
            <Text style={{
                fontFamily: 'IBMPlexMono-Regular',
                fontSize: 12,
                color: '#333',
                lineHeight: 16
            }}>
                {item}
            </Text>
        </View>
    );

    return (
        <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
            {/* Header with actions */}
            <ItemList>
                <ItemGroup
                    title={t('devTools.logsTitle', { count: logs.length })}
                    footer={t('devTools.logsFooter', { max: MAX_APP_LOG_ENTRIES.toLocaleString() })}
                >
                    <Item 
                        title={t('devTools.addTestLog')}
                        subtitle={t('devTools.addTestLogSubtitle')}
                        icon={<Ionicons name="add-circle-outline" size={24} color="#34C759" />}
                        onPress={handleAddTestLog}
                    />
                    <Item 
                        title={t('devTools.copyAllLogs')}
                        icon={<Ionicons name="copy-outline" size={24} color={theme.colors.accent} />}
                        onPress={handleCopyAll}
                        disabled={logs.length === 0}
                    />
                    <Item 
                        title={t('devTools.clearAllLogs')}
                        icon={<Ionicons name="trash-outline" size={24} color="#FF3B30" />}
                        onPress={handleClear}
                        disabled={logs.length === 0}
                        destructive={true}
                    />
                </ItemGroup>
            </ItemList>

            {/* Logs display */}
            <View style={{ flex: 1, backgroundColor: '#FFFFFF', margin: 16, borderRadius: 8 }}>
                {logs.length === 0 ? (
                    <View style={{
                        flex: 1,
                        justifyContent: 'center',
                        alignItems: 'center',
                        padding: 32
                    }}>
                        <Ionicons name="document-text-outline" size={48} color="#C0C0C0" />
                        <Text style={{
                            fontSize: 16,
                            color: '#999',
                            marginTop: 16,
                            textAlign: 'center'
                        }}>
                            {t('devTools.noLogsYet')}
                        </Text>
                        <Text style={{
                            fontSize: 14,
                            color: '#C0C0C0',
                            marginTop: 8,
                            textAlign: 'center'
                        }}>
                            {t('devTools.logsWillAppear')}
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        ref={flatListRef}
                        data={logs}
                        renderItem={renderLogItem}
                        keyExtractor={(item, index) => index.toString()}
                        style={{ flex: 1 }}
                        contentContainerStyle={{ paddingVertical: 8 }}
                        showsVerticalScrollIndicator={true}
                    />
                )}
            </View>
        </View>
    );
}
