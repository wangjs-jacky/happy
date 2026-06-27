import { Platform } from 'react-native';
import {
    useSharedValue,
    useAnimatedSensor,
    useAnimatedReaction,
    withTiming,
    cancelAnimation,
    Easing,
    SensorType,
    type SharedValue,
} from 'react-native-reanimated';

/**
 * 把手机重力感应转成可被 Skia/Reanimated worklet 直接消费的 shared value，
 * 驱动 ComposeHomeParticles 那团粒子「随重力摇摆」。
 *
 * ⚡ 关键：全程跑在**原生 UI 线程**，JS 线程零参与 —— 用 Reanimated 自带的
 * useAnimatedSensor 原生采样、useAnimatedReaction 做平滑/突变检测，传感器数据
 * 从不经过 JS 桥。因此**不与滚动手势抢 JS 线程**，不会拖慢列表滚动。
 * （早期版本用 expo-sensors 在 JS 线程 60Hz 回调，正是滚动卡顿的根源，已弃用。）
 *
 * 两条通道，两种手感：
 *  1) 倾斜飘移（gx / gy，**延迟级联数组**）：用 GRAVITY 传感器（已被系统低通成纯
 *     重力向量）。竖握时重力恒指向屏幕下方，会让粒子一直往一边堆——所以这里**追踪
 *     「中性握姿」基线**（neutralX/Y 是重力的慢速长平均），只对「偏离基线的倾斜量」
 *     响应：倾斜手机时整团朝倾斜方向晃出去，保持新角度则基线缓慢追上、慢慢回中。
 *
 *     ⭐ 为避免「整团像硬板一起平移」的死板感，输出不是单个偏移，而是一条 **延迟
 *     级联**：level0 = 领头羊（紧跟倾斜目标），level1 跟随 level0、level2 跟随
 *     level1……层层滞后。消费方按粒子离中心的远近挑 level —— 内圈领跑、外圈拖尾，
 *     于是整团像被一颗粒子拽着走、有错落的流动感，而非一块铁板。
 *  2) 摇晃甩动（shake）：用 ACCELEROMETER（含运动分量），监测合加速度突变（jerk），
 *     超阈值即把 shake 拉起，再 elastic 衰减回 0 —— 粒子被甩开后弹性回位。
 *
 * 容错：模拟器 / Web / 无传感器时，sensor.value 恒为 0，gx/gy/shake 恒为 0，
 * 消费方退回纯时钟运动，绝不报错。
 *
 * —— 调参集中在顶部常量。SIGN_X / SIGN_Y 是「倾斜方向 → 飘移方向」符号，真机上
 * 若方向反了改这两个即可（模拟器测不出方向）。
 */

const G = 9.81;               // 重力加速度，用于把传感器读数归一化到 ~[-1, 1]
const NEUTRAL_TRACK = 0.02;   // 中性基线追踪速度（越小越慢回中、倾斜停留越久）
const TILT_GAIN = 2.2;        // 偏离量增益（放大小角度倾斜，让效果更明显）
const TILT_CLAMP = 1.0;       // 归一化倾斜上限
const LEAD_SMOOTH = 0.22;     // 领头羊（level0）跟随倾斜目标的速度
const FOLLOW = 0.26;          // 每层跟随上一层的速度（越小拖尾越长、流动越明显）
const SIGN_X = 1;             // 倾斜 x → 飘移 x 方向符号（真机反了改 -1）
const SIGN_Y = -1;            // 倾斜 y → 飘移 y 方向符号
const SHAKE_THRESHOLD = 0.7;  // 触发甩动的 jerk 阈值（g；越小越灵敏）
const SHAKE_DECAY_MS = 1100;  // 甩动能量弹性衰减时长
const SENSOR_INTERVAL = 16;   // 原生采样间隔(ms)，~60Hz；UI 线程开销极低

// 延迟级联层数。消费方据此把每颗粒子映射到一个 level（内圈→0 领跑，外圈→末层拖尾）。
export const GRAVITY_LAG_LEVELS = 6;

