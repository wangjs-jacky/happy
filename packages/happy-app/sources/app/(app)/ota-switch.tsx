import * as React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { applyOtaTarget } from '@/hooks/useOtaTarget';
import { Modal } from '@/modal';
import { Typography } from '@/constants/Typography';
import { useUnistyles } from 'react-native-unistyles';

// Deep link 处理页：扫「OTA 版本浏览站」上的二维码 → paws://ota-switch?channel=preview&stamp=<stamp>
// 唤起此页 → 弹确认 → setExtraParamAsync 锁定该版本 → check/fetch → reload。
// 只接受 preview 频道 + 纯数字 stamp（与 FC 端白名单一致），其余一律提示并返回，不做任何切换。

export default function OtaSwitchScreen() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const params = useLocalSearchParams<{ channel?: string; stamp?: string }>();
    const handledRef = React.useRef(false);

    React.useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        const channel = typeof params.channel === 'string' ? params.channel : '';
        const stamp = typeof params.stamp === 'string' ? params.stamp : '';

        (async () => {
            // 参数校验：只允许 preview + 纯数字 stamp
            if (channel !== 'preview' || !/^\d+$/.test(stamp)) {
                await Modal.alert('无法切换', '二维码参数无效：仅支持 preview 频道的版本切换。');
                router.back();
                return;
            }
            const confirmed = await Modal.confirm(
                '切换 OTA 版本？',
                `即将把本设备锁定到 preview 频道版本：\nstamp ${stamp}\n\n确认后会立即拉取目标包并重载，仅影响本设备。`,
                { confirmText: '拉取并切换', cancelText: '取消' },
            );
            if (!confirmed) {
                router.back();
                return;
            }
            try {
                await applyOtaTarget(stamp); // 重载后此页面不再返回
            } catch (e) {
                await Modal.alert('无法切换', e instanceof Error ? e.message : String(e));
                router.back();
            }
        })();
    }, [params.channel, params.stamp, router]);

    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, padding: theme.margins.xl }}>
            <Ionicons name="swap-horizontal-outline" size={48} color={theme.colors.textSecondary} />
            <Text style={[Typography.default(), { color: theme.colors.text, marginTop: theme.margins.lg, fontSize: 16 }]}>
                正在处理版本切换…
            </Text>
            <ActivityIndicator size="small" color={theme.colors.textSecondary} style={{ marginTop: theme.margins.md }} />
        </View>
    );
}
