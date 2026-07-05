import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Platform, NativeModules } from 'react-native';
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Typography } from '@/constants/Typography';
import * as Clipboard from 'expo-clipboard';
import { Modal } from '@/modal';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { config } from '@/config';
import { t } from '@/text';

interface JsonViewerProps {
    title: string;
    data: any;
    defaultExpanded?: boolean;
}

function JsonViewer({ title, data, defaultExpanded = false }: JsonViewerProps) {
    const { theme } = useUnistyles();
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    
    const handleCopy = async () => {
        try {
            await Clipboard.setStringAsync(JSON.stringify(data, null, 2));
            Modal.alert(t('common.copied'), t('devTools.jsonCopied'));
        } catch (error) {
            Modal.alert(t('common.error'), t('devTools.failedToCopyClipboard'));
        }
    };
    
    if (!data) {
        return (
            <Item
                title={title}
                detail={t('devTools.notAvailable')}
                showChevron={false}
            />
        );
    }
    
    return (
        <View style={{ marginBottom: 12 }}>
            <Pressable
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    backgroundColor: 'white',
                }}
                onPress={() => setIsExpanded(!isExpanded)}
            >
                <Ionicons
                    name={isExpanded ? 'chevron-down' : 'chevron-forward'}
                    size={20}
                    color="#8E8E93"
                    style={{ marginRight: 8 }}
                />
                <Text style={{ flex: 1, fontSize: 16, ...Typography.default('semiBold') }}>
                    {title}
                </Text>
                <Pressable
                    onPress={handleCopy}
                    hitSlop={10}
                    style={{ padding: 4 }}
                >
                    <Ionicons name="copy-outline" size={20} color={theme.colors.accent} />
                </Pressable>
            </Pressable>
            
            {isExpanded && (
                <View style={{ 
                    backgroundColor: '#F2F2F7', 
                    paddingHorizontal: 16, 
                    paddingVertical: 12,
                    marginHorizontal: 16,
                    borderRadius: 8,
                    marginTop: -4,
                }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={true}>
                        <Text style={{ 
                            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), 
                            fontSize: 12,
                            color: '#000',
                        }}>
                            {JSON.stringify(data, null, 2)}
                        </Text>
                    </ScrollView>
                </View>
            )}
        </View>
    );
}