export interface GravityField {
    gx: SharedValue<number[]>;   // 归一化倾斜偏移 X，长度 = GRAVITY_LAG_LEVELS，层层滞后
    gy: SharedValue<number[]>;   // 归一化倾斜偏移 Y
    shake: SharedValue<number>;  // 甩动能量 [0, 1]
}

function clamp(v: number, lo: number, hi: number) {
    'worklet';
    return v < lo ? lo : v > hi ? hi : v;
}

export function useGravityField(): GravityField {
    const gx = useSharedValue<number[]>(new Array(GRAVITY_LAG_LEVELS).fill(0));
    const gy = useSharedValue<number[]>(new Array(GRAVITY_LAG_LEVELS).fill(0));
    const shake = useSharedValue(0);

    // 中性基线 & 上一帧合加速度，作为 UI 线程上的持久积分状态。
    const neutralX = useSharedValue(0);
    const neutralY = useSharedValue(0);
    const calibrated = useSharedValue(0); // 0/1：是否已用首帧重力初始化基线
    const prevMag = useSharedValue(1);

    // 原生 UI 线程采样。adjustToInterfaceOrientation 默认 true，轴向已对齐界面方向。
    // Web 上 useAnimatedSensor 不可用 → 传 interval，未注册的平台读数恒为 0。
    const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: SENSOR_INTERVAL });
    const accel = useAnimatedSensor(SensorType.ACCELEROMETER, { interval: SENSOR_INTERVAL });

    const isWeb = Platform.OS === 'web';

    // 通道 1：倾斜飘移（追踪中性基线 → 延迟级联，领头羊带拖尾）
    useAnimatedReaction(
        () => gravity.sensor.value,
        (g) => {
            'worklet';
            if (isWeb) return;
            const nx = g.x / G;
            const ny = g.y / G;
            // 首帧把基线对齐当前握姿，避免启动瞬间一大跳。
            if (calibrated.value === 0) {
                neutralX.value = nx;
                neutralY.value = ny;
                calibrated.value = 1;
                return;
            }
            // 基线慢速追踪当前重力 → 保持某角度时缓慢回中。
            neutralX.value += (nx - neutralX.value) * NEUTRAL_TRACK;
            neutralY.value += (ny - neutralY.value) * NEUTRAL_TRACK;
            // 偏离量 → 增益 → 限幅 → 倾斜目标。
            const tx = clamp((nx - neutralX.value) * TILT_GAIN * SIGN_X, -TILT_CLAMP, TILT_CLAMP);
            const ty = clamp((ny - neutralY.value) * TILT_GAIN * SIGN_Y, -TILT_CLAMP, TILT_CLAMP);
            // 延迟级联：level0 追目标，后面每层追前一层 → 层层滞后形成拖尾。
            const cx = gx.value.slice();
            const cy = gy.value.slice();
            cx[0] += (tx - cx[0]) * LEAD_SMOOTH;
            cy[0] += (ty - cy[0]) * LEAD_SMOOTH;
            for (let k = 1; k < GRAVITY_LAG_LEVELS; k++) {
                cx[k] += (cx[k - 1] - cx[k]) * FOLLOW;
                cy[k] += (cy[k - 1] - cy[k]) * FOLLOW;
            }
            gx.value = cx;
            gy.value = cy;
        },
    );

    // 通道 2：摇晃甩动（合加速度突变检测）
    useAnimatedReaction(
        () => accel.sensor.value,
        (a) => {
            'worklet';
            if (isWeb) return;
            const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) / G;
            const jerk = Math.abs(mag - prevMag.value);
            prevMag.value = mag;
            if (jerk > SHAKE_THRESHOLD) {
                const energy = Math.min(1, (jerk - SHAKE_THRESHOLD) * 0.8 + 0.5);
                cancelAnimation(shake);
                shake.value = energy;
                shake.value = withTiming(0, {
                    duration: SHAKE_DECAY_MS,
                    easing: Easing.elastic(1.4),
                });
            }
        },
    );

    return { gx, gy, shake };
}
