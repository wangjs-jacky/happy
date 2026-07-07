import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { openExternalUrl } from '@/utils/openExternalUrl';
import { getServerUrl } from '@/sync/serverConfig';
import { t } from '@/text';

function getImageGatewayUrl(path = '/image'): string {
    return new URL(path, getServerUrl()).toString();
}

export default function PublicImageGatewaySettings() {
    const { theme } = useUnistyles();
    const publicUrl = React.useMemo(() => getImageGatewayUrl('/image'), []);
    const adminUrl = React.useMemo(() => getImageGatewayUrl('/image/admin'), []);

    return (
        <ItemList style={{ paddingTop: 16 }}>
            <ItemGroup title={t('settings.publicImageGateway')}>
                <Item
                    title={t('settings.publicImageGatewayOpen')}
                    subtitle={publicUrl}
                    subtitleLines={2}
                    icon={<Ionicons name="image-outline" size={29} color={theme.colors.accent} />}
                    onPress={() => openExternalUrl(publicUrl)}
                    copy={publicUrl}
                />
                <Item
                    title={t('settings.publicImageGatewayAdmin')}
                    subtitle={adminUrl}
                    subtitleLines={2}
                    icon={<Ionicons name="shield-half-outline" size={29} color={theme.colors.status.connecting} />}
                    onPress={() => openExternalUrl(adminUrl)}
                    copy={adminUrl}
                />
                <Item
                    title={t('settings.publicImageGatewayWorkerTitle')}
                    subtitle={t('settings.publicImageGatewayWorker')}
                    subtitleLines={3}
                    icon={<Ionicons name="desktop-outline" size={29} color={theme.colors.status.connected} />}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
}
