import * as React from 'react';
import { View, Text, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { hapticsLight } from '../haptics';
import { t } from '@/text';

type Domain = 'sleep' | 'exercise' | 'diet';

interface Props {
    active: Domain;
    onSelect: (d: Domain) => void;
    done: { sleep: boolean; exercise: boolean; diet: boolean };
}

const DOMAINS: Domain[] = ['sleep', 'exercise', 'diet'];

function domainLabel(d: Domain): string {
    if (d === 'sleep') return t('healthPanel.sleep');
    if (d === 'exercise') return t('healthPanel.exercise');
    return t('healthPanel.diet');
}

/**
 * 健康域切换器：三段式 segmented control，显示当前域高亮，
 * 并在每段标签旁用小点标记该域今日是否已完成打卡。
 */
export const HealthDomainSwitcher = React.memo(function HealthDomainSwitcher(props: Props) {
    const { theme } = useUnistyles();

    return (
        <View style={styles.tabs}>
            {DOMAINS.map((d) => {
                const isActive = d === props.active;
                const isDone = props.done[d];
                return (
                    <Pressable
                        key={d}
                        onPress={() => {
                            hapticsLight();
                            props.onSelect(d);
                        }}
                        style={({ pressed }) => [
                            styles.tab,
                            isActive && styles.tabActive,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                            {domainLabel(d)}
                        </Text>
                        {/* 已完成打卡的域显示实心绿点，否则不渲染占位圆 */}
                        <View
                            style={[
                                styles.dot,
                                { backgroundColor: isDone ? theme.colors.status.connected : 'transparent' },
                            ]}
                        />
                    </Pressable>
                );
            })}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    tabs: {
        flexDirection: 'row',
        gap: 4,
        backgroundColor: theme.colors.surfacePressed,
        borderRadius: 10,
        padding: 3,
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 6,
        paddingHorizontal: 4,
        borderRadius: 7,
        gap: 3,
    },
    tabActive: {
        backgroundColor: theme.colors.surface,
    },
    tabText: {
        fontSize: 13,
        fontWeight: '500',
        color: theme.colors.textSecondary,
    },
    tabTextActive: {
        color: theme.colors.text,
        fontWeight: '600',
    },
    dot: {
        width: 5,
        height: 5,
        borderRadius: 3,
    },
    pressed: {
        opacity: 0.6,
    },
}));
