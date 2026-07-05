import React, { useEffect, useMemo } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { getChangelogEntries, getLatestTitle, setLastViewedTitle } from '@/changelog';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { t } from '@/text';
import { getOtaChangelogEntry, getOtaChangelogTitle } from '@/changelog/runtime';
import { useOtaVersions } from '@/hooks/useOtaVersions';
import { loadAppConfig } from '@/sync/appConfig';

export default function ChangelogScreen() {
    const insets = useSafeAreaInsets();
    const appConfig = useMemo(() => loadAppConfig(), []);
    const changelogChannel = appConfig.otaChannel || 'preview';
    const fallbackEntries = getChangelogEntries();
    const fallbackLatestTitle = getLatestTitle();
    const { versions, loading } = useOtaVersions(changelogChannel);
    const entries = versions.length > 0 ? versions.map(getOtaChangelogEntry) : fallbackEntries;
    const latestTitle = versions[0] ? getOtaChangelogTitle(versions[0]) : fallbackLatestTitle;

    useEffect(() => {
        if (latestTitle) {
            setLastViewedTitle(latestTitle);
        }
    }, [latestTitle]);

    if (loading && entries.length === 0) {
        return (
            <View style={styles.container}>
                <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>
                        {t('common.loading')}
                    </Text>
                </View>
            </View>
        );
    }

    if (entries.length === 0) {
        return (
            <View style={styles.container}>
                <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>
                        {t('changelog.noEntriesAvailable')}
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <ScrollView
                style={styles.container}
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingBottom: insets.bottom + 40,
                        maxWidth: layout.maxWidth,
                        alignSelf: 'center',
                        width: '100%'
                    }
                ]}
                showsVerticalScrollIndicator={false}
            >
                {entries.map((entry) => (
                    <View key={entry.title} style={styles.entryContainer}>
                        <Text style={styles.titleText}>
                            {entry.title}
                        </Text>
                        {entry.summary ? (
                            <Text style={styles.summaryText}>
                                {entry.summary}
                            </Text>
                        ) : null}
                        <View style={styles.card}>
                            <MarkdownView markdown={entry.markdown} />
                        </View>
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    entryContainer: {
        marginBottom: 32,
    },
    titleText: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        lineHeight: 28,
        color: theme.colors.text,
        marginBottom: 8,
    },
    summaryText: {
        ...Typography.default('regular'),
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.textSecondary,
        marginBottom: 16,
    },
    card: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 12,
        padding: 16,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    emptyText: {
        ...Typography.default('regular'),
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    }
}));
