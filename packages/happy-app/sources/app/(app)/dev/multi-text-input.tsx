import * as React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { MultiTextInput, KeyPressEvent } from '@/components/MultiTextInput';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

export default function MultiTextInputDemo() {
    const [text1, setText1] = React.useState('');
    const [text2, setText2] = React.useState(() => t('devTools.initialValueText'));
    const [text3, setText3] = React.useState('');
    const [text4, setText4] = React.useState('');
    const [text5, setText5] = React.useState('');
    const [lastKey, setLastKey] = React.useState<string>('');

    return (
        <ScrollView style={styles.container} testID="dev-multi-text-input-screen">
            <View style={styles.content}>
                <View>
                    <Text style={styles.title}>
                        {t('devTools.basicUsage')}
                    </Text>
                    <Text style={styles.description}>
                        {t('devTools.basicUsageSubtitle')}
                    </Text>
                    <View style={styles.inputSurface}>
                        <MultiTextInput
                            value={text1}
                            onChangeText={setText1}
                            placeholder={t('devTools.typeSomethingHere')}
                            accessibilityLabel={t('devTools.basicUsage')}
                            testID="dev-multi-text-input-basic"
                        />
                    </View>
                    <Text style={styles.summary}>
                        {t('devTools.charactersCount', { count: text1.length })}
                    </Text>
                </View>

                <View>
                    <Text style={styles.title}>
                        {t('devTools.withInitialValue')}
                    </Text>
                    <Text style={styles.description}>
                        {t('devTools.prePopulatedWithText')}
                    </Text>
                    <View style={styles.inputSurface}>
                        <MultiTextInput
                            value={text2}
                            onChangeText={setText2}
                            placeholder={t('devTools.initialValuePlaceholder')}
                            accessibilityLabel={t('devTools.withInitialValue')}
                            testID="dev-multi-text-input-initial"
                        />
                    </View>
                    <Text style={styles.summary}>
                        {t('devTools.charactersCount', { count: text2.length })}
                    </Text>
                </View>

                <View>
                    <Text style={styles.title}>
                        {t('devTools.limitedHeight')}
                    </Text>
                    <Text style={styles.description}>
                        {t('devTools.limitedHeightSubtitle')}
                    </Text>
                    <View style={styles.inputSurface}>
                        <MultiTextInput
                            value={text3}
                            onChangeText={setText3}
                            placeholder={t('devTools.multipleLinesPlaceholder')}
                            maxHeight={60}
                            accessibilityLabel={t('devTools.limitedHeight')}
                            testID="dev-multi-text-input-limited"
                        />
                    </View>
                    <Text style={styles.summary}>
                        {t('devTools.maxHeightSummary', { count: text3.length, max: 60 })}
                    </Text>
                </View>

                <View>
                    <Text style={styles.title}>
                        {t('devTools.largerHeight')}
                    </Text>
                    <Text style={styles.description}>
                        {t('devTools.largerHeightSubtitle')}
                    </Text>
                    <View style={styles.inputSurface}>
                        <MultiTextInput
                            value={text4}
                            onChangeText={setText4}
                            placeholder={t('devTools.largerHeightPlaceholder')}
                            maxHeight={200}
                            accessibilityLabel={t('devTools.largerHeight')}
                            testID="dev-multi-text-input-large"
                        />
                    </View>
                    <Text style={styles.summary}>
                        {t('devTools.maxHeightSummary', { count: text4.length, max: 200 })}
                    </Text>
                </View>

                <View>
                    <Text style={styles.title}>
                        {t('devTools.keyboardHandling')}
                    </Text>
                    <Text style={styles.description}>
                        {t('devTools.keyboardHandlingSubtitle')}
                    </Text>
                    <View style={styles.inputSurface}>
                        <MultiTextInput
                            value={text5}
                            onChangeText={setText5}
                            placeholder={t('devTools.keyboardPlaceholder')}
                            accessibilityLabel={t('devTools.keyboardHandling')}
                            testID="dev-multi-text-input-keyboard"
                            onKeyPress={(event: KeyPressEvent): boolean => {
                                setLastKey(`${event.key}${event.shiftKey ? ' + Shift' : ''}`);
                                
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    if (text5.trim()) {
                                        // Simulate submit
                                        setText5('');
                                        return true;
                                    }
                                } else if (event.key === 'Escape') {
                                    setText5('');
                                    return true;
                                }
                                
                                return false; // Let arrow keys and other keys work normally
                            }}
                        />
                    </View>
                    <Text style={styles.summary}>
                        {t('devTools.lastKeySummary', { key: lastKey || t('devTools.none'), count: text5.length })}
                    </Text>
                </View>

                <View style={{ height: 100 }} />
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        padding: 16,
        gap: 24,
    },
    title: {
        fontSize: 16,
        marginBottom: 8,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    description: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        marginBottom: 12,
        ...Typography.default(),
    },
    inputSurface: {
        backgroundColor: theme.colors.input.background,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 12,
    },
    summary: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 4,
        ...Typography.default(),
    },
}));
