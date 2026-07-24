import * as React from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useLocalSettingMutable } from '@/sync/storage';
import { isAskApiConfigured } from '@/utils/askApiConfig';

const EMPTY_ASK_API = {
    apiKey: '',
    baseUrl: '',
    tavilyApiKey: '',
};

export default function AskApiSettingsScreen() {
    const { theme } = useUnistyles();
    const [askApi, setAskApi] = useLocalSettingMutable('askApi');
    const configured = isAskApiConfigured(askApi);

    const updateApiKey = React.useCallback((apiKey: string) => {
        setAskApi({ ...askApi, apiKey });
    }, [askApi, setAskApi]);

    const updateBaseUrl = React.useCallback((baseUrl: string) => {
        setAskApi({ ...askApi, baseUrl });
    }, [askApi, setAskApi]);

    const updateTavilyApiKey = React.useCallback((tavilyApiKey: string) => {
        setAskApi({ ...askApi, tavilyApiKey });
    }, [askApi, setAskApi]);

    const clear = React.useCallback(() => {
        setAskApi(EMPTY_ASK_API);
    }, [setAskApi]);

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup
                title={t('askApiSettings.connection')}
                footer={t('askApiSettings.footer')}
            >
                <View style={styles.fieldRow}>
                    <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>
                        {t('askApiSettings.apiKey')}
                    </Text>
                    <TextInput
                        accessibilityLabel={t('askApiSettings.apiKey')}
                        value={askApi.apiKey}
                        onChangeText={updateApiKey}
                        placeholder={t('askApiSettings.apiKeyPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                        textContentType="password"
                        style={[
                            styles.textInput,
                            {
                                color: theme.colors.text,
                                borderColor: theme.colors.divider,
                                backgroundColor: theme.colors.input.background,
                            },
                        ]}
                    />
                </View>
                <View style={styles.fieldRow}>
                    <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>
                        {t('askApiSettings.baseUrl')}
                    </Text>
                    <TextInput
                        accessibilityLabel={t('askApiSettings.baseUrl')}
                        value={askApi.baseUrl}
                        onChangeText={updateBaseUrl}
                        placeholder={t('askApiSettings.baseUrlPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        textContentType="URL"
                        style={[
                            styles.textInput,
                            {
                                color: theme.colors.text,
                                borderColor: theme.colors.divider,
                                backgroundColor: theme.colors.input.background,
                            },
                        ]}
                    />
                </View>
                <View style={styles.fieldRow}>
                    <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>
                        {t('askApiSettings.tavilyApiKey')}
                    </Text>
                    <TextInput
                        accessibilityLabel={t('askApiSettings.tavilyApiKey')}
                        value={askApi.tavilyApiKey}
                        onChangeText={updateTavilyApiKey}
                        placeholder={t('askApiSettings.tavilyApiKeyPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                        textContentType="password"
                        style={[
                            styles.textInput,
                            {
                                color: theme.colors.text,
                                borderColor: theme.colors.divider,
                                backgroundColor: theme.colors.input.background,
                            },
                        ]}
                    />
                </View>
            </ItemGroup>

            <ItemGroup title={t('askApiSettings.status')}>
                <Item
                    title={configured ? t('askApiSettings.configured') : t('askApiSettings.notConfigured')}
                    subtitle={configured ? t('askApiSettings.configuredSubtitle') : t('askApiSettings.notConfiguredSubtitle')}
                    icon={<Ionicons name={configured ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={29} color={configured ? '#34C759' : '#FF9500'} />}
                    showChevron={false}
                />
                <Item
                    title={t('askApiSettings.clear')}
                    subtitle={t('askApiSettings.clearSubtitle')}
                    icon={<Ionicons name="trash-outline" size={29} color="#FF3B30" />}
                    destructive
                    disabled={!askApi.apiKey && !askApi.baseUrl && !askApi.tavilyApiKey}
                    onPress={clear}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
}

const styles = StyleSheet.create(() => ({
    fieldRow: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 8,
    },
    fieldLabel: {
        ...Typography.default('semiBold'),
        fontSize: 15,
    },
    textInput: {
        ...Typography.default(),
        minHeight: 44,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingHorizontal: 12,
        fontSize: 15,
    },
}));
