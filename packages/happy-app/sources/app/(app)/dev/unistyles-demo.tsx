import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, Dimensions } from 'react-native';
import { StyleSheet, UnistylesRuntime, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/text';

const { width: screenWidth } = Dimensions.get('window');

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 32,
    },
    section: {
        marginBottom: 24,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 3.84,
        elevation: 5,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 12,
        color: '#333',
    },
    themeCard: {
        padding: 16,
        borderRadius: 8,
        marginBottom: 12,
        backgroundColor: theme.colors.surface,
        borderWidth: 2,
        borderColor: theme.colors.surface,
    },
    themeText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    breakpointBox: {
        padding: 12,
        margin: 4,
        borderRadius: 8,
        backgroundColor: {
            xs: '#FF6B6B',
            sm: '#4ECDC4',
            md: '#45B7D1',
            lg: '#96CEB4',
            xl: '#FECA57',
        },
        minHeight: 60,
        justifyContent: 'center',
        alignItems: 'center',
    },
    breakpointText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: {
            xs: 12,
            sm: 14,
            md: 16,
            lg: 18,
            xl: 20,
        },
    },
    responsiveContainer: {
        flexDirection: {
            xs: 'column',
            md: 'row',
        },
    },
    responsiveBox: {
        flex: 1,
        backgroundColor: theme.colors.surface,  // TODO: change to primary
        padding: 16,
        borderRadius: 8,
        minHeight: 80,
        justifyContent: 'center',
        alignItems: 'center',
    },
    orientationBox: {
        backgroundColor: {
            portrait: '#E74C3C',
            landscape: '#2ECC71',
        },
        padding: 20,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 80,
    },
    orientationText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    runtimeBox: {
        backgroundColor: '#9B59B6',
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
    },
    runtimeText: {
        color: 'white',
        fontSize: 14,
        fontFamily: 'monospace',
    },
    themeButton: {
        backgroundColor: theme.colors.surface,  // TODO: change to primary
        padding: 12,
        borderRadius: 8,
        marginHorizontal: 4,
        minWidth: 80,
        alignItems: 'center',
    },
    themeButtonText: {
        color: 'white',
        fontWeight: '600',
    },
    switchContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    adaptiveBox: {
        backgroundColor: theme.colors.surface,  // TODO: change to primary
        padding: {
            xs: 8,
            sm: 12,
            md: 16,
            lg: 20,
            xl: 24,
        },
        borderRadius: {
            xs: 4,
            sm: 6,
            md: 8,
            lg: 10,
            xl: 12,
        },
        marginBottom: 8,
    },
    adaptiveText: {
        color: 'white',
        fontSize: {
            xs: 12,
            sm: 14,
            md: 16,
            lg: 18,
            xl: 20,
        },
        textAlign: 'center',
    },
}));

