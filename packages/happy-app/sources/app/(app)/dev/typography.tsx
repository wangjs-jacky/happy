import * as React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/Typography';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { t } from '@/text';

const TextSample = ({ title, style, text = t('devTools.quickBrownFox') }: { title: string; style: any; text?: string }) => (
    <View style={styles.sampleContainer}>
        <Text style={styles.sampleTitle}>{title}</Text>
        <Text style={[{ fontSize: 16 }, style]}>{text}</Text>
    </View>
);

const CodeSample = ({ title, style }: { title: string; style: any }) => (
    <View style={styles.sampleContainer}>
        <Text style={styles.sampleTitle}>{title}</Text>
        <Text style={[{ fontSize: 14 }, style]}>
            {`const greeting = "Hello, World!";\nconsole.log(greeting);`}
        </Text>
    </View>
);

export default function TypographyScreen() {
    return (
        <ScrollView style={styles.container}>
            <View style={styles.content}>
                {/* IBM Plex Sans (Default) */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('devTools.ibmPlexSansDefault')}</Text>
                    
                    <TextSample 
                        title={t('devTools.regular400')}
                        style={Typography.default()}
                    />
                    
                    <TextSample 
                        title={t('devTools.italic')}
                        style={Typography.default('italic')}
                    />
                    
                    <TextSample 
                        title={t('devTools.semiBold600')}
                        style={Typography.default('semiBold')}
                    />
                </View>

                {/* IBM Plex Mono */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>IBM Plex Mono</Text>
                    
                    <CodeSample 
                        title={t('devTools.regular400')}
                        style={Typography.mono()}
                    />
                    
                    <CodeSample 
                        title={t('devTools.italic')}
                        style={Typography.mono('italic')}
                    />
                    
                    <CodeSample 
                        title={t('devTools.semiBold600')}
                        style={Typography.mono('semiBold')}
                    />
                </View>

                {/* Bricolage Grotesque (Logo) */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('devTools.bricolageLogo')}</Text>
                    
                    <TextSample 
                        title={t('devTools.boldLogoOnly')}
                        style={{ fontSize: 28, ...Typography.logo() }}
                        text="Paws"
                    />
                    <Text style={styles.note}>
                        {t('devTools.logoFontNote')}
                    </Text>
                </View>

                {/* Font Sizes */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('devTools.fontSizeScale')}</Text>
                    
                    {[12, 14, 16, 18, 20, 24, 28, 32, 36].map(size => (
                        <View key={size} style={styles.fontSizeItem}>
                            <Text style={{ fontSize: size, ...Typography.default() }}>
                                {t('devTools.fontSizeSample', { size })}
                            </Text>
                        </View>
                    ))}
                </View>

                {/* Text in Components */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('devTools.typographyInComponents')}</Text>
                    
                    <ItemGroup title={t('devTools.listItemTypography')}>
                        <Item 
                            title={t('devTools.defaultTitleSample')}
                            subtitle={t('devTools.defaultSubtitleSample')}
                            detail={t('devTools.detail')}
                        />
                        <Item 
                            title={t('devTools.customTitleStyle')}
                            titleStyle={{ ...Typography.default('semiBold') }}
                            subtitle={t('devTools.semiBoldSubtitle')}
                        />
                        <Item 
                            title={t('devTools.monospaceDetail')}
                            detail="v1.0.0"
                            detailStyle={{ ...Typography.mono() }}
                        />
                    </ItemGroup>
                </View>

                {/* Usage Examples */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('devTools.usageExamples')}</Text>
                    
                    <View style={styles.codeBlock}>
                        <Text style={{ ...Typography.mono(), fontSize: 12 }}>
{`// Default typography (IBM Plex Sans)
<Text style={{ fontSize: 16, ...Typography.default() }}>Regular</Text>
<Text style={{ fontSize: 16, ...Typography.default('semiBold') }}>Bold</Text>

// Monospace typography (IBM Plex Mono)
<Text style={{ fontSize: 14, ...Typography.mono() }}>Code</Text>

// Logo typography (Bricolage Grotesque)
<Text style={{ fontSize: 28, ...Typography.logo() }}>Logo</Text>`}
                        </Text>
                    </View>
                </View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'white',
    },
    content: {
        padding: 16,
    },
    sampleContainer: {
        marginBottom: 24,
    },
    sampleTitle: {
        fontSize: 14,
        color: 'rgba(0,0,0,0.5)',
        marginBottom: 4,
    },
    section: {
        marginBottom: 32,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginBottom: 16,
    },
    note: {
        fontSize: 14,
        color: 'rgba(0,0,0,0.5)',
        marginTop: 8,
    },
    fontSizeItem: {
        marginBottom: 12,
    },
    codeBlock: {
        backgroundColor: '#f0f0f0',
        padding: 16,
        borderRadius: 8,
    },
});
