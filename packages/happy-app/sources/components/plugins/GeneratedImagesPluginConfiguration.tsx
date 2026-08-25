import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useGeneratedImagesPlugin } from '@/hooks/useGeneratedImagesPlugin';
import { useHappyAction } from '@/hooks/useHappyAction';
import {
    installGeneratedImagesPlugin,
    uninstallGeneratedImagesPlugin,
} from '@/sync/generatedImagesPlugin';
import { t } from '@/text';

type Props = {
    onInstalled?: () => void;
    onOpen?: () => void;
    onStatusChanged?: () => void | Promise<void>;
};

export const GeneratedImagesPluginConfiguration = React.memo(function GeneratedImagesPluginConfiguration({
    onInstalled,
    onOpen,
    onStatusChanged,
}: Props) {
    const { theme } = useUnistyles();
    const { loading, status, refresh } = useGeneratedImagesPlugin();

    const install = React.useCallback(async () => {
        await installGeneratedImagesPlugin();
        await refresh();
        await onStatusChanged?.();
        onInstalled?.();
    }, [onInstalled, onStatusChanged, refresh]);
    const [installing, performInstall] = useHappyAction(install);

    const uninstall = React.useCallback(async () => {
        await uninstallGeneratedImagesPlugin();
        await refresh();
        await onStatusChanged?.();
    }, [onStatusChanged, refresh]);
    const [uninstalling, performUninstall] = useHappyAction(uninstall);

    const installed = status?.installed === true;

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup
                title={t('relationshipAdvisorPlugin.status')}
                footer={t('generatedImages.pluginPrivacyNotice')}
            >
                <Item
                    title={installed
                        ? t('relationshipAdvisorPlugin.installed')
                        : t('relationshipAdvisorPlugin.notInstalled')}
                    subtitle={installed
                        ? t('generatedImages.pluginInstalledSubtitle')
                        : t('generatedImages.pluginNotInstalledSubtitle')}
                    icon={<Ionicons
                        color={theme.colors.accent}
                        name={installed ? 'checkmark-circle-outline' : 'download-outline'}
                        size={29}
                    />}
                    showChevron={false}
                />
                {installed ? (
                    <Item
                        testID="generated-images-plugin-open"
                        title={t('relationshipAdvisorPlugin.openPlugin')}
                        subtitle={t('generatedImages.entrySubtitle')}
                        icon={<Ionicons color={theme.colors.accent} name="albums-outline" size={29} />}
                        onPress={onOpen}
                        disabled={loading || installing || uninstalling}
                        showChevron={false}
                    />
                ) : (
                    <Item
                        testID="generated-images-plugin-install"
                        title={t('relationshipAdvisorPlugin.install')}
                        subtitle={t('generatedImages.pluginInstallSubtitle')}
                        icon={<Ionicons color={theme.colors.accent} name="cloud-download-outline" size={29} />}
                        onPress={performInstall}
                        disabled={loading || installing || uninstalling}
                        loading={installing}
                        showChevron={false}
                    />
                )}
                {installed ? (
                    <Item
                        testID="generated-images-plugin-uninstall"
                        title={t('relationshipAdvisorPlugin.uninstall')}
                        subtitle={t('generatedImages.pluginUninstallSubtitle')}
                        icon={<Ionicons color={theme.colors.textDestructive} name="trash-outline" size={29} />}
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
