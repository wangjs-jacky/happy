import * as React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { SessionsList } from './SessionsList';
import { EmptyMainScreen } from './EmptyMainScreen';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { useSessionListSyncState } from '@/sync/sessionListSyncState';
import { SessionListRecovery } from './SessionListRecovery';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    loadingContainerWrapper: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 32,
    },
    emptyStateContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        flexDirection: 'column',
        backgroundColor: theme.colors.groupped.background,
    },
    emptyStateContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
}));

export const SessionsListWrapper = React.memo(() => {
    const { theme } = useUnistyles();
    const sessionListViewData = useVisibleSessionListViewData();
    const bootstrap = useSessionListSyncState(state => state.bootstrap);
    const styles = stylesheet;

    if (sessionListViewData === null) {
        return (
            <View style={styles.container}>
                <View style={styles.loadingContainerWrapper}>
                    <View style={styles.loadingContainer}>
                        <SessionListRecovery />
                        {bootstrap !== 'error' && <ActivityIndicator size="small" color={theme.colors.textSecondary} />}
                    </View>
                </View>
            </View>
        );
    }

    if (sessionListViewData.length === 0) {
        return (
            <View style={styles.container}>
                <View style={styles.emptyStateContainer}>
                    <SessionListRecovery />
                    <View style={styles.emptyStateContentContainer}>
                        <EmptyMainScreen />
                    </View>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <SessionListRecovery />
            <SessionsList />
        </View>
    );
});
