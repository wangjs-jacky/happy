import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Stack } from 'expo-router';
import { ShimmerView } from '@/components/ShimmerView';
import { ItemGroup } from '@/components/ItemGroup';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/text';

export default function ShimmerDemoScreen() {
    return (
        <>
            <Stack.Screen
                options={{
                    headerTitle: t('devTools.shimmerView'),
                }}
            />
            
            <ScrollView style={styles.container} testID="dev-shimmer-screen">
                <View style={styles.content}>
                    <Text style={styles.pageTitle} testID="dev-shimmer-heading">
                        {t('devTools.shimmerViewExamples')}
                    </Text>
                    <Text style={styles.description} testID="dev-shimmer-secondary">
                        {t('devTools.shimmerViewDescription')}
                    </Text>

                    <ItemGroup title={t('devTools.textShimmer')}>
                        <View style={styles.example} testID="dev-shimmer-elevated">
                            <ShimmerView style={styles.shimmerContainer}>
                                <Text style={styles.shimmerText}>{t('devTools.loadingContent')}</Text>
                            </ShimmerView>
                        </View>

                        <View style={styles.example}>
                            <ShimmerView 
                                style={styles.wideShimmerContainer}
                                shimmerColors={['#D0D0D0', '#E8E8E8', '#FFFFFF', '#E8E8E8', '#D0D0D0']}
                            >
                                <View>
                                    <Text style={styles.titleText}>{t('devTools.awesomeTitle')}</Text>
                                    <Text style={styles.subtitleText}>{t('devTools.shimmerSubtitle')}</Text>
                                </View>
                            </ShimmerView>
                        </View>
                    </ItemGroup>

                    <ItemGroup title={t('devTools.iconShimmer')}>
                        <View style={styles.example}>
                            <ShimmerView style={styles.iconShimmerContainer} duration={1000}>
                                <View style={styles.iconContainer}>
                                    <Ionicons name="logo-react" size={80} color="#61DAFB" />
                                </View>
                            </ShimmerView>
                        </View>
                    </ItemGroup>

                    <ItemGroup title={t('devTools.cardSkeleton')}>
                        <View style={styles.example}>
                            <ShimmerView style={styles.cardShimmerContainer}>
                                <View style={styles.card}>
                                    <View style={styles.cardHeader}>
                                        <View style={styles.avatar} />
                                        <View style={styles.cardInfo}>
                                            <View style={styles.nameLine} />
                                            <View style={styles.dateLine} />
                                        </View>
                                    </View>
                                    <View style={styles.cardContent}>
                                        <View style={styles.contentLine} />
                                        <View style={[styles.contentLine, { width: '80%' }]} />
                                    </View>
                                </View>
                            </ShimmerView>
                        </View>
                    </ItemGroup>

                    <ItemGroup title={t('devTools.customColors')}>
                        <View style={styles.example}>
                            <ShimmerView 
                                style={styles.shimmerContainer}
                                shimmerColors={['#FFE4E1', '#FFF0F5', '#FFFFFF', '#FFF0F5', '#FFE4E1']}
                                duration={2000}
                            >
                                <Text style={[styles.shimmerText, { color: '#FF69B4' }]}>
                                    {t('devTools.pinkShimmer')}
                                </Text>
                            </ShimmerView>
                        </View>

                        <View style={styles.example}>
                            <ShimmerView 
                                style={styles.shimmerContainer}
                                shimmerColors={['#E0F2F1', '#B2DFDB', '#80CBC4', '#B2DFDB', '#E0F2F1']}
                                shimmerWidthPercent={120}
                            >
                                <Text style={[styles.shimmerText, { color: '#009688' }]}>
                                    {t('devTools.tealShimmer')}
                                </Text>
                            </ShimmerView>
                        </View>
                    </ItemGroup>

                    <ItemGroup title={t('devTools.complexShapes')}>
                        <View style={styles.example}>
                            <ShimmerView style={styles.complexShimmerContainer}>
                                <View style={styles.complexShape}>
                                    <View style={styles.circle} />
                                    <View style={styles.rectangle} />
                                    <View style={styles.smallCircle} />
                                </View>
                            </ShimmerView>
                        </View>
                    </ItemGroup>

                    <ItemGroup title={t('devTools.fullWidthExample')}>
                        <View style={styles.example}>
                            <ShimmerView style={styles.fullWidthContainer}>
                                <View style={styles.fullWidthContent}>
                                    <Text style={styles.fullWidthText}>{t('devTools.fullWidthShimmerEffect')}</Text>
                                </View>
                            </ShimmerView>
                        </View>
                    </ItemGroup>
                </View>
            </ScrollView>
        </>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        flex: 1,
        paddingBottom: 40,
    },
    pageTitle: {
        fontSize: 28,
        fontWeight: 'bold',
        color: theme.colors.text,
        marginTop: 20,
        marginBottom: 8,
        paddingHorizontal: 16,
    },
    description: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        marginBottom: 20,
        paddingHorizontal: 16,
    },
    example: {
        paddingVertical: 20,
        paddingHorizontal: 16,
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
    },
    shimmerText: {
        fontSize: 24,
        fontWeight: 'bold',
        color: theme.colors.text,
    },
    titleText: {
        fontSize: 28,
        fontWeight: 'bold',
        color: theme.colors.text,
        marginBottom: 8,
    },
    subtitleText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
    },
    iconContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    card: {
        flex: 1,
        padding: 16,
    },
    cardHeader: {
        flexDirection: 'row',
        marginBottom: 16,
    },
    avatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: theme.colors.textSecondary,
        marginRight: 12,
    },
    cardInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    nameLine: {
        height: 16,
        backgroundColor: theme.colors.textSecondary,
        borderRadius: 4,
        marginBottom: 8,
        width: '60%',
    },
    dateLine: {
        height: 12,
        backgroundColor: theme.colors.textSecondary,
        borderRadius: 4,
        width: '40%',
    },
    cardContent: {
        gap: 8,
    },
    contentLine: {
        height: 12,
        backgroundColor: theme.colors.textSecondary,
        borderRadius: 4,
        width: '100%',
    },
    complexShape: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    circle: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: theme.colors.textSecondary,
        marginBottom: 20,
    },
    rectangle: {
        width: 150,
        height: 40,
        backgroundColor: theme.colors.textSecondary,
        borderRadius: 8,
        marginBottom: 20,
    },
    smallCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: theme.colors.textSecondary,
    },
    shimmerContainer: {
        width: 300,
        height: 60,
    },
    wideShimmerContainer: {
        width: 350,
        height: 100,
    },
    iconShimmerContainer: {
        width: 100,
        height: 100,
    },
    cardShimmerContainer: {
        width: 350,
        height: 120,
    },
    complexShimmerContainer: {
        width: 200,
        height: 200,
    },
    fullWidthContainer: {
        width: '100%',
        height: 80,
    },
    fullWidthContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullWidthText: {
        fontSize: 20,
        fontWeight: 'bold',
        color: theme.colors.text,
    },
}));
