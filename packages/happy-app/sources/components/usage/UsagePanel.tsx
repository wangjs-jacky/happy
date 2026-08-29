import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, ScrollView, Pressable } from 'react-native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { ItemGroup } from '@/components/ItemGroup';
import { UsageChart } from './UsageChart';
import { UsageBar } from './UsageBar';
import { getUsageForPeriod, calculateTotals, UsageDataPoint } from '@/sync/apiUsage';
import { Ionicons } from '@expo/vector-icons';
import { HappyError } from '@/utils/errors';
import { t } from '@/text';
import { useAllMachines } from '@/sync/storage';

type TimePeriod = 'today' | '7days' | '30days';

interface CodexRateLimitWindow {
    usedPercent?: number;
    windowMinutes?: number;
    resetsAt?: number;
}

interface CodexUsageSnapshot {
    source: 'codex-session-jsonl';
    scannedAt: number;
    latestEvent?: {
        rateLimits?: {
            planType?: string;
            primary?: CodexRateLimitWindow;
            secondary?: CodexRateLimitWindow;
        };
    } | null;
}

function getCodexUsageSnapshot(daemonState: unknown): CodexUsageSnapshot | null {
    if (!daemonState || typeof daemonState !== 'object') {
        return null;
    }
    const snapshot = (daemonState as { codexUsage?: unknown }).codexUsage;
    if (!snapshot || typeof snapshot !== 'object') {
        return null;
    }
    const candidate = snapshot as Partial<CodexUsageSnapshot>;
    if (candidate.source !== 'codex-session-jsonl' || typeof candidate.scannedAt !== 'number') {
        return null;
    }
    return candidate as CodexUsageSnapshot;
}

function getLatestCodexUsageSnapshot(machines: Array<{ daemonState: unknown }>): CodexUsageSnapshot | null {
    return machines.reduce<CodexUsageSnapshot | null>((latest, machine) => {
        const snapshot = getCodexUsageSnapshot(machine.daemonState);
        if (!snapshot || (latest && latest.scannedAt >= snapshot.scannedAt)) {
            return latest;
        }
        return snapshot;
    }, null);
}

function formatRateLimitPeriod(windowMinutes: number | undefined): string {
    if (typeof windowMinutes !== 'number') return '?';
    if (windowMinutes % 1440 === 0) return `${windowMinutes / 1440}d`;
    if (windowMinutes >= 60) return `${windowMinutes / 60}h`;
    return `${windowMinutes}m`;
}

interface CodexRateLimitSummary {
    period: string;
    used: number;
    remaining: number;
    resetAt: string;
}

function getCodexRateLimitSummary(window: CodexRateLimitWindow | undefined): CodexRateLimitSummary | null {
    if (!window || typeof window.usedPercent !== 'number') {
        return null;
    }
    const used = Math.max(0, Math.min(100, window.usedPercent));
    return {
        period: formatRateLimitPeriod(window.windowMinutes),
        used,
        remaining: 100 - used,
        resetAt: typeof window.resetsAt === 'number'
            ? new Date(window.resetsAt * 1000).toLocaleString()
            : t('common.unknown'),
    };
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    periodSelector: {
        flexDirection: 'row',
        padding: 16,
        gap: 8,
    },
    periodButton: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
    },
    periodButtonActive: {
        backgroundColor: theme.colors.accent,
    },
    periodText: {
        fontSize: 14,
        color: theme.colors.text,
        fontWeight: '500',
    },
    periodTextActive: {
        color: '#FFFFFF',
    },
    statsContainer: {
        padding: 16,
        backgroundColor: theme.colors.surface,
        margin: 16,
        borderRadius: 12,
        gap: 12,
    },
    codexCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        gap: 16,
        marginHorizontal: 16,
        marginTop: 16,
        padding: 20,
    },
    codexHeader: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    codexTitle: {
        color: theme.colors.text,
        fontSize: 16,
        fontWeight: '600',
    },
    planBadge: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    planBadgeText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.8,
    },
    quotaValue: {
        color: theme.colors.text,
        fontSize: 48,
        fontWeight: '700',
        lineHeight: 54,
    },
    quotaLabel: {
        color: theme.colors.textSecondary,
        fontSize: 15,
    },
    progressTrack: {
        backgroundColor: theme.colors.divider,
        borderRadius: 999,
        height: 8,
        overflow: 'hidden',
    },
    progressFill: {
        backgroundColor: theme.colors.accent,
        borderRadius: 999,
        height: '100%',
    },
    quotaDetails: {
        color: theme.colors.textSecondary,
        fontSize: 14,
        lineHeight: 20,
    },
    quotaReset: {
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: '500',
        lineHeight: 20,
    },
    quotaScannedAt: {
        color: theme.colors.textSecondary,
        fontSize: 13,
    },
    statRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    statLabel: {
        fontSize: 16,
        color: theme.colors.text,
    },
    statValue: {
        fontSize: 20,
        fontWeight: '700',
        color: theme.colors.text,
    },
    chartSection: {
        marginTop: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: theme.colors.text,
        marginHorizontal: 16,
        marginBottom: 8,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    errorContainer: {
        padding: 32,
        alignItems: 'center',
    },
    errorText: {
        fontSize: 14,
        color: theme.colors.status.error,
        textAlign: 'center',
    },
    emptyContainer: {
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        gap: 10,
        marginHorizontal: 16,
        paddingVertical: 36,
    },
    emptyText: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    metricToggle: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 16,
        padding: 16,
    },
    metricButton: {
        paddingVertical: 6,
        paddingHorizontal: 16,
        borderRadius: 16,
        backgroundColor: theme.colors.divider,
    },
    metricButtonActive: {
        backgroundColor: theme.colors.accent,
    },
    metricText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontWeight: '500',
    },
    metricTextActive: {
        color: '#FFFFFF',
    }
}));

