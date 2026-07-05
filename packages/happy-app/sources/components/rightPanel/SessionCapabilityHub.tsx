import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Modal } from '@/modal';
import { useSettingMutable } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { hapticsLight } from '../haptics';
import { useRightSwipePanel } from '../RightSwipePanelHost';
import { CapabilityBlockCard } from './CapabilityBlockCard';
import { CapabilityHubDetailView } from './CapabilityHubDetailView';
import type { CapabilityKey, QuickPromptCapabilityItem } from './sessionCapabilityHubModel';
import { useSessionCapabilityHub } from './useSessionCapabilityHub';

const BLOCK_ORDER: CapabilityKey[] = ['skills', 'quickPrompts', 'images', 'artifacts', 'files'];

export const SessionCapabilityHub = React.memo(function SessionCapabilityHub(props: {
    sessionId?: string;
}) {
    if (!props.sessionId) {
        return <CapabilityHubPlaceholder />;
    }
    return <SessionCapabilityHubInner sessionId={props.sessionId} />;
});

const SessionCapabilityHubInner = React.memo(function SessionCapabilityHubInner(props: {
    sessionId: string;
}) {
    const { theme } = useUnistyles();
    const model = useSessionCapabilityHub(props.sessionId);
    const panel = useRightSwipePanel();
    const [quickPrompts, setQuickPrompts] = useSettingMutable('quickPrompts');
    const [selectedKey, setSelectedKey] = React.useState<CapabilityKey | null>(null);

    React.useEffect(() => {
        setSelectedKey(null);
    }, [props.sessionId]);

    React.useEffect(() => {
        if (!selectedKey) return;
        return panel?.registerBackHandler(() => {
            setSelectedKey(null);
            return true;
        });
    }, [panel, selectedKey]);

    const addQuickPrompt = React.useCallback(async () => {
        const title = (await Modal.prompt(
            t('rightPanelCapabilityHub.quickPrompt.addTitle'),
            t('rightPanelCapabilityHub.quickPrompt.addTitleMessage'),
            {
                placeholder: t('rightPanelCapabilityHub.quickPrompt.titlePlaceholder'),
                confirmText: t('common.continue'),
            },
        ))?.trim();
        if (!title) return;

        const prompt = (await Modal.prompt(
            t('rightPanelCapabilityHub.quickPrompt.addBodyTitle'),
            t('rightPanelCapabilityHub.quickPrompt.addBodyMessage'),
            {
                placeholder: t('rightPanelCapabilityHub.quickPrompt.bodyPlaceholder'),
                confirmText: t('common.save'),
            },
        ))?.trim();
        if (!prompt) return;

        const now = Date.now();
        setQuickPrompts([
            {
                id: `quick-prompt-${now}`,
                title,
                prompt,
                createdAt: now,
                updatedAt: now,
            },
            ...quickPrompts,
        ]);
        setSelectedKey('quickPrompts');
    }, [quickPrompts, setQuickPrompts]);

    const deleteQuickPrompt = React.useCallback(async (item: QuickPromptCapabilityItem) => {
        const confirmed = await Modal.confirm(
            t('rightPanelCapabilityHub.quickPrompt.deleteTitle'),
            t('rightPanelCapabilityHub.quickPrompt.deleteMessage', { title: item.title }),
            {
                confirmText: t('common.delete'),
                destructive: true,
            },
        );
        if (!confirmed) return;
        setQuickPrompts(quickPrompts.filter((entry) => entry.id !== item.id));
    }, [quickPrompts, setQuickPrompts]);

    const runQuickPrompt = React.useCallback((item: QuickPromptCapabilityItem) => {
        hapticsLight();
        sync.sendMessage(props.sessionId, item.prompt, { source: 'chat' });
        panel?.closePanel();
    }, [panel, props.sessionId]);

    if (selectedKey) {
        return (
            <CapabilityHubDetailView
                count={model.details[selectedKey].length}
                items={model.details[selectedKey]}
                onAddQuickPrompt={selectedKey === 'quickPrompts' ? addQuickPrompt : undefined}
                onBack={() => setSelectedKey(null)}
                onDeleteQuickPrompt={deleteQuickPrompt}
                onRunQuickPrompt={runQuickPrompt}
                sessionId={props.sessionId}
                title={t(`rightPanelCapabilityHub.blocks.${selectedKey}` as const)}
                type={selectedKey}
            />
        );
    }

    return (
        <ScrollView
            contentContainerStyle={styles.summaryContent}
            showsVerticalScrollIndicator={false}
        >
            <View style={styles.heading}>
                <Text numberOfLines={1} style={[styles.headingTitle, { color: theme.colors.text }]}>
                    {t('rightPanelCapabilityHub.title')}
                </Text>
            </View>

            <View style={styles.grid}>
                {BLOCK_ORDER.map((key) => {
                    const block = model.blocks.find((entry) => entry.key === key);
                    if (!block) return null;
                    return (
                        <CapabilityBlockCard
                            count={block.count}
                            icon={renderBlockIcon(key, theme.colors.text)}
                            key={key}
                            onPress={() => setSelectedKey(key)}
                            preview={block.preview}
                            title={t(`rightPanelCapabilityHub.blocks.${key}` as const)}
                        />
                    );
                })}
            </View>
        </ScrollView>
    );
});

const CapabilityHubPlaceholder = React.memo(function CapabilityHubPlaceholder() {
    const { theme } = useUnistyles();

    return (
        <ScrollView
            contentContainerStyle={styles.summaryContent}
            showsVerticalScrollIndicator={false}
        >
            <View style={styles.heading}>
                <Text numberOfLines={1} style={[styles.headingTitle, { color: theme.colors.text }]}>
                    {t('rightPanelCapabilityHub.title')}
                </Text>
                <Text style={[styles.placeholderCopy, { color: theme.colors.textSecondary }]}>
                    {t('rightPanelCapabilityHub.emptyHomeDescription')}
                </Text>
            </View>

            <View style={styles.grid}>
                {BLOCK_ORDER.map((key) => (
                    <CapabilityBlockCard
                        count={0}
                        disabled={true}
                        icon={renderBlockIcon(key, theme.colors.textSecondary)}
                        key={key}
                        preview={null}
                        title={t(`rightPanelCapabilityHub.blocks.${key}` as const)}
                    />
                ))}
            </View>
        </ScrollView>
    );
});

function renderBlockIcon(key: CapabilityKey, color: string) {
    switch (key) {
        case 'skills':
            return <Ionicons color={color} name="flash-outline" size={16} />;
        case 'quickPrompts':
            return <Ionicons color={color} name="chatbubble-ellipses-outline" size={16} />;
        case 'images':
            return <Ionicons color={color} name="image-outline" size={16} />;
        case 'artifacts':
            return <Ionicons color={color} name="document-text-outline" size={16} />;
        case 'files':
            return <Octicons color={color} name="file-code" size={15} />;
    }
}

const styles = StyleSheet.create(() => ({
    summaryContent: {
        paddingBottom: 24,
        paddingHorizontal: 12,
        paddingTop: 10,
    },
    heading: {
        marginBottom: 12,
        paddingHorizontal: 2,
    },
    headingTitle: {
        fontSize: 19,
        fontWeight: '700',
        letterSpacing: -0.4,
    },
    placeholderCopy: {
        fontSize: 13,
        lineHeight: 18,
        marginTop: 6,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        rowGap: 10,
    },
}));