export default function UnistylesDemo() {
    const { theme, rt } = useUnistyles();
    const styles = stylesheet;
    const [showRuntimeInfo, setShowRuntimeInfo] = useState(true);
    const runtimeThemeName = rt.themeName ?? t('common.unknown');
    const runtimeBreakpoint = rt.breakpoint ?? t('common.unknown');

    const switchTheme = (mode: 'light' | 'dark') => {
        // 主题名已改为「主题包 + 明暗」结构，dev 演示用默认焦糖包
        UnistylesRuntime.setTheme(mode === 'dark' ? 'caramelDark' : 'caramelLight');
    };

    const toggleColorScheme = () => {
        // Note: ColorScheme is typically system-controlled in React Native
        console.log('Color scheme toggle requested - this would typically be system controlled');
    };

    return (
        <View style={styles.container}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
                {/* Theme Demo */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('devTools.themeSystem')}</Text>
                    <View style={styles.themeCard}>
                        <Text style={styles.themeText}>
                            {t('devTools.currentTheme', { theme: runtimeThemeName })}
                        </Text>
                        <Text style={[styles.themeText, { fontSize: 14, opacity: 0.8 }]}>
                            {t('devTools.primaryColor', { color: theme.colors.surface })}
                        </Text>
                    </View>

                    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                        <Pressable
                            style={styles.themeButton}
                            onPress={() => switchTheme('light')}
                        >
                            <Text style={styles.themeButtonText}>{t('devTools.light')}</Text>
                        </Pressable>
                        <Pressable
                            style={styles.themeButton}
                            onPress={() => switchTheme('dark')}
                        >
                            <Text style={styles.themeButtonText}>{t('devTools.dark')}</Text>
                        </Pressable>
                    </View>
                </View>

                {/* Breakpoints Demo */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('devTools.responsiveBreakpoints')}</Text>
                    <Text style={{ marginBottom: 12, color: '#666' }}>
                        {t('devTools.currentBreakpoint', { breakpoint: runtimeBreakpoint, width: screenWidth })}
                    </Text>

                    <View style={styles.breakpointBox}>
                        <Text style={styles.breakpointText}>
                            {t('devTools.activeBreakpoint', { breakpoint: runtimeBreakpoint })}
                        </Text>
                        <Text style={[styles.breakpointText, { fontSize: 12, opacity: 0.8 }]}>
                            {t('devTools.screenWidthValue', { width: rt.screen.width })}
                        </Text>
                    </View>

                    <View style={styles.responsiveContainer}>
                        <View style={styles.responsiveBox}>
                            <Text style={{ color: 'white', fontWeight: 'bold' }}>{t('devTools.boxLabel', { number: 1 })}</Text>
                        </View>
                        <View style={styles.responsiveBox}>
                            <Text style={{ color: 'white', fontWeight: 'bold' }}>{t('devTools.boxLabel', { number: 2 })}</Text>
                        </View>
                    </View>
                </View>

                {/* Orientation Demo */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('devTools.orientationStyles')}</Text>
                    <View style={styles.orientationBox}>
                        <Ionicons
                            name={rt.isPortrait ? 'phone-portrait' : 'phone-landscape'}
                            size={24}
                            color="white"
                        />
                        <Text style={styles.orientationText}>
                            {rt.isPortrait ? t('devTools.portrait') : t('devTools.landscape')}
                        </Text>
                    </View>
                </View>

                {/* Adaptive Components */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('devTools.adaptiveComponents')}</Text>
                    <Text style={{ marginBottom: 12, color: '#666' }}>
                        {t('devTools.adaptiveComponentsDescription')}
                    </Text>

                    {[t('devTools.tiny'), t('devTools.small'), t('devTools.medium'), t('devTools.large'), t('devTools.extraLarge')].map((size, index) => (
                        <View key={size} style={styles.adaptiveBox}>
                            <Text style={styles.adaptiveText}>
                                {t('devTools.adaptiveSize', { size, breakpoint: runtimeBreakpoint })}
                            </Text>
                        </View>
                    ))}
                </View>

                {/* Runtime Information */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('devTools.runtimeInformation')}</Text>

                    <View style={styles.switchContainer}>
                        <Text style={{ fontSize: 16, color: '#333' }}>{t('devTools.showRuntimeDetails')}</Text>
                        <Switch
                            value={showRuntimeInfo}
                            onValueChange={setShowRuntimeInfo}
                        />
                    </View>

                    {showRuntimeInfo && (
                        <>
                            <View style={styles.runtimeBox}>
                                <Text style={styles.runtimeText}>
                                    {t('devTools.themeValue', { theme: runtimeThemeName })}
                                </Text>
                            </View>
                            <View style={styles.runtimeBox}>
                                <Text style={styles.runtimeText}>
                                    {t('devTools.breakpointValue', { breakpoint: runtimeBreakpoint })}
                                </Text>
                            </View>
                            <View style={styles.runtimeBox}>
                                <Text style={styles.runtimeText}>
                                    {t('devTools.screenValue', { width: rt.screen.width, height: rt.screen.height })}
                                </Text>
                            </View>
                            <View style={styles.runtimeBox}>
                                <Text style={styles.runtimeText}>
                                    {t('devTools.orientationValue', { orientation: rt.isPortrait ? t('devTools.portrait') : t('devTools.landscape') })}
                                </Text>
                            </View>
                            <View style={styles.runtimeBox}>
                                <Text style={styles.runtimeText}>
                                    {t('devTools.colorSchemeValue', { scheme: rt.colorScheme })}
                                </Text>
                            </View>
                            <View style={styles.runtimeBox}>
                                <Text style={styles.runtimeText}>
                                    {t('devTools.contentSizeValue', { size: rt.contentSizeCategory })}
                                </Text>
                            </View>
                            <View style={styles.runtimeBox}>
                                <Text style={styles.runtimeText}>
                                    {t('devTools.hasDynamicIslandValue', { value: rt.insets.top > 50 ? t('common.yes') : t('common.no') })}
                                </Text>
                            </View>
                            <View style={styles.runtimeBox}>
                                <Text style={styles.runtimeText}>
                                    {t('devTools.safeInsetsValue', { top: rt.insets.top, bottom: rt.insets.bottom, left: rt.insets.left, right: rt.insets.right })}
                                </Text>
                            </View>
                        </>
                    )}

                    <Pressable
                        style={[styles.themeButton, { marginTop: 12 }]}
                        onPress={toggleColorScheme}
                    >
                        <Text style={styles.themeButtonText}>
                            {t('devTools.toggleColorScheme', { scheme: rt.colorScheme })}
                        </Text>
                    </Pressable>
                </View>

                {/* Color Scheme Demo */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('devTools.colorScheme')}</Text>
                    <View style={{
                        backgroundColor: rt.colorScheme === 'dark' ? '#2C3E50' : '#ECF0F1',
                        padding: 16,
                        borderRadius: 8,
                    }}>
                        <Text style={{
                            color: rt.colorScheme === 'dark' ? 'white' : 'black',
                            textAlign: 'center',
                            fontSize: 16,
                            fontWeight: '600'
                        }}>
                            {t('devTools.currentColorScheme', { scheme: rt.colorScheme })}
                        </Text>
                        <Text style={{
                            color: rt.colorScheme === 'dark' ? '#BDC3C7' : '#7F8C8D',
                            textAlign: 'center',
                            fontSize: 14,
                            marginTop: 4
                        }}>
                            {t('devTools.colorSchemeAdapts')}
                        </Text>
                    </View>
                </View>

                {/* Performance Note */}
                <View style={[styles.section, { backgroundColor: '#FFF3CD', borderColor: '#FFEAA7', borderWidth: 1 }]}>
                    <Text style={[styles.sectionTitle, { color: '#856404' }]}>{t('devTools.performanceNote')}</Text>
                    <Text style={{ color: '#856404', lineHeight: 20 }}>
                        {t('devTools.performanceNoteBody')}
                    </Text>
                </View>
            </ScrollView>
        </View>
    );
}
