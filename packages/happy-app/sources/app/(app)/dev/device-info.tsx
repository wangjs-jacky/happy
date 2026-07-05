import React from 'react';
import { View, Text, ScrollView, Dimensions, Platform, PixelRatio } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Typography } from '@/constants/Typography';
import { ItemGroup } from '@/components/ItemGroup';
import { Item } from '@/components/Item';
import { ItemList } from '@/components/ItemList';
import Constants from 'expo-constants';
import { useIsTablet, getDeviceType, calculateDeviceDimensions, useHeaderHeight } from '@/utils/responsive';
import { layout } from '@/components/layout';
import { isRunningOnMac } from '@/utils/platform';
import { t } from '@/text';

export default function DeviceInfo() {
    const insets = useSafeAreaInsets();
    const { width, height } = Dimensions.get('window');
    const screenDimensions = Dimensions.get('screen');
    const pixelDensity = PixelRatio.get();
    const isTablet = useIsTablet();
    const deviceType = getDeviceType();
    const headerHeight = useHeaderHeight();
    const isRunningOnMacCatalyst = isRunningOnMac();
    
    // Calculate device dimensions using the correct function
    const dimensions = calculateDeviceDimensions({
        widthPoints: screenDimensions.width,
        heightPoints: screenDimensions.height,
        pointsPerInch: Platform.OS === 'ios' ? 163 : 160
    });
    
    const { widthInches, heightInches, diagonalInches } = dimensions;
    
    return (
        <>
            <Stack.Screen
                options={{
                    title: t('devTools.deviceInfo'),
                    headerLargeTitle: false,
                }}
            />
            <ItemList>
                <ItemGroup title={t('devTools.safeAreaInsets')}>
                    <Item
                        title={t('devTools.top')}
                        detail={`${insets.top}px`}
                    />
                    <Item
                        title={t('devTools.bottom')}
                        detail={`${insets.bottom}px`}
                    />
                    <Item
                        title={t('devTools.left')}
                        detail={`${insets.left}px`}
                    />
                    <Item
                        title={t('devTools.right')}
                        detail={`${insets.right}px`}
                    />
                </ItemGroup>

                <ItemGroup title={t('devTools.deviceDetection')}>
                    <Item
                        title={t('devTools.deviceType')}
                        detail={deviceType === 'tablet' ? t('devTools.tablet') : t('devTools.phone')}
                    />
                    <Item
                        title={t('devTools.detectionMethod')}
                        // @ts-ignore - isPad is not in the type definitions but exists at runtime on iOS
                        detail={Platform.OS === 'ios' && Platform.isPad ? 'iOS isPad' : t('devTools.diagonalValue', { value: diagonalInches.toFixed(1) })}
                    />
                    <Item
                        title={t('devTools.macCatalyst')}
                        detail={isRunningOnMacCatalyst ? t('common.yes') : t('common.no')}
                    />
                    <Item
                        title={t('devTools.headerHeight')}
                        detail={t('devTools.pointsValue', { value: headerHeight })}
                    />
                    <Item
                        title={t('devTools.diagonalSize')}
                        detail={t('devTools.inchesValue', { value: diagonalInches.toFixed(2) })}
                    />
                    <Item
                        title={t('devTools.widthInches')}
                        detail={`${widthInches.toFixed(2)}"`}
                    />
                    <Item
                        title={t('devTools.heightInches')}
                        detail={`${heightInches.toFixed(2)}"`}
                    />
                    <Item
                        title={t('devTools.pixelDensity')}
                        detail={`${pixelDensity}x`}
                    />
                    <Item
                        title={t('devTools.pointsPerInch')}
                        detail={Platform.OS === 'ios' ? '163' : '160'}
                    />
                    <Item
                        title={t('devTools.layoutMaxWidth')}
                        detail={`${layout.maxWidth}px`}
                    />
                </ItemGroup>

                <ItemGroup title={t('devTools.screenDimensions')}>
                    <Item
                        title={t('devTools.windowWidth')}
                        detail={t('devTools.pointsValue', { value: width })}
                    />
                    <Item
                        title={t('devTools.windowHeight')}
                        detail={t('devTools.pointsValue', { value: height })}
                    />
                    <Item
                        title={t('devTools.screenWidth')}
                        detail={t('devTools.pointsValue', { value: screenDimensions.width })}
                    />
                    <Item
                        title={t('devTools.screenHeight')}
                        detail={t('devTools.pointsValue', { value: screenDimensions.height })}
                    />
                    <Item
                        title={t('devTools.physicalPixelsWidth')}
                        detail={`${Math.round(screenDimensions.width * pixelDensity)}px`}
                    />
                    <Item
                        title={t('devTools.physicalPixelsHeight')}
                        detail={`${Math.round(screenDimensions.height * pixelDensity)}px`}
                    />
                    <Item
                        title={t('devTools.aspectRatio')}
                        detail={`${(height / width).toFixed(3)}`}
                    />
                </ItemGroup>

                <ItemGroup title={t('devTools.platformInfo')}>
                    <Item
                        title={t('machine.platform')}
                        detail={Platform.OS}
                    />
                    <Item
                        title={t('common.version')}
                        detail={Platform.Version?.toString() || t('devTools.notAvailable')}
                    />
                    {Platform.OS === 'ios' && (
                        <>
                            <Item
                                title={t('devTools.iosInterface')}
                                // @ts-ignore - isPad is not in the type definitions but exists at runtime on iOS
                                detail={Platform.isPad ? 'iPad' : 'iPhone'}
                            />
                            <Item
                                title={t('devTools.iosVersion')}
                                detail={Platform.Version?.toString() || t('devTools.notAvailable')}
                            />
                        </>
                    )}
                    {Platform.OS === 'android' && (
                        <Item
                            title={t('devTools.apiLevel')}
                            detail={Platform.Version?.toString() || t('devTools.notAvailable')}
                        />
                    )}
                </ItemGroup>

                <ItemGroup title={t('devTools.appInfo')}>
                    <Item
                        title={t('devTools.appVersion')}
                        detail={Constants.expoConfig?.version || t('devTools.notAvailable')}
                    />
                    <Item
                        title={t('devTools.sdkVersion')}
                        detail={Constants.expoConfig?.sdkVersion || t('devTools.notAvailable')}
                    />
                    <Item
                        title={t('devTools.buildNumber')}
                        detail={Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode?.toString() || t('devTools.notAvailable')}
                    />
                </ItemGroup>
            </ItemList>
        </>
    );
}
