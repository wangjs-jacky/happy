import * as React from 'react';
import { AccessibilityInfo, Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { hapticsLight } from '../haptics';
import { useRightSwipePanel } from '../RightSwipePanelHost';
import type { AgentSpaceCompanionModel, CompanionAction } from './agentSpaceCompanionModel';
import type { AgentLauncher } from './launchAgent';

const TIP_ROTATION_INTERVAL_MS = 8_000;

type AgentIdentity = Pick<AgentLauncher, 'name' | 'glyph' | 'color'>;

type Props = {
    agent?: AgentIdentity;
    model: AgentSpaceCompanionModel;
    onInsertPrompt: (prompt: string) => void;
};

export const AgentSpaceCompanionPanel = React.memo(function AgentSpaceCompanionPanel({ agent, model, onInsertPrompt }: Props) {
    const { theme } = useUnistyles();
    const panel = useRightSwipePanel();
    const [activeTipIndex, setActiveTipIndex] = React.useState(0);
    const [reduceMotion, setReduceMotion] = React.useState<boolean | null>(null);
    const [manuallySelected, setManuallySelected] = React.useState(false);
    const accent = agent?.color ?? theme.colors.accent;
    const activeTip = model.tips[activeTipIndex];

    React.useEffect(() => {
        let mounted = true;
        let receivedRuntimeValue = false;
        const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
            receivedRuntimeValue = true;
            if (mounted) setReduceMotion(enabled);
        });

        void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
            if (mounted && !receivedRuntimeValue) setReduceMotion(enabled);
        });

        return () => {
            mounted = false;
            subscription.remove();
        };
    }, []);

    React.useEffect(() => {
        if (model.tips.length <= 1 || reduceMotion !== false || manuallySelected) return;
        const timer = setInterval(() => {
            setActiveTipIndex((current) => (current + 1) % model.tips.length);
        }, TIP_ROTATION_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [manuallySelected, model.tips.length, reduceMotion]);

    const selectTip = React.useCallback((index: number) => {
        setManuallySelected(true);
        setActiveTipIndex(index);
    }, []);

    const runAction = React.useCallback((action: CompanionAction) => {
        hapticsLight();
        if (!panel) return;
        panel.closePanel(() => onInsertPrompt(action.prompt));
    }, [onInsertPrompt, panel]);

    return (
        <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
        >
            <View style={styles.heading}>
                {!!agent && (
                    <View style={styles.identityRow}>
                        <View style={[styles.avatar, { backgroundColor: accent }]}>
                            <Text style={styles.avatarGlyph}>{agent.glyph}</Text>
                        </View>
                        <Text numberOfLines={1} style={styles.agentName}>{agent.name}</Text>
                    </View>
                )}
                <Text style={styles.panelTitle}>{model.title}</Text>
                {!!model.subtitle && <Text style={styles.panelSubtitle}>{model.subtitle}</Text>}
            </View>

            {!!activeTip && (
                <View style={[styles.tipCard, { borderColor: accent }]}>
                    <Text style={[styles.tipEyebrow, { color: accent }]}>{activeTip.eyebrow}</Text>
                    <Text style={styles.tipTitle}>{activeTip.title}</Text>
                    <Text style={styles.tipBody}>{activeTip.body}</Text>
                    {model.tips.length > 1 && (
                        <View style={styles.pagination}>
                            {model.tips.map((tip, index) => {
                                const selected = index === activeTipIndex;
                                return (
                                    <Pressable
                                        accessibilityLabel={t('agentSpace.companion.paginationAccessibility', {
                                            current: index + 1,
                                            total: model.tips.length,
                                        })}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected }}
                                        key={tip.id}
                                        onPress={() => selectTip(index)}
                                        style={styles.paginationTarget}
                                    >
                                        <View
                                            style={[
                                                styles.paginationDot,
                                                { backgroundColor: selected ? accent : theme.colors.divider },
                                                selected && styles.paginationDotSelected,
                                            ]}
                                        />
                                    </Pressable>
                                );
                            })}
                        </View>
                    )}
                </View>
            )}

            {model.actions.length > 0 && (
                <View style={styles.actionGrid}>
                    {model.actions.map((action) => (
                        <Pressable
                            accessibilityLabel={t('agentSpace.companion.actionAccessibility', { title: action.title })}
                            accessibilityRole="button"
                            key={action.id}
                            onPress={() => runAction(action)}
                            style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
                        >
                            <View style={[styles.actionIcon, { backgroundColor: accent }]}>
                                <MaterialCommunityIcons
                                    color="#FFFFFF"
                                    name={action.icon as React.ComponentProps<typeof MaterialCommunityIcons>['name']}
                                    size={19}
                                />
                            </View>
                            <Text style={styles.actionTitle}>{action.title}</Text>
                        </Pressable>
                    ))}
                </View>
            )}
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    content: {
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 24,
        gap: 16,
    },
    heading: {
        gap: 3,
    },
    identityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 8,
    },
    avatar: {
        width: 44,
        height: 44,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarGlyph: {
        color: '#FFFFFF',
        fontSize: 21,
        ...Typography.default('semiBold'),
    },
    agentName: {
        flex: 1,
        color: theme.colors.text,
        fontSize: 17,
        ...Typography.default('semiBold'),
    },
    panelTitle: {
        color: theme.colors.text,
        fontSize: 22,
        ...Typography.default('semiBold'),
    },
    panelSubtitle: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 19,
        ...Typography.default(),
    },
    tipCard: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 18,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 16,
        paddingTop: 17,
        paddingBottom: 6,
    },
    tipEyebrow: {
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    tipTitle: {
        color: theme.colors.text,
        fontSize: 19,
        lineHeight: 25,
        marginTop: 5,
        ...Typography.default('semiBold'),
    },
    tipBody: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 20,
        marginTop: 7,
        ...Typography.default(),
    },
    pagination: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 5,
    },
    paginationTarget: {
        minWidth: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    paginationDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    paginationDotSelected: {
        width: 18,
    },
    actionGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    actionCard: {
        flexGrow: 1,
        flexBasis: '45%',
        minWidth: 44,
        minHeight: 96,
        justifyContent: 'space-between',
        backgroundColor: theme.colors.surfaceHigh,
        borderColor: theme.colors.divider,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
        padding: 13,
    },
    actionIcon: {
        width: 34,
        height: 34,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionTitle: {
        color: theme.colors.text,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 11,
        ...Typography.default('semiBold'),
    },
    pressed: {
        opacity: 0.68,
    },
}));