export const UsagePanel: React.FC<{ sessionId?: string }> = ({ sessionId }) => {
    const { theme } = useUnistyles();
    const auth = useAuth();
    const machines = useAllMachines({ includeOffline: true });
    const [period, setPeriod] = useState<TimePeriod>('7days');
    const [chartMetric, setChartMetric] = useState<'tokens' | 'cost'>('tokens');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [usageData, setUsageData] = useState<UsageDataPoint[]>([]);
    const [totals, setTotals] = useState({
        totalTokens: 0,
        totalCost: 0,
        tokensByModel: {} as Record<string, number>,
        costByModel: {} as Record<string, number>
    });
    const codexUsage = React.useMemo(() => getLatestCodexUsageSnapshot(machines), [machines]);
    const codexRateLimits = React.useMemo(() => {
        const rateLimits = codexUsage?.latestEvent?.rateLimits;
        if (!rateLimits) return [];
        return [
            getCodexRateLimitSummary(rateLimits.primary),
            getCodexRateLimitSummary(rateLimits.secondary),
        ].filter((limit): limit is CodexRateLimitSummary => !!limit);
    }, [codexUsage]);
    const primaryCodexRateLimit = codexRateLimits[0];
    const hasApiUsage = usageData.length > 0;
    
    useEffect(() => {
        let cancelled = false;

        const loadUsageData = async () => {
            const credentials = auth.credentials;
            if (!credentials) {
                setError('Not authenticated');
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const response = await getUsageForPeriod(credentials, period, sessionId);
                if (cancelled) {
                    return;
                }
                setUsageData(response.usage || []);
                setTotals(calculateTotals(response.usage || []));
            } catch (err) {
                if (cancelled) {
                    return;
                }
                console.error('Failed to load usage data:', err);
                if (err instanceof HappyError) {
                    setError(err.message);
                } else {
                    setError('Failed to load usage data');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadUsageData();
        return () => {
            cancelled = true;
        };
    }, [auth.credentials, period, sessionId]);
    
    const formatTokens = (tokens: number): string => {
        if (tokens >= 1000000) {
            return `${(tokens / 1000000).toFixed(2)}M`;
        } else if (tokens >= 1000) {
            return `${(tokens / 1000).toFixed(1)}K`;
        }
        return tokens.toLocaleString();
    };
    
    const formatCost = (cost: number): string => {
        return `$${cost.toFixed(4)}`;
    };
    
    const periodLabels: Record<TimePeriod, string> = {
        'today': t('usage.today'),
        '7days': t('usage.last7Days'),
        '30days': t('usage.last30Days')
    };
    
    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.colors.accent} />
            </View>
        );
    }
    
    if (error) {
        return (
            <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={48} color={theme.colors.status.error} />
                <Text style={styles.errorText}>{error}</Text>
            </View>
        );
    }
    
    // Get top models by usage
    const topModels = Object.entries(totals.tokensByModel)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);
    
    const maxModelTokens = Math.max(...Object.values(totals.tokensByModel), 1);
    
    return (
        <ScrollView style={styles.container}>
            <View style={styles.codexCard} accessibilityLiveRegion="polite">
                <View style={styles.codexHeader}>
                    <Text style={styles.codexTitle}>{t('machine.codexUsage')}</Text>
                    {!!codexUsage?.latestEvent?.rateLimits?.planType && (
                        <View style={styles.planBadge}>
                            <Text style={styles.planBadgeText}>
                                {codexUsage.latestEvent.rateLimits.planType.toUpperCase()}
                            </Text>
                        </View>
                    )}
                </View>
                {primaryCodexRateLimit ? (
                    <>
                        <View>
                            <Text style={styles.quotaValue}>{`${primaryCodexRateLimit.remaining}%`}</Text>
                            <Text style={styles.quotaLabel}>{t('machine.codexUsageRemaining')}</Text>
                        </View>
                        <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${primaryCodexRateLimit.used}%` }]} />
                        </View>
                        <Text style={styles.quotaDetails}>
                            {t('machine.codexUsageRateLimitWindow', primaryCodexRateLimit)}
                        </Text>
                        {codexRateLimits.slice(1).map((limit) => (
                            <Text key={limit.period} style={styles.quotaDetails}>
                                {t('machine.codexUsageRateLimitWindow', limit)}
                            </Text>
                        ))}
                        <Text style={styles.quotaReset}>
                            {t('machine.codexUsageResetsAt', { time: primaryCodexRateLimit.resetAt })}
                        </Text>
                        <Text style={styles.quotaScannedAt}>
                            {`${t('machine.codexUsageScannedAt')}: ${new Date(codexUsage!.scannedAt).toLocaleString()}`}
                        </Text>
                    </>
                ) : (
                    <Text style={styles.quotaDetails}>
                        {codexUsage ? t('machine.codexUsageNoData') : t('machine.codexUsageWaitingForDaemon')}
                    </Text>
                )}
            </View>

            {hasApiUsage && (
                <>
                    <Text style={styles.sectionTitle}>{t('usage.apiUsage')}</Text>
                    <View
                        style={styles.periodSelector}
                        accessibilityRole="tablist"
                        accessibilityLabel={t('settings.usage')}
                    >
                        {(['today', '7days', '30days'] as TimePeriod[]).map((p) => (
                            <Pressable
                                key={p}
                                style={[styles.periodButton, period === p && styles.periodButtonActive]}
                                onPress={() => setPeriod(p)}
                                accessibilityRole="tab"
                                aria-selected={period === p}
                            >
                                <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                                    {periodLabels[p]}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                    <View style={styles.statsContainer}>
                        <View style={styles.statRow}>
                            <Text style={styles.statLabel}>{t('usage.totalTokens')}</Text>
                            <Text style={styles.statValue}>{formatTokens(totals.totalTokens)}</Text>
                        </View>
                        <View style={styles.statRow}>
                            <Text style={styles.statLabel}>{t('usage.totalCost')}</Text>
                            <Text style={styles.statValue}>{formatCost(totals.totalCost)}</Text>
                        </View>
                    </View>
                </>
            )}
            
            {/* Usage Chart */}
            {hasApiUsage && (
                <View style={styles.chartSection}>
                    <Text style={styles.sectionTitle}>{t('usage.usageOverTime')}</Text>
                    
                    {/* Metric Toggle */}
                    <View
                        style={styles.metricToggle}
                        accessibilityRole="tablist"
                        accessibilityLabel={t('usage.usageOverTime')}
                    >
                        <Pressable
                            style={[styles.metricButton, chartMetric === 'tokens' && styles.metricButtonActive]}
                            onPress={() => setChartMetric('tokens')}
                            accessibilityRole="tab"
                            aria-selected={chartMetric === 'tokens'}
                        >
                            <Text style={[styles.metricText, chartMetric === 'tokens' && styles.metricTextActive]}>
                                {t('usage.tokens')}
                            </Text>
                        </Pressable>
                        <Pressable
                            style={[styles.metricButton, chartMetric === 'cost' && styles.metricButtonActive]}
                            onPress={() => setChartMetric('cost')}
                            accessibilityRole="tab"
                            aria-selected={chartMetric === 'cost'}
                        >
                            <Text style={[styles.metricText, chartMetric === 'cost' && styles.metricTextActive]}>
                                {t('usage.cost')}
                            </Text>
                        </Pressable>
                    </View>
                    
                    <UsageChart 
                        data={usageData}
                        metric={chartMetric}
                        height={180}
                    />
                </View>
            )}
            
            {/* Usage by Model */}
            {hasApiUsage && topModels.length > 0 && (
                <ItemGroup title={t('usage.byModel')}>
                    <View style={{ padding: 16 }}>
                        {topModels.map(([model, tokens]) => (
                            <UsageBar
                                key={model}
                                label={model}
                                value={tokens}
                                maxValue={maxModelTokens}
                                color={theme.colors.accent}
                            />
                        ))}
                    </View>
                </ItemGroup>
            )}
        </ScrollView>
    );
};
