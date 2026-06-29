import * as React from 'react';
import * as Updates from 'expo-updates';

// useOtaTarget —— 管理「OTA 定向版本锁定」状态。
//
// 原理：expo-updates 的 setExtraParamAsync(key, value) 设的参数会随每次更新检查，
// 以 Expo-Extra-Params 请求头发给自建 FC。我们用 key='ota-target-stamp' 存一个历史版本的
// 毫秒时间戳；FC（仅 preview 频道）据此返回该历史 manifest，从而把本设备锁定到指定版本。
//   - 锁定：setExtraParamAsync('ota-target-stamp', stamp) → reloadAsync() 立即拉该版本
//   - 解锁：setExtraParamAsync('ota-target-stamp', null)   → reloadAsync() 回到跟随 latest
// 锁定只对本设备生效（extra-params 是端上持久化的），不影响其他设备。
// 仅 preview 频道有意义；production 包发的是 production 频道，FC 会忽略该参数。

const EXTRA_PARAM_KEY = 'ota-target-stamp';

export interface OtaTargetState {
    // 当前锁定的版本 stamp；null = 未锁定（跟随最新）
    lockedStamp: string | null;
    // 当前正在运行的 OTA 信息（来自 expo-updates 运行时常量）
    currentUpdateId: string | null;
    channel: string | null;
    // 正在读取 / 切换中
    loading: boolean;
    refresh: () => Promise<void>;
    // 锁定到某版本并重载（重载会中断当前 JS，调用后即不再返回）
    lockTo: (stamp: string) => Promise<void>;
    // 解除锁定并重载
    unlock: () => Promise<void>;
}

export function useOtaTarget(): OtaTargetState {
    const [lockedStamp, setLockedStamp] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const params = await Updates.getExtraParamsAsync();
            const v = params?.[EXTRA_PARAM_KEY];
            setLockedStamp(typeof v === 'string' && v.length > 0 ? v : null);
        } catch {
            // never show loading error —— 读不到就当未锁定
            setLockedStamp(null);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    const lockTo = React.useCallback(async (stamp: string) => {
        await Updates.setExtraParamAsync(EXTRA_PARAM_KEY, stamp);
        await Updates.reloadAsync();
    }, []);

    const unlock = React.useCallback(async () => {
        await Updates.setExtraParamAsync(EXTRA_PARAM_KEY, null);
        await Updates.reloadAsync();
    }, []);

    return {
        lockedStamp,
        currentUpdateId: Updates.updateId ?? null,
        channel: Updates.channel ?? null,
        loading,
        refresh,
        lockTo,
        unlock,
    };
}
