import * as React from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, Points, BlurMask, useClock, type SkPoint } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { useGravityField, GRAVITY_LAG_LEVELS } from '@/hooks/useGravityField';

/**
 * 首页空白区的「蜂群」氛围背景。
 *
 * 设计动机：ComposeHome 顶部问候 + 底部输入框之间是一大片空白，这里用一团
 * 缓慢游走的霓虹粒子把它填活。刻意做成**纯时钟驱动的确定性轨道运动**，不消费
 * 任何触摸事件（外层 View pointerEvents="none"），所以绝不会干扰输入框点击、
 * 抽屉侧滑等手势——它只是会呼吸的背景。
 *
 * 运动模型：**每颗粒子各自独立游走**，没有共享的公转中心（早期版本让所有粒子绕
 * 同一个引力点公转，视觉上会有个被牵引的轴心，已废弃）。每颗有一个散布在中心区域
 * 的「家位置」(home) + 一套**专属的游走轨迹**：x/y 各由两路不同频率/相位的正弦叠加，
 * 频率、相位、振幅都按粒子独立随机，于是 150 颗各漂各的，整团像真正的蜂群而非卫星。
 * 位置是 (时间) 的纯函数，无逐帧状态积分，因此可中断、可重放、性能稳定。
 *
 * 配色随主题切换：深色用霓虹绿/蓝 + Skia BlurMask 辉光；浅色压暗成墨绿/钢蓝、
 * 去辉光（白底辉光发糊），由 ComposeHome 传入的 mode 决定。
 *
 * 重力感应：通过 useGravityField 读手机加速度计，叠加两种运动到引力点上 ——
 * 倾斜手机 → 整团朝重力方向飘移（GRAV_AMP）；摇一摇 → 粒子被甩开后弹性回位
 * （SHAKE_RAD / SHAKE_JIT）。真机生效；模拟器/Web 无传感器时三个量恒为 0，自动
 * 退回纯时钟运动，不影响原有表现。
 */

// —— 重力感应叠加幅度（明显但不浮夸）——
const GRAV_AMP = 0.30;   // 倾斜飘移：引力点偏移 = 归一化倾斜 × 屏幕尺寸 × 此系数
const SHAKE_RAD = 0.65;  // 摇晃时公转半径的放大比例（粒子被甩向外圈）
const SHAKE_JIT = 42;    // 摇晃时叠加的混沌抖动幅度（px）

// —— 蜂群规模与铺开范围 ——
const GREEN_COUNT = 96;       // 绿色粒子数
const BLUE_COUNT = 54;        // 蓝色粒子数（点缀）
const HOME_R_MIN = 18;        // 家位置离中心的下限
const HOME_R_SPAN = 220;      // 家位置散布跨度 → 半径范围 [18, 238]，越大整团铺得越开
const WANDER_MIN = 12;        // 每颗独立游走振幅下限(px)
const WANDER_SPAN = 30;       // 游走振幅跨度 → [12, 42]px，各漂各的

interface ParticleCfg {
    hr: number;     // 家位置离中心的半径
    ha: number;     // 家位置的方位角
    wamp: number;   // 专属游走振幅
    fx1: number; px1: number; fx2: number; px2: number;  // x 轴两路独立正弦（频率/相位）
    fy1: number; py1: number; fy2: number; py2: number;  // y 轴两路独立正弦
    lag: number;    // 重力级联层级（0=内圈领跑，末层=外圈拖尾），按家半径映射
}

// 用确定性伪随机生成粒子参数，避免 Math.random（保证每次渲染同一团形态）。
function buildConfigs(count: number, seed: number): ParticleCfg[] {
    const cfgs: ParticleCfg[] = [];
    let s = seed;
    const rnd = () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
    const TAU = Math.PI * 2;
    for (let i = 0; i < count; i++) {
        const hr = HOME_R_MIN + rnd() * HOME_R_SPAN;
        // 家半径 → 级联层级 [0, LAG-1]：内圈领跑、外圈拖尾（仅用于重力响应的拖尾感）。
        const lag = Math.min(GRAVITY_LAG_LEVELS - 1, Math.floor(((hr - HOME_R_MIN) / HOME_R_SPAN) * GRAVITY_LAG_LEVELS));
        cfgs.push({
            hr,
            ha: rnd() * TAU,
            wamp: WANDER_MIN + rnd() * WANDER_SPAN,
            // 两路频率错开（一慢一快）+ 随机相位 → 每颗的游走路径都独一无二、不同步。
            fx1: 0.18 + rnd() * 0.6, px1: rnd() * TAU,
            fx2: 0.5 + rnd() * 0.9, px2: rnd() * TAU,
            fy1: 0.18 + rnd() * 0.6, py1: rnd() * TAU,
            fy2: 0.5 + rnd() * 0.9, py2: rnd() * TAU,
            lag,
        });
    }
    return cfgs;
}

type ParticleMode = 'dark' | 'light';

const PALETTE: Record<ParticleMode, {
    green: string;
    blue: string;
    glow: number;      // 普通粒子辉光半径（0 = 关闭）
    opacity: number;
}> = {
    dark: { green: '#00ff88', blue: '#00d4ff', glow: 6, opacity: 0.9 },
    light: { green: '#00a352', blue: '#0090be', glow: 0, opacity: 0.78 },
};