export default function ExpoConstantsScreen() {
    // Get ExponentConstants native module directly
    const ExponentConstants = requireOptionalNativeModule('ExponentConstants');
    const ExpoUpdates = requireOptionalNativeModule('ExpoUpdates');
    
    // Get raw manifests from native modules (replicating Constants.ts logic)
    let rawExponentManifest = null;
    let parsedExponentManifest = null;
    if (ExponentConstants && ExponentConstants.manifest) {
        rawExponentManifest = ExponentConstants.manifest;
        // On Android, manifest is passed as JSON string
        if (typeof rawExponentManifest === 'string') {
            try {
                parsedExponentManifest = JSON.parse(rawExponentManifest);
            } catch (e) {
                parsedExponentManifest = { parseError: e instanceof Error ? e.message : String(e) };
            }
        } else {
            parsedExponentManifest = rawExponentManifest;
        }
    }
    
    // Get Updates manifest from native module
    let rawUpdatesManifest = null;
    let parsedUpdatesManifest = null;
    if (ExpoUpdates) {
        if (ExpoUpdates.manifest) {
            rawUpdatesManifest = ExpoUpdates.manifest;
            parsedUpdatesManifest = rawUpdatesManifest;
        } else if (ExpoUpdates.manifestString) {
            rawUpdatesManifest = ExpoUpdates.manifestString;
            try {
                parsedUpdatesManifest = JSON.parse(ExpoUpdates.manifestString);
            } catch (e) {
                parsedUpdatesManifest = { parseError: e instanceof Error ? e.message : String(e) };
            }
        }
    }
    
    // Get DevLauncher manifest if available
    let rawDevLauncherManifest = null;
    let parsedDevLauncherManifest = null;
    if (NativeModules.EXDevLauncher && NativeModules.EXDevLauncher.manifestString) {
        rawDevLauncherManifest = NativeModules.EXDevLauncher.manifestString;
        try {
            parsedDevLauncherManifest = JSON.parse(rawDevLauncherManifest);
        } catch (e) {
            parsedDevLauncherManifest = { parseError: e instanceof Error ? e.message : String(e) };
        }
    }
    
    // Get various manifest types from Constants API
    const expoConfig = Constants.expoConfig;
    const manifest = Constants.manifest;
    const manifest2 = Constants.manifest2;
    
    // Get Updates manifest if available
    let updatesManifest = null;
    try {
        // @ts-ignore - manifest might not be typed
        updatesManifest = Updates.manifest;
    } catch (e) {
        // expo-updates might not be available
    }
    
    // Get update ID and channel
    let updateId = null;
    let releaseChannel = null;
    let channel = null;
    let isEmbeddedLaunch = null;
    try {
        // @ts-ignore
        updateId = Updates.updateId;
        // @ts-ignore
        releaseChannel = Updates.releaseChannel;
        // @ts-ignore
        channel = Updates.channel;
        // @ts-ignore
        isEmbeddedLaunch = Updates.isEmbeddedLaunch;
    } catch (e) {
        // Properties might not be available
    }
    
    // Check if running embedded update
    const isEmbedded = ExpoUpdates?.isEmbeddedLaunch;
    
    return (
        <>
            <Stack.Screen
                options={{
                    title: t('devTools.expoConstants'),
                    headerLargeTitle: false,
                }}
            />
            <ItemList>
                {/* Main Configuration */}
                <ItemGroup title={t('devTools.constantsConfiguration')}>
                    <JsonViewer
                        title={t('devTools.currentExpoConfig')}
                        data={expoConfig}
                        defaultExpanded={true}
                    />
                    <JsonViewer
                        title={t('devTools.legacyManifest')}
                        data={manifest}
                    />
                    <JsonViewer
                        title="manifest2"
                        data={manifest2}
                    />
                    {updatesManifest && (
                        <JsonViewer
                            title={t('devTools.updatesManifest')}
                            data={updatesManifest}
                        />
                    )}
                </ItemGroup>
                
                {/* Raw Native Module Manifests */}
                <ItemGroup title={t('devTools.rawNativeModuleManifests')}>
                    <Item
                        title={t('devTools.embeddedLaunch')}
                        detail={isEmbedded !== undefined ? (isEmbedded ? t('common.yes') : t('common.no')) : t('devTools.notAvailable')}
                        showChevron={false}
                    />
                    {parsedExponentManifest && (
                        <JsonViewer
                            title={t('devTools.exponentEmbeddedManifest')}
                            data={parsedExponentManifest}
                        />
                    )}
                    {parsedUpdatesManifest && (
                        <JsonViewer
                            title={t('devTools.expoUpdatesOtaManifest')}
                            data={parsedUpdatesManifest}
                        />
                    )}
                    {parsedDevLauncherManifest && (
                        <JsonViewer
                            title="DevLauncher.manifest"
                            data={parsedDevLauncherManifest}
                        />
                    )}
                </ItemGroup>
                
                {/* Raw String Manifests (for debugging) */}
                <ItemGroup title={t('devTools.rawManifestStrings')}>
                    {typeof rawExponentManifest === 'string' && (
                        <JsonViewer
                            title={t('devTools.exponentRawManifest')}
                            data={{ raw: rawExponentManifest }}
                        />
                    )}
                    {typeof rawUpdatesManifest === 'string' && (
                        <JsonViewer
                            title={t('devTools.expoUpdatesRawManifest')}
                            data={{ raw: rawUpdatesManifest }}
                        />
                    )}
                    {rawDevLauncherManifest && (
                        <JsonViewer
                            title={t('devTools.devLauncherRawManifest')}
                            data={{ raw: rawDevLauncherManifest }}
                        />
                    )}
                </ItemGroup>
                
                {/* Resolved App Config */}
                <ItemGroup title={t('devTools.resolvedAppConfig')}>
                    <JsonViewer
                        title={t('devTools.loadedAppConfig')}
                        data={config}
                        defaultExpanded={true}
                    />
                </ItemGroup>
                
                {/* System Constants */}
                <ItemGroup title={t('devTools.systemConstants')}>
                    <Item
                        title={t('devTools.deviceId')}
                        detail={Constants.deviceId || t('devTools.notAvailable')}
                        showChevron={false}
                    />
                    <Item
                        title={t('devTools.sessionId')}
                        detail={Constants.sessionId}
                        showChevron={false}
                    />
                    <Item
                        title={t('devTools.installationId')}
                        detail={Constants.installationId}
                        showChevron={false}
                    />
                    <Item
                        title={t('devTools.isDevice')}
                        detail={Constants.isDevice ? t('common.yes') : t('common.no')}
                        showChevron={false}
                    />
                    <Item
                        title={t('devTools.debugMode')}
                        detail={Constants.debugMode ? t('common.yes') : t('common.no')}
                        showChevron={false}
                    />
                    <Item
                        title={t('devTools.appOwnership')}
                        detail={Constants.appOwnership || t('devTools.notAvailable')}
                        showChevron={false}
                    />
                    <Item
                        title={t('devTools.executionEnvironment')}
                        detail={Constants.executionEnvironment || t('devTools.notAvailable')}
                        showChevron={false}
                    />
                </ItemGroup>
                
                {/* Updates Information */}
                <ItemGroup title={t('devTools.updatesInformation')}>
                    <Item
                        title={t('devTools.updateId')}
                        detail={updateId || t('devTools.notAvailable')}
                        showChevron={false}
                    />
                    <Item
                        title={t('devTools.releaseChannel')}
                        detail={releaseChannel || t('devTools.notAvailable')}
                        showChevron={false}
                    />
                    <Item
                        title={t('devTools.channel')}
                        detail={channel || t('devTools.notAvailable')}
                        showChevron={false}
                    />
                    <Item
                        title={t('devTools.embeddedLaunch')}
                        detail={isEmbeddedLaunch !== undefined ? (isEmbeddedLaunch ? t('common.yes') : t('common.no')) : t('devTools.notAvailable')}
                        showChevron={false}
                    />
                </ItemGroup>
                
                {/* Platform Info */}
                <ItemGroup title={t('devTools.platformConstants')}>
                    <JsonViewer
                        title={t('devTools.platformConstants')}
                        data={Constants.platform}
                    />
                </ItemGroup>
                
                {/* System Fonts */}
                <ItemGroup title={t('devTools.systemFonts')}>
                    <JsonViewer
                        title={t('devTools.availableFonts')}
                        data={Constants.systemFonts}
                    />
                </ItemGroup>
                
                {/* Native Modules Info */}
                <ItemGroup title={t('devTools.nativeModules')}>
                    <Item
                        title="ExponentConstants"
                        detail={ExponentConstants ? t('devTools.available') : t('devTools.notAvailable')}
                        showChevron={false}
                    />
                    <Item
                        title="ExpoUpdates"
                        detail={ExpoUpdates ? t('devTools.available') : t('devTools.notAvailable')}
                        showChevron={false}
                    />
                    <Item
                        title="EXDevLauncher"
                        detail={NativeModules.EXDevLauncher ? t('devTools.available') : t('devTools.notAvailable')}
                        showChevron={false}
                    />
                    {ExponentConstants && (
                        <JsonViewer
                            title="ExponentConstants (full module)"
                            data={ExponentConstants}
                        />
                    )}
                    {ExpoUpdates && (
                        <JsonViewer
                            title="ExpoUpdates (full module)"
                            data={ExpoUpdates}
                        />
                    )}
                </ItemGroup>
                
                {/* Raw Constants Object */}
                <ItemGroup title={t('devTools.allConstantsDebug')}>
                    <JsonViewer
                        title={t('devTools.fullConstantsObject')}
                        data={Constants}
                    />
                </ItemGroup>
            </ItemList>
        </>
    );
}
