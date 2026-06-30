import * as React from 'react';
import { View, Text, TextInput, FlatList, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/Avatar';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { useSessionSearch, type SessionSearchResult } from '@/hooks/useSessionSearch';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { getSessionAvatarId } from '@/utils/sessionUtils';
import { t } from '@/text';

export default React.memo(function SessionSearchScreen() {
    const { theme } = useUnistyles();
    const [query, setQuery] = React.useState('');
    const results = useSessionSearch(query);
    const navigateToSession = useNavigateToSession();

    const hasQuery = query.trim().length > 0;

    const renderItem = React.useCallback(({ item }: { item: SessionSearchResult }) => (
        <SearchResultRow result={item} onPress={() => navigateToSession(item.session.id)} />
    ), [navigateToSession]);

    const keyExtractor = React.useCallback((item: SessionSearchResult) => item.session.id, []);

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <View style={styles.content}>
                <View style={styles.searchBar}>
                    <Ionicons name="search" size={18} color={theme.colors.textSecondary} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder={t('sessionSearch.placeholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={query}
                        onChangeText={setQuery}
                        autoFocus
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="search"
                    />
                    {hasQuery && (
                        <Pressable onPress={() => setQuery('')} hitSlop={10}>
                            <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    )}
                </View>

                {results.length > 0 ? (
                    <FlatList
                        data={results}
                        renderItem={renderItem}
                        keyExtractor={keyExtractor}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode="on-drag"
                        contentContainerStyle={styles.listContent}
                    />
                ) : (
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>
                            {hasQuery ? t('sessionSearch.noResults', { query: query.trim() }) : t('sessionSearch.empty')}
                        </Text>
                    </View>
                )}
            </View>
        </KeyboardAvoidingView>
    );
});

const SearchResultRow = React.memo(({ result, onPress }: { result: SessionSearchResult; onPress: () => void }) => {
    const subtitle = result.machineName
        ? (result.subtitle ? `${result.subtitle} · ${result.machineName}` : result.machineName)
        : result.subtitle;

    return (
        <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={onPress}
        >
            <Avatar
                id={getSessionAvatarId(result.session)}
                size={44}
                flavor={result.session.metadata?.flavor ?? null}
                monochrome={!result.session.active}
            />
            <View style={styles.rowContent}>
                <Text style={styles.rowTitle} numberOfLines={1}>{result.title}</Text>
                {!!subtitle && (
                    <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text>
                )}
            </View>
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        flex: 1,
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 16,
        marginTop: 12,
        marginBottom: 8,
        paddingHorizontal: 14,
        paddingVertical: Platform.OS === 'ios' ? 12 : 6,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        color: theme.colors.text,
        ...Typography.default(),
    },
    listContent: {
        paddingBottom: 32,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    rowPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    rowContent: {
        flex: 1,
        justifyContent: 'center',
    },
    rowTitle: {
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    rowSubtitle: {
        fontSize: 13,
        marginTop: 2,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        paddingBottom: 64,
    },
    emptyText: {
        fontSize: 15,
        textAlign: 'center',
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));
