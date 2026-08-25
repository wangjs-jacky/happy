import * as React from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Typography } from '@/constants/Typography';
import { useHappyAction } from '@/hooks/useHappyAction';
import { useRelationshipAdvisorPlugin } from '@/hooks/useRelationshipAdvisorPlugin';
import {
    installRelationshipAdvisorPlugin,
    uninstallRelationshipAdvisorPlugin,
} from '@/sync/relationshipAdvisorPlugin';
import { t } from '@/text';

type Props = {
    onInstalled?: () => void;
    onStatusChanged?: () => void | Promise<void>;
};

export const RelationshipAdvisorPluginConfiguration = React.memo(function RelationshipAdvisorPluginConfiguration({
    onInstalled,
    onStatusChanged,
}: Props) {
    const { theme } = useUnistyles();
    const { loading, status, refresh } = useRelationshipAdvisorPlugin();
    const [apiKey, setApiKey] = React.useState('');
    const [baseUrl, setBaseUrl] = React.useState('');
    const [model, setModel] = React.useState('');

    React.useEffect(() => {
        if (status?.installed !== true) return;
        setBaseUrl(status.baseUrl);
        setModel(status.model);
    }, [status]);

    const install = React.useCallback(async () => {
        await installRelationshipAdvisorPlugin({
            apiKey: apiKey.trim(),
            baseUrl: baseUrl.trim(),
            model: model.trim(),
        });
        await refresh();
        await onStatusChanged?.();
        onInstalled?.();
    }, [apiKey, baseUrl, model, onInstalled, onStatusChanged, refresh]);
    const [installing, performInstall] = useHappyAction(install);

    const uninstall = React.useCallback(async () => {
        await uninstallRelationshipAdvisorPlugin();
        setApiKey('');
        setBaseUrl('');
        setModel('');
        await refresh();
        await onStatusChanged?.();
    }, [onStatusChanged, refresh]);
    const [uninstalling, performUninstall] = useHappyAction(uninstall);

    const canInstall = apiKey.trim().length > 0
        && baseUrl.trim().length > 0
        && model.trim().length > 0
        && !installing
        && !uninstalling;
    const apiKeyPlaceholder = status?.installed === true
        ? t('relationshipAdvisorPlugin.apiKeyConfigured', { hint: status.keyHint })
        : t('relationshipAdvisorPlugin.apiKeyPlaceholder');

    return (
        <ItemList style={styles.list}>
            <ItemGroup
                title={t('relationshipAdvisorPlugin.configuration')}
                footer={t('relationshipAdvisorPlugin.encryptionNotice')}
            >
                <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{t('relationshipAdvisorPlugin.apiKey')}</Text>
                    <TextInput
                        testID="relationship-advisor-plugin-api-key"
                        accessibilityLabel={t('relationshipAdvisorPlugin.apiKey')}
                        value={apiKey}
                        onChangeText={setApiKey}
                        placeholder={apiKeyPlaceholder}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                        textContentType="password"
                        style={styles.textInput}
                    />
                </View>
                <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{t('relationshipAdvisorPlugin.baseUrl')}</Text>
                    <TextInput
                        testID="relationship-advisor-plugin-base-url"
                        accessibilityLabel={t('relationshipAdvisorPlugin.baseUrl')}
                        value={baseUrl}
                        onChangeText={setBaseUrl}
                        placeholder={t('relationshipAdvisorPlugin.baseUrlPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        textContentType="URL"
                        style={styles.textInput}
                    />
                </View>
                <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{t('relationshipAdvisorPlugin.model')}</Text>
                    <TextInput
                        testID="relationship-advisor-plugin-model"
                        accessibilityLabel={t('relationshipAdvisorPlugin.model')}
                        value={model}
                        onChangeText={setModel}
                        placeholder={t('relationshipAdvisorPlugin.modelPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={styles.textInput}
                    />
                </View>
            </ItemGroup>

            <ItemGroup title={t('relationshipAdvisorPlugin.status')}>
                <Item
                    title={status?.installed === true
                        ? t('relationshipAdvisorPlugin.installed')
                        : t('relationshipAdvisorPlugin.notInstalled')}
                    subtitle={status?.installed === true
                        ? t('relationshipAdvisorPlugin.installedSubtitle')
                        : t('relationshipAdvisorPlugin.notInstalledSubtitle')}
                    icon={<Ionicons
                        name={status?.installed === true ? 'checkmark-circle-outline' : 'download-outline'}
                        size={29}
                        color={theme.colors.accent}
                    />}
                    showChevron={false}
                />
                <Item
                    testID="relationship-advisor-plugin-install"
                    title={status?.installed === true
                        ? t('relationshipAdvisorPlugin.update')
                        : t('relationshipAdvisorPlugin.install')}
                    subtitle={t('relationshipAdvisorPlugin.installSubtitle')}
                    icon={<Ionicons name="cloud-upload-outline" size={29} color={theme.colors.accent} />}
                    onPress={performInstall}
                    disabled={!canInstall || loading}
                    loading={installing}
                    showChevron={false}
                />
                {status?.installed === true ? (
                    <Item
                        testID="relationship-advisor-plugin-uninstall"
                        title={t('relationshipAdvisorPlugin.uninstall')}
                        subtitle={t('relationshipAdvisorPlugin.uninstallSubtitle')}
                        icon={<Ionicons name="trash-outline" size={29} color={theme.colors.textDestructive} />}
                        onPress={performUninstall}
                        disabled={installing || uninstalling}
                        loading={uninstalling}
                        destructive
                        showChevron={false}
                    />
                ) : null}
            </ItemGroup>
        </ItemList>
    );
});

const styles = StyleSheet.create((theme) => ({
    list: {
        paddingTop: 0,
    },
    fieldRow: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 8,
    },
    fieldLabel: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 15,
    },
    textInput: {
        ...Typography.default(),
        minHeight: 44,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingHorizontal: 12,
        fontSize: 15,
        color: theme.colors.text,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
    },
}));
