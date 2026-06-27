import * as React from 'react';
import { Platform } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { useSharedValue, withTiming, Easing, cancelAnimation, type SharedValue } from 'react-native-reanimated';

/**
 * 把手机的重力感应（加速度计）转成一组可被 Skia/Reanimated worklet 直接消费的
 * shared value，用来驱动 ComposeHomeParticles 那团粒子「随重力摇摆」。
 *
 * 两条独立通道，对应两种手感：
 *  1) 倾斜飘移（gx / gy）：把加速度计 x/y 读数做指数平滑后输出，归一化到约 [-1, 1]。
 *     消费方按屏幕尺寸放大成像素偏移叠加到「引力点」上 —— 倾斜手机时整团粒子朝
 *     重力方向缓慢飘移，安静、无抖、持续跟随。
 *  2) 摇晃甩动（shake）：监测加速度「突变量（jerk）」，超过阈值即把 shake 瞬间拉满，
 *     再用 elastic 缓动衰减回 0 —— 视觉上粒子被甩开后弹性回位。
 *
 * 平滑、突变检测都在 JS 线程的传感器回调里算（加速度计回调本就在 JS 线程），结果写进
 * shared value；worklet 每帧读 .value 即可，跨线程零成本。
 *
 * 容错：模拟器 / Web / 无加速度计的设备上 isAvailableAsync 为 false，直接不订阅，
 * 三个 shared value 恒为 0 —— 消费方退化回原本的纯时钟运动，绝不报错。
 *
 * —— 调参集中在文件顶部常量；尤其 SIGN_X / SIGN_Y 是「倾斜方向 → 飘移方向」的符号，
 * 不同握姿/横竖屏可能需要翻转，真机上若方向反了改这两个值即可（模拟器测不出方向）。
 */

// —— 可调参数 ——
const SMOOTH = 0.12;          // 倾斜指数平滑系数（越小越跟手但越抖；越大越稳但越钝）
const TILT_CLAMP = 0.9;       // 倾斜归一化上限，避免手机大角度时飘移过界
const SIGN_X = 1;             // 倾斜 x → 飘移 x 的方向符号（真机上反了就改 -1）
const SIGN_Y = -1;            // 倾斜 y → 飘移 y 的方向符号
const SHAKE_THRESHOLD = 1.3;  // 触发「甩动」的 jerk 阈值（g/帧；越小越灵敏）
const SHAKE_DECAY_MS = 1100;  // 甩动能量弹性衰减回 0 的时长

export interface GravityField {
    gx: SharedValue<number>;     // 归一化倾斜偏移 X，约 [-TILT_CLAMP, TILT_CLAMP]
    gy: SharedValue<number>;     // 归一化倾斜偏移 Y
    shake: SharedValue<number>;  // 甩动能量 [0, 1]，elastic 衰减
}

export function useGravityField(enabled: boolean = true): GravityField {
    const gx = useSharedValue(0);
    const gy = useSharedValue(0);
    const shake = useSharedValue(0);

    React.useEffect(() => {
        // Web 不接传感器（项目以 web 为次要平台）；未启用时也跳过。
        if (!enabled || Platform.OS === 'web') {
            return;
        }

        let mounted = true;
        let sub: { remove: () => void } | null = null;
        // 平滑状态与上一帧加速度，留在闭包里逐帧积分。
        let sx = 0, sy = 0;
        let prevMag = 1; // 静止时合加速度约 1g

        (async () => {
            const available = await Accelerometer.isAvailableAsync().catch(() => false);
            if (!mounted || !available) {
                return;
            }
            Accelerometer.setUpdateInterval(1000 / 60); // ~60Hz，跟渲染同频

            sub = Accelerometer.addListener(({ x, y, z }) => {
                // 1) 倾斜飘移：指数平滑 + 限幅
                const tx = Math.max(-TILT_CLAMP, Math.min(TILT_CLAMP, x * SIGN_X));
                const ty = Math.max(-TILT_CLAMP, Math.min(TILT_CLAMP, y * SIGN_Y));
                sx += (tx - sx) * SMOOTH;
                sy += (ty - sy) * SMOOTH;
                gx.value = sx;
                gy.value = sy;

                // 2) 甩动检测：合加速度的突变量（去掉静止 1g 后的 jerk）
                const mag = Math.sqrt(x * x + y * y + z * z);
                const jerk = Math.abs(mag - prevMag);
                prevMag = mag;
                if (jerk > SHAKE_THRESHOLD) {
                    // 能量按 jerk 强度拉起（封顶 1），再 elastic 衰减回 0 → 甩开后弹回。
                    const energy = Math.min(1, (jerk - SHAKE_THRESHOLD) * 0.8 + 0.5);
                    cancelAnimation(shake);
                    shake.value = energy;
                    shake.value = withTiming(0, {
                        duration: SHAKE_DECAY_MS,
                        easing: Easing.elastic(1.4),
                    });
                }
            });
        })();

        return () => {
            mounted = false;
            sub?.remove();
            cancelAnimation(shake);
            gx.value = 0;
            gy.value = 0;
            shake.value = 0;
        };
    }, [enabled, gx, gy, shake]);

    return { gx, gy, shake };
}
