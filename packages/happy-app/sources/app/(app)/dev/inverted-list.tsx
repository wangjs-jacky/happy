import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, Platform, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useKeyboardHandler, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { runOnJS, useSharedValue } from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
import { LegendList } from '@legendapp/list';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';

type ListType = 'flash' | 'flat' | 'legend';
type PaddingType = 'animated' | 'non-animated' | 'header-footer';

export default function InvertedListTest() {
    const [messages, setMessages] = useState<Array<{ id: string; text: string }>>([]);
    const [inputText, setInputText] = useState('');
    const [listType, setListType] = useState<ListType>('flash');
    const [paddingType, setPaddingType] = useState<PaddingType>('non-animated');
    const insets = useSafeAreaInsets();
    const { height } = useReanimatedKeyboardAnimation();
    const [paddingValue, setPaddingValue] = useState(0);
    const animatedPaddingValue = useSharedValue(0);

    useKeyboardHandler({
        onStart(e) {
            'worklet';
            runOnJS(setPaddingValue)(e.height);
            if (paddingType === 'animated') {
                animatedPaddingValue.value = e.height;
            }
        },
        onEnd(e) {
            'worklet';
            runOnJS(setPaddingValue)(e.height);
            if (paddingType === 'animated') {
                animatedPaddingValue.value = e.height;
            }
        },
    })

    const addMessage = () => {
        if (inputText.trim()) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                text: inputText
            }]);
            setInputText('');
        }
    };

    const renderItem = ({ item }: { item: { id: string; text: string } }) => (
        <View style={styles.messageItem}>
            <Text style={styles.messageText}>{item.text}</Text>
        </View>
    );

    return (
        <>
            <Stack.Screen
                options={{
                    headerTitle: t('devTools.invertedListTest'),
                }}
            />

            <Animated.View
                style={[styles.container, { transform: [{ translateY: height }] }]}
                testID="dev-inverted-list-screen"
            >
                <View style={styles.controlsContainer}>
                    <View
                        accessibilityRole="radiogroup"
                        accessibilityLabel={t('devTools.listImplementation')}
                    >
                        <Text style={styles.controlLabel}>{t('devTools.listImplementation')}</Text>
                        <View style={styles.buttonRow}>
                            <TouchableOpacity
                                onPress={() => setListType('flash')}
                                style={[styles.button, listType === 'flash' ? styles.buttonActive : styles.buttonInactive]}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: listType === 'flash' }}
                                aria-checked={listType === 'flash'}
                                testID="dev-inverted-list-type-flash"
                            >
                                <Text style={[styles.buttonText, listType === 'flash' ? styles.buttonTextActive : styles.buttonTextInactive]}>FlashList</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={() => setListType('flat')}
                                style={[styles.button, listType === 'flat' ? styles.buttonActive : styles.buttonInactive]}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: listType === 'flat' }}
                                aria-checked={listType === 'flat'}
                                testID="dev-inverted-list-type-flat"
                            >
                                <Text style={[styles.buttonText, listType === 'flat' ? styles.buttonTextActive : styles.buttonTextInactive]}>FlatList</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={() => setListType('legend')}
                                style={[styles.button, listType === 'legend' ? styles.buttonActive : styles.buttonInactive]}
                                accessibilityRole="radio"
                                accessibilityLabel={Platform.OS === 'web'
                                    ? `LegendList, ${t('devTools.nativeOnly')}`
                                    : 'LegendList'}
                                accessibilityState={{
                                    checked: listType === 'legend',
                                    disabled: Platform.OS === 'web',
                                }}
                                aria-checked={listType === 'legend'}
                                disabled={Platform.OS === 'web'}
                                testID="dev-inverted-list-type-legend"
                            >
                                <Text style={[styles.buttonText, listType === 'legend' ? styles.buttonTextActive : styles.buttonTextInactive]}>LegendList</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    <View
                        accessibilityRole="radiogroup"
                        accessibilityLabel={t('devTools.paddingMethod')}
                    >
                        <Text style={styles.controlLabel}>{t('devTools.paddingMethod')}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                            <View style={styles.buttonRow}>
                                <TouchableOpacity
                                    onPress={() => setPaddingType('animated')}
                                    style={[styles.button, paddingType === 'animated' ? styles.buttonActive : styles.buttonInactive]}
                                    accessibilityRole="radio"
                                    accessibilityState={{ checked: paddingType === 'animated' }}
                                    aria-checked={paddingType === 'animated'}
                                    testID="dev-inverted-list-padding-animated"
                                >
                                    <Text style={[styles.buttonText, paddingType === 'animated' ? styles.buttonTextActive : styles.buttonTextInactive]}>{t('devTools.animated')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={() => setPaddingType('non-animated')}
                                    style={[styles.button, paddingType === 'non-animated' ? styles.buttonActive : styles.buttonInactive]}
                                    accessibilityRole="radio"
                                    accessibilityState={{ checked: paddingType === 'non-animated' }}
                                    aria-checked={paddingType === 'non-animated'}
                                    testID="dev-inverted-list-padding-static"
                                >
                                    <Text style={[styles.buttonText, paddingType === 'non-animated' ? styles.buttonTextActive : styles.buttonTextInactive]}>{t('devTools.nonAnimated')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={() => setPaddingType('header-footer')}
                                    style={[styles.button, paddingType === 'header-footer' ? styles.buttonActive : styles.buttonInactive]}
                                    accessibilityRole="radio"
                                    accessibilityState={{ checked: paddingType === 'header-footer' }}
                                    aria-checked={paddingType === 'header-footer'}
                                    testID="dev-inverted-list-padding-header-footer"
                                >
                                    <Text style={[styles.buttonText, paddingType === 'header-footer' ? styles.buttonTextActive : styles.buttonTextInactive]}>{t('devTools.headerFooter')}</Text>
                                </TouchableOpacity>
                            </View>
                        </ScrollView>
                    </View>
                </View>
                
                {(() => {
                    const ListEmptyComponent = (
                        <View style={styles.emptyState}>
                            <Text style={styles.emptyStateText}>
                                {t('devTools.noMessagesYet')}
                            </Text>
                        </View>
                    );
                    
                    const ListHeaderComponent = paddingType === 'header-footer' ? 
                        <View style={{ height: paddingValue }} /> : undefined;
                    
                    const ListContainer = paddingType === 'animated' ? Animated.View : View;
                    const containerStyle = { 
                        flex: 1, 
                        paddingTop: paddingType === 'non-animated' ? paddingValue : 
                                    paddingType === 'animated' ? animatedPaddingValue : 0
                    };
                    
                    if (listType === 'flash') {
                        return (
                            <ListContainer style={containerStyle as any}>
                                <FlashList
                                    data={messages}
                                    renderItem={renderItem}
                                    keyExtractor={item => item.id}
                                    maintainVisibleContentPosition={{
                                        autoscrollToBottomThreshold: 0.2,
                                        autoscrollToTopThreshold: 100,
                                        startRenderingFromBottom: true
                                    }}
                                    ListEmptyComponent={ListEmptyComponent}
                                    ListHeaderComponent={ListHeaderComponent}
                                />
                            </ListContainer>
                        );
                    } else if (listType === 'flat') {
                        return (
                            <ListContainer style={containerStyle as any}>
                                <FlatList
                                    data={[...messages].reverse()}
                                    renderItem={renderItem}
                                    keyExtractor={item => item.id}
                                    maintainVisibleContentPosition={{
                                        minIndexForVisible: 0,
                                        autoscrollToTopThreshold: 100,
                                    }}
                                    inverted={true}
                                    ListEmptyComponent={ListEmptyComponent}
                                    ListHeaderComponent={ListHeaderComponent}
                                />
                            </ListContainer>
                        );
                    } else if (Platform.OS !== 'web') {
                        return (
                            <ListContainer style={containerStyle as any}>
                                <LegendList
                                    data={messages}
                                    renderItem={renderItem}
                                    keyExtractor={item => item.id}
                                    maintainVisibleContentPosition={true}
                                    maintainScrollAtEnd={true}
                                    ListEmptyComponent={ListEmptyComponent}
                                    ListHeaderComponent={ListHeaderComponent}
                                />
                            </ListContainer>
                        );
                    }

                    return null;
                })()}

                <View style={[styles.inputContainer, { paddingBottom: insets.bottom + 4 }]}>
                    <View style={styles.inputRow}>
                        <TextInput
                            style={styles.textInput}
                            placeholder={t('devTools.typeMessage')}
                            placeholderTextColor={styles.textInputPlaceholder.color}
                            value={inputText}
                            onChangeText={setInputText}
                            onSubmitEditing={addMessage}
                            returnKeyType="send"
                            accessibilityLabel={t('devTools.typeMessage')}
                            testID="dev-inverted-list-input"
                        />
                        <TouchableOpacity
                            onPress={addMessage}
                            style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !inputText.trim() }}
                            disabled={!inputText.trim()}
                            testID="dev-inverted-list-send"
                        >
                            <Text style={styles.sendButtonText}>{t('devTools.send')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Animated.View>
        </>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    controlsContainer: {
        backgroundColor: theme.colors.surface,
        padding: 8,
        gap: 8,
    },
    controlLabel: {
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 4,
        color: theme.colors.textSecondary,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: 8,
    },
    button: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 4,
    },
    buttonActive: {
        backgroundColor: theme.colors.accent,
    },
    buttonInactive: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    buttonText: {
        fontSize: 12,
    },
    buttonTextActive: {
        color: theme.colors.groupped.background,
    },
    buttonTextInactive: {
        color: theme.colors.text,
    },
    messageItem: {
        padding: 16,
        marginHorizontal: 16,
        marginVertical: 8,
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 8,
    },
    messageText: {
        color: theme.colors.text,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
    },
    emptyStateText: {
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    inputContainer: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        padding: 16,
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    textInput: {
        flex: 1,
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: theme.colors.input.background,
        color: theme.colors.input.text,
        borderRadius: 20,
        marginRight: 8,
    },
    textInputPlaceholder: {
        color: theme.colors.input.placeholder,
    },
    sendButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: theme.colors.accent,
        borderRadius: 20,
    },
    sendButtonDisabled: {
        backgroundColor: theme.colors.surfaceHigh,
        opacity: 0.6,
    },
    sendButtonText: {
        color: theme.colors.groupped.background,
        fontWeight: '600',
    },
}));
