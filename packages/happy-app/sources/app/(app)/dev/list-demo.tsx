import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Switch } from '@/components/Switch';
import { t } from '@/text';

export default function ListDemoScreen() {
    const { theme } = useUnistyles();
    const [isEnabled, setIsEnabled] = React.useState(false);
    const [selectedItem, setSelectedItem] = React.useState<string | null>(null);

    return (
        <ItemList>
            {/* Basic Items */}
            <ItemGroup title={t('devTools.basicItems')}>
                <Item title={t('devTools.simpleItem')} />
                <Item 
                    title={t('devTools.itemWithSubtitle')}
                    subtitle={t('devTools.longSubtitle')}
                />
                <Item 
                    title={t('devTools.itemWithDetail')}
                    detail={t('devTools.detail')}
                />
                <Item 
                    title={t('devTools.clickableItem')}
                    onPress={() => console.log('Item pressed')}
                />
            </ItemGroup>

            {/* Items with Icons */}
            <ItemGroup title={t('devTools.withIcons')}>
                <Item 
                    title={t('settings.title')}
                    icon={<Ionicons name="settings-outline" size={28} color={theme.colors.accent} />}
                    onPress={() => {}}
                />
                <Item 
                    title={t('devTools.notifications')}
                    icon={<Ionicons name="notifications-outline" size={28} color="#FF9500" />}
                    detail="5"
                    onPress={() => {}}
                />
                <Item 
                    title={t('devTools.privacy')}
                    icon={<Ionicons name="lock-closed-outline" size={28} color="#34C759" />}
                    subtitle={t('devTools.privacySubtitle')}
                    onPress={() => {}}
                />
            </ItemGroup>

            {/* Interactive Items */}
            <ItemGroup title={t('devTools.interactive')} footer={t('devTools.interactiveFooter')}>
                <Item 
                    title={t('devTools.toggleSwitch')}
                    rightElement={
                        <Switch
                            value={isEnabled}
                            onValueChange={setIsEnabled}
                        />
                    }
                    showChevron={false}
                />
                <Item 
                    title={t('devTools.selectedItem')}
                    selected={selectedItem === 'item1'}
                    onPress={() => setSelectedItem('item1')}
                />
                <Item 
                    title={t('devTools.loadingState')}
                    loading={true}
                    onPress={() => {}}
                />
                <Item 
                    title={t('devTools.disabledItem')}
                    disabled={true}
                    onPress={() => {}}
                />
                <Item 
                    title={t('devTools.destructiveAction')}
                    destructive={true}
                    onPress={() => {}}
                />
            </ItemGroup>

            {/* Custom Styling */}
            <ItemGroup title={t('devTools.customStyling')}>
                <Item 
                    title={t('devTools.customColors')}
                    subtitle={t('devTools.customColorsSubtitle')}
                    titleStyle={{ color: '#FF3B30' }}
                    subtitleStyle={{ color: '#FF9500' }}
                    onPress={() => {}}
                />
                <Item 
                    title={t('devTools.noDivider')}
                    showDivider={false}
                />
                <Item 
                    title={t('devTools.customInset')}
                    dividerInset={60}
                />
                <Item 
                    title={t('devTools.noChevron')}
                    showChevron={false}
                    onPress={() => {}}
                />
            </ItemGroup>

            {/* Long Press */}
            <ItemGroup title={t('devTools.gestures')}>
                <Item 
                    title={t('devTools.longPressMe')}
                    subtitle={t('devTools.longPressSubtitle')}
                    onLongPress={() => console.log('Long pressed!')}
                />
                <Item 
                    title={t('devTools.pressAndLongPress')}
                    onPress={() => console.log('Pressed')}
                    onLongPress={() => console.log('Long pressed')}
                />
            </ItemGroup>
        </ItemList>
    );
}
