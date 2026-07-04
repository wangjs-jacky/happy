import * as React from 'react';
import { View, Text, ScrollView } from 'react-native';
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
        <ScrollView style={{ flex: 1, backgroundColor: 'white' }}>
            <View style={{ padding: 16, gap: 24 }}>
                <View>
                    <Text style={{ 
                        fontSize: 16, 
                        marginBottom: 8,
                        ...Typography.default('semiBold')
                    }}>
                        {t('devTools.basicUsage')}
                    </Text>
                    <Text style={{ 
                        fontSize: 14, 
                        color: '#666',
                        marginBottom: 12,
                        ...Typography.default()
                    }}>
                        {t('devTools.basicUsageSubtitle')}
                    </Text>
                    <View style={{
                        backgroundColor: '#f5f5f5',
                        borderRadius: 8,
                        padding: 12,
                    }}>
                        <MultiTextInput
                            value={text1}
                            onChangeText={setText1}
                            placeholder={t('devTools.typeSomethingHere')}
                        />
                    </View>
                    <Text style={{ 
                        fontSize: 12, 
                        color: '#999',
                        marginTop: 4,
                        ...Typography.default()
                    }}>
                        {t('devTools.charactersCount', { count: text1.length })}
                    </Text>
                </View>

                <View>
                    <Text style={{ 
                        fontSize: 16, 
                        marginBottom: 8,
                        ...Typography.default('semiBold')
                    }}>
                        {t('devTools.withInitialValue')}
                    </Text>
                    <Text style={{ 
                        fontSize: 14, 
                        color: '#666',
                        marginBottom: 12,
                        ...Typography.default()
                    }}>
                        {t('devTools.prePopulatedWithText')}
                    </Text>
                    <View style={{
                        backgroundColor: '#f0f7ff',
                        borderRadius: 8,
                        padding: 12,
                    }}>
                        <MultiTextInput
                            value={text2}
                            onChangeText={setText2}
                            placeholder={t('devTools.initialValuePlaceholder')}
                        />
                    </View>
                    <Text style={{ 
                        fontSize: 12, 
                        color: '#999',
                        marginTop: 4,
                        ...Typography.default()
                    }}>
                        {t('devTools.charactersCount', { count: text2.length })}
                    </Text>
                </View>

                <View>
                    <Text style={{ 
                        fontSize: 16, 
                        marginBottom: 8,
                        ...Typography.default('semiBold')
                    }}>
                        {t('devTools.limitedHeight')}
                    </Text>
                    <Text style={{ 
                        fontSize: 14, 
                        color: '#666',
                        marginBottom: 12,
                        ...Typography.default()
                    }}>
                        {t('devTools.limitedHeightSubtitle')}
                    </Text>
                    <View style={{
                        backgroundColor: '#fff5f5',
                        borderRadius: 8,
                        padding: 12,
                    }}>
                        <MultiTextInput
                            value={text3}
                            onChangeText={setText3}
                            placeholder={t('devTools.multipleLinesPlaceholder')}
                            maxHeight={60}
                        />
                    </View>
                    <Text style={{ 
                        fontSize: 12, 
                        color: '#999',
                        marginTop: 4,
                        ...Typography.default()
                    }}>
                        {t('devTools.maxHeightSummary', { count: text3.length, max: 60 })}
                    </Text>
                </View>

                <View>
                    <Text style={{ 
                        fontSize: 16, 
                        marginBottom: 8,
                        ...Typography.default('semiBold')
                    }}>
                    {t('devTools.largerHeight')}
                    </Text>
                    <Text style={{ 
                        fontSize: 14, 
                        color: '#666',
                        marginBottom: 12,
                        ...Typography.default()
                    }}>
                        {t('devTools.largerHeightSubtitle')}
                    </Text>
                    <View style={{
                        backgroundColor: '#f5fff5',
                        borderRadius: 8,
                        padding: 12,
                    }}>
                        <MultiTextInput
                            value={text4}
                            onChangeText={setText4}
                            placeholder={t('devTools.largerHeightPlaceholder')}
                            maxHeight={200}
                        />
                    </View>
                    <Text style={{ 
                        fontSize: 12, 
                        color: '#999',
                        marginTop: 4,
                        ...Typography.default()
                    }}>
                        {t('devTools.maxHeightSummary', { count: text4.length, max: 200 })}
                    </Text>
                </View>

                <View>
                    <Text style={{ 
                        fontSize: 16, 
                        marginBottom: 8,
                        ...Typography.default('semiBold')
                    }}>
                        {t('devTools.keyboardHandling')}
                    </Text>
                    <Text style={{ 
                        fontSize: 14, 
                        color: '#666',
                        marginBottom: 12,
                        ...Typography.default()
                    }}>
                        {t('devTools.keyboardHandlingSubtitle')}
                    </Text>
                    <View style={{
                        backgroundColor: '#fff0f5',
                        borderRadius: 8,
                        padding: 12,
                    }}>
                        <MultiTextInput
                            value={text5}
                            onChangeText={setText5}
                            placeholder={t('devTools.keyboardPlaceholder')}
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
                    <Text style={{ 
                        fontSize: 12, 
                        color: '#999',
                        marginTop: 4,
                        ...Typography.default()
                    }}>
                        {t('devTools.lastKeySummary', { key: lastKey || t('devTools.none'), count: text5.length })}
                    </Text>
                </View>

                <View style={{ height: 100 }} />
            </View>
        </ScrollView>
    );
}
