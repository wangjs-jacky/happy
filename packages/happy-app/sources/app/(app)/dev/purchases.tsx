import * as React from 'react';
import { View, Text, TextInput, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Modal } from '@/modal';
import { t } from '@/text';

export default function PurchasesDevScreen() {
    const { theme } = useUnistyles();
    // Get purchases directly from storage
    const purchases = storage(state => state.purchases);

    // State for purchase form
    const [productId, setProductId] = React.useState('');
    const [isPurchasing, setIsPurchasing] = React.useState(false);
    const [offerings, setOfferings] = React.useState<any>(null);
    const [loadingOfferings, setLoadingOfferings] = React.useState(false);

    // Sort entitlements alphabetically
    const sortedEntitlements = React.useMemo(() => {
        return Object.entries(purchases.entitlements).sort(([a], [b]) => a.localeCompare(b));
    }, [purchases.entitlements]);

    const handlePurchase = async () => {
        if (!productId.trim()) {
            Modal.alert(t('common.error'), t('devTools.productIdRequired'));
            return;
        }

        setIsPurchasing(true);
        try {
            const result = await sync.purchaseProduct(productId.trim());
            if (result.success) {
                Modal.alert(t('common.success'), t('devTools.purchaseCompleted'));
                setProductId('');
            } else {
                Modal.alert(t('devTools.purchaseFailed'), result.error || t('common.unknown'));
            }
        } catch (e) {
            console.error('Error purchasing product', e);
        } finally {
            setIsPurchasing(false);
        }
    };

    const fetchOfferings = async () => {
        setLoadingOfferings(true);
        try {
            const result = await sync.getOfferings();
            if (result.success) {
                setOfferings(result.offerings);

                // Log full offerings data
                console.log('=== RevenueCat Offerings ===');
                console.log('Current offering:', result.offerings.current?.identifier || 'None');

                if (result.offerings.current) {
                    console.log('\nCurrent Offering Packages:');
                    Object.entries(result.offerings.current.availablePackages || {}).forEach(([key, pkg]: [string, any]) => {
                        console.log(`  - ${key}: ${pkg.product.identifier} (${pkg.product.priceString})`);
                    });
                }

                console.log('\nAll Offerings:');
                Object.entries(result.offerings.all || {}).forEach(([id, offering]: [string, any]) => {
                    console.log(`  - ${id} (${Object.keys(offering.availablePackages || {}).length} packages)`);
                });

                console.log('\nFull JSON:', JSON.stringify(result.offerings, null, 2));
                console.log('===========================');
            } else {
                Modal.alert(t('common.error'), result.error || t('devTools.failedToFetchOfferings'));
            }
        } finally {
            setLoadingOfferings(false);
        }
    };

    return (
        <>
            <Stack.Screen
                options={{
                    title: t('devTools.purchases'),
                    headerShown: true
                }}
            />

            <ItemList>
                {/* Active Subscriptions */}
                <ItemGroup
                    title={t('devTools.activeSubscriptions')}
                    footer={purchases.activeSubscriptions.length === 0 ? t('devTools.noActiveSubscriptions') : undefined}
                >
                    {purchases.activeSubscriptions.length > 0 ? (
                        purchases.activeSubscriptions.map((productId, index) => (
                            <Item
                                key={index}
                                title={productId}
                                icon={<Ionicons name="checkmark-circle" size={29} color="#34C759" />}
                                showChevron={false}
                            />
                        ))
                    ) : null}
                </ItemGroup>

                {/* Entitlements */}
                <ItemGroup
                    title={t('devTools.entitlements')}
                    footer={sortedEntitlements.length === 0 ? t('devTools.noEntitlementsFound') : t('devTools.entitlementLegend')}
                >
                    {sortedEntitlements.length > 0 ? (
                        sortedEntitlements.map(([id, isActive]) => (
                            <Item
                                key={id}
                                title={id}
                                icon={
                                    <Ionicons
                                        name={isActive ? "checkmark-circle" : "close-circle"}
                                        size={29}
                                        color={isActive ? "#34C759" : "#8E8E93"}
                                    />
                                }
                                detail={isActive ? t('devTools.active') : t('devTools.inactive')}
                                showChevron={false}
                            />
                        ))
                    ) : null}
                </ItemGroup>

                {/* Purchase Product */}
                <ItemGroup title={t('devTools.purchaseProduct')} footer={t('devTools.enterProductIdToPurchase')}>
                    <View style={{
                        backgroundColor: '#fff',
                        paddingHorizontal: 16,
                        paddingVertical: 12
                    }}>
                        <TextInput
                            value={productId}
                            onChangeText={setProductId}
                            placeholder={t('devTools.enterProductId')}
                            style={{
                                fontSize: 17,
                                paddingVertical: 8,
                                paddingHorizontal: 12,
                                backgroundColor: '#F2F2F7',
                                borderRadius: 8,
                                marginBottom: 12,
                                ...Typography.default()
                            }}
                            editable={!isPurchasing}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Item
                            title={isPurchasing ? t('devTools.purchasing') : t('devTools.purchase')}
                            icon={isPurchasing ?
                                <ActivityIndicator size="small" color={theme.colors.accent} /> :
                                <Ionicons name="card-outline" size={29} color={theme.colors.accent} />
                            }
                            onPress={handlePurchase}
                            disabled={isPurchasing}
                            showChevron={false}
                        />
                    </View>
                </ItemGroup>

                {/* Actions */}
                <ItemGroup title={t('devTools.actions')}>
                    <Item
                        title={t('devTools.refreshPurchases')}
                        icon={<Ionicons name="refresh-outline" size={29} color={theme.colors.accent} />}
                        onPress={() => sync.refreshPurchases()}
                    />
                    <Item
                        title={loadingOfferings ? t('devTools.loadingOfferings') : t('devTools.logOfferings')}
                        icon={loadingOfferings ?
                            <ActivityIndicator size="small" color={theme.colors.accent} /> :
                            <Ionicons name="document-text-outline" size={29} color={theme.colors.accent} />
                        }
                        onPress={fetchOfferings}
                        disabled={loadingOfferings}
                    />
                </ItemGroup>

                {/* Offerings Info */}
                {offerings && (
                    <ItemGroup title={t('devTools.offerings')} footer={t('devTools.checkConsoleLogs')}>
                        <Item
                            title={t('devTools.currentOffering')}
                            detail={offerings.current?.identifier || t('devTools.none')}
                            showChevron={false}
                        />
                        <Item
                            title={t('devTools.totalOfferings')}
                            detail={Object.keys(offerings.all || {}).length.toString()}
                            showChevron={false}
                        />
                        {offerings.current && (
                            <Item
                                title={t('devTools.availablePackages')}
                                detail={Object.keys(offerings.current.availablePackages || {}).length.toString()}
                                showChevron={false}
                            />
                        )}
                    </ItemGroup>
                )}

                {/* Debug Info */}
                <ItemGroup title={t('devTools.debugInfo')}>
                    <Item
                        title={t('devTools.revenueCatStatus')}
                        detail={sync.revenueCatInitialized ? t('devTools.initialized') : t('devTools.notInitialized')}
                        showChevron={false}
                    />
                    <Item
                        title={t('devTools.userId')}
                        detail={sync.serverID || t('devTools.notAvailable')}
                        showChevron={false}
                    />
                </ItemGroup>
            </ItemList>
        </>
    );
}