interface Props {
    mode: ParticleMode;
}

export const ComposeHomeParticles = React.memo(({ mode }: Props) => {
    const [size, setSize] = React.useState({ w: 0, h: 0 });
    const clock = useClock();
    const pal = PALETTE[mode];
    // 重力感应：gx/gy 倾斜飘移（归一化），shake 摇晃能量 [0,1]。真机生效，否则恒 0。
    const { gx, gy, shake } = useGravityField();

    // 两组粒子（绿 / 蓝），各自一套确定性参数。蓝色少一些，作点缀。
    const greenCfg = React.useMemo(() => buildConfigs(GREEN_COUNT, 1337), []);
    const blueCfg = React.useMemo(() => buildConfigs(BLUE_COUNT, 8081), []);

    const onLayout = React.useCallback((e: { nativeEvent: { layout: { width: number; height: number } } }) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
    }, []);

    // 每颗粒子 = 家位置 + 专属独立游走 + 重力偏移。无共享公转中心。时间的纯函数，
    // 内联进每个 worklet（避免跨 worklet 调用闭包函数的运行时风险）。
    const greenPts = useDerivedValue<SkPoint[]>(() => {
        const { w, h } = size;
        if (w === 0) return [];
        const t = clock.value * 0.0017;
        const sh = shake.value;
        const cx0 = w * 0.5;
        const cy0 = h * 0.46;
        const cx = gx.value;
        const cy = gy.value;
        const out: SkPoint[] = [];
        for (let i = 0; i < greenCfg.length; i++) {
            const p = greenCfg[i];
            // 家位置（shake 时整团略炸开）
            const hr = p.hr * (1 + sh * 0.3);
            const homeX = cx0 + Math.cos(p.ha) * hr;
            const homeY = cy0 + Math.sin(p.ha) * hr;
            // 专属独立游走：两路异频正弦叠加，每颗路径不同；shake 时振幅放大
            const wm = p.wamp * (1 + sh * SHAKE_RAD);
            const wx = wm * (Math.sin(t * p.fx1 + p.px1) + 0.6 * Math.sin(t * p.fx2 + p.px2));
            const wy = wm * (Math.cos(t * p.fy1 + p.py1) + 0.6 * Math.cos(t * p.fy2 + p.py2));
            // 重力偏移（按层级取延迟级联：内圈领跑、外圈拖尾）+ 摇晃抖动
            const ox = cx[p.lag] * w * GRAV_AMP + sh * SHAKE_JIT * Math.sin(t * 6.1 + p.ha * 5.0);
            const oy = cy[p.lag] * h * GRAV_AMP + sh * SHAKE_JIT * Math.cos(t * 5.7 + p.ha * 4.0);
            out.push({ x: homeX + wx + ox, y: homeY + wy + oy });
        }
        return out;
    }, [greenCfg, size.w, size.h]);

    const bluePts = useDerivedValue<SkPoint[]>(() => {
        const { w, h } = size;
        if (w === 0) return [];
        const t = clock.value * 0.0017;
        const sh = shake.value;
        const cx0 = w * 0.5;
        const cy0 = h * 0.46;
        const cx = gx.value;
        const cy = gy.value;
        const out: SkPoint[] = [];
        for (let i = 0; i < blueCfg.length; i++) {
            const p = blueCfg[i];
            const hr = p.hr * (1 + sh * 0.3);
            const homeX = cx0 + Math.cos(p.ha) * hr;
            const homeY = cy0 + Math.sin(p.ha) * hr;
            const wm = p.wamp * (1 + sh * SHAKE_RAD);
            const wx = wm * (Math.sin(t * p.fx1 + p.px1) + 0.6 * Math.sin(t * p.fx2 + p.px2));
            const wy = wm * (Math.cos(t * p.fy1 + p.py1) + 0.6 * Math.cos(t * p.fy2 + p.py2));
            const ox = cx[p.lag] * w * GRAV_AMP + sh * SHAKE_JIT * Math.sin(t * 6.1 + p.ha * 5.0);
            const oy = cy[p.lag] * h * GRAV_AMP + sh * SHAKE_JIT * Math.cos(t * 5.7 + p.ha * 4.0);
            out.push({ x: homeX + wx + ox, y: homeY + wy + oy });
        }
        return out;
    }, [blueCfg, size.w, size.h]);

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
            <Canvas style={styles.canvas}>
                <Points points={greenPts} mode="points" color={pal.green} style="stroke" strokeWidth={3} strokeCap="round" opacity={pal.opacity}>
                    {pal.glow > 0 ? <BlurMask blur={pal.glow} style="solid" /> : null}
                </Points>
                <Points points={bluePts} mode="points" color={pal.blue} style="stroke" strokeWidth={2.6} strokeCap="round" opacity={pal.opacity}>
                    {pal.glow > 0 ? <BlurMask blur={pal.glow} style="solid" /> : null}
                </Points>
            </Canvas>
        </View>
    );
});

ComposeHomeParticles.displayName = 'ComposeHomeParticles';

const styles = StyleSheet.create({
    canvas: {
        flex: 1,
    },
});
