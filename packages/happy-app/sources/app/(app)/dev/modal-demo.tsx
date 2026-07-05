import React from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { Typography } from '@/constants/Typography';
import { RoundButton } from '@/components/RoundButton';
import { t } from '@/text';

// Example custom modal component
function CustomContentModal({ onClose, title, message }: { onClose: () => void; title: string; message: string }) {
    return (
        <View style={styles.customModal}>
            <Text style={[styles.customModalTitle, Typography.default('semiBold')]}>{title}</Text>
            <Text style={[styles.customModalMessage, Typography.default()]}>{message}</Text>
            <View style={styles.customModalButtons}>
                <RoundButton
                    title={t('devTools.close')}
                    onPress={onClose}
                    size="normal"
                />
            </View>
        </View>
    );
}

export default function ModalDemoScreen() {
    const [lastResult, setLastResult] = React.useState<string>(() => t('devTools.noActionTaken'));

    const showSimpleAlert = () => {
        Modal.alert(t('devTools.simpleAlert'), t('devTools.simpleAlertMessage'));
        setLastResult(t('devTools.showedSimpleAlert'));
    };

    const showAlertWithMessage = () => {
        Modal.alert(
            t('devTools.alertWithMessage'),
            t('devTools.alertWithMessageBody')
        );
        setLastResult(t('devTools.showedAlertWithMessage'));
    };

    const showAlertWithButtons = () => {
        Modal.alert(
            t('devTools.multipleActions'),
            t('devTools.chooseAnAction'),
            [
                { text: t('common.cancel'), style: 'cancel', onPress: () => setLastResult(t('devTools.pressedAction', { action: t('common.cancel') })) },
                { text: t('devTools.optionOne'), onPress: () => setLastResult(t('devTools.pressedAction', { action: t('devTools.optionOne') })) },
                { text: t('devTools.optionTwo'), onPress: () => setLastResult(t('devTools.pressedAction', { action: t('devTools.optionTwo') })) }
            ]
        );
    };

    const showConfirm = async () => {
        const result = await Modal.confirm(
            t('devTools.confirmAction'),
            t('devTools.confirmActionMessage')
        );
        setLastResult(t('devTools.confirmResult', { result: result ? t('devTools.confirmed') : t('devTools.cancelled') }));
    };

    const showDestructiveConfirm = async () => {
        const result = await Modal.confirm(
            t('devTools.deleteItem'),
            t('devTools.deleteItemMessage'),
            {
                confirmText: t('common.delete'),
                cancelText: t('devTools.keep'),
                destructive: true
            }
        );
        setLastResult(t('devTools.deleteResult', { result: result ? t('devTools.deleted') : t('devTools.kept') }));
    };

    const showCustomModal = () => {
        Modal.show({
            component: CustomContentModal,
            props: {
                title: t('devTools.customModal'),
                message: t('devTools.customModalMessage')
            }
        });
        setLastResult(t('devTools.showedCustomModal'));
    };

    const showMultipleModals = async () => {
        Modal.alert(t('devTools.firstModal'), t('devTools.firstModalMessage'));
        
        setTimeout(() => {
            Modal.alert(t('devTools.secondModal'), t('devTools.secondModalMessage'));
        }, 1500);
        
        setLastResult(t('devTools.showedMultipleModals'));
    };

    return (
        <ScrollView style={styles.container}>
            <View style={styles.header}>
                <Text style={[styles.title, Typography.default('semiBold')]}>{t('devTools.modalDemoTitle')}</Text>
                <Text style={[styles.subtitle, Typography.default()]}>
                    {t('devTools.platformSummary', { platform: Platform.OS, implementation: Platform.OS === 'web' ? t('devTools.customModals') : t('devTools.nativeAlerts') })}
                </Text>
            </View>

            <ItemList>
                <ItemGroup title={t('devTools.alertModals')}>
                    <Item
                        title={t('devTools.simpleAlert')}
                        subtitle={t('devTools.simpleAlertSubtitle')}
                        onPress={showSimpleAlert}
                    />
                    <Item
                        title={t('devTools.alertWithMessage')}
                        subtitle={t('devTools.alertWithMessageSubtitle')}
                        onPress={showAlertWithMessage}
                    />
                    <Item
                        title={t('devTools.alertWithMultipleButtons')}
                        subtitle={t('devTools.alertWithMultipleButtonsSubtitle')}
                        onPress={showAlertWithButtons}
                    />
                </ItemGroup>

                <ItemGroup title={t('devTools.confirmationModals')}>
                    <Item
                        title={t('devTools.basicConfirmation')}
                        subtitle={t('devTools.basicConfirmationSubtitle')}
                        onPress={showConfirm}
                    />
                    <Item
                        title={t('devTools.destructiveConfirmation')}
                        subtitle={t('devTools.destructiveConfirmationSubtitle')}
                        onPress={showDestructiveConfirm}
                        destructive
                    />
                </ItemGroup>

                <ItemGroup title={t('devTools.customModalsGroup')}>
                    <Item
                        title={t('devTools.customModal')}
                        subtitle={t('devTools.customModalSubtitle')}
                        onPress={showCustomModal}
                    />
                    <Item
                        title={t('devTools.multipleModals')}
                        subtitle={t('devTools.multipleModalsSubtitle')}
                        onPress={showMultipleModals}
                    />
                </ItemGroup>

                <ItemGroup title={t('devTools.lastActionResult')}>
                    <View style={styles.resultContainer}>
                        <Text style={[styles.resultText, Typography.default()]}>
                            {lastResult}
                        </Text>
                    </View>
                </ItemGroup>
            </ItemList>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F2F2F7'
    },
    header: {
        padding: 20,
        backgroundColor: '#fff',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#E5E5E7'
    },
    title: {
        fontSize: 24,
        marginBottom: 4
    },
    subtitle: {
        fontSize: 14,
        color: '#8E8E93'
    },
    resultContainer: {
        padding: 16,
        backgroundColor: '#fff'
    },
    resultText: {
        fontSize: 16,
        color: '#007AFF'
    },
    customModal: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 20,
        width: 300,
        alignItems: 'center'
    },
    customModalTitle: {
        fontSize: 20,
        marginBottom: 12
    },
    customModalMessage: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 20,
        color: '#666'
    },
    customModalButtons: {
        width: '100%'
    }
});
