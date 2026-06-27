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
 * 粒子绕一个缓慢做利萨茹运动的「引力点」公转：每颗有自己的半径 / 角速度 /
 * 摆动相位，于是整团看起来像一群跟着引力点漂移的萤火。位置是 (时间) 的纯函数，
 * 无逐帧状态积分，因此可中断、可重放、性能稳定。
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

interface ParticleCfg {
    r: number;      // 公转基础半径
    a0: number;     // 初始角度 / 摆动相位
    spin: number;   // 角速度（可正可负 → 顺逆时针混合）
    wob: number;    // 半径摆动幅度
    ws: number;     // 半径摆动频率
    lag: number;    // 重力级联层级（0=内圈领跑，末层=外圈拖尾），按半径映射
}

// 用确定性伪随机生成粒子参数，避免 Math.random（保证每次渲染同一团形态）。
function buildConfigs(count: number, seed: number): ParticleCfg[] {
    const cfgs: ParticleCfg[] = [];
    let s = seed;
    const rnd = () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
    for (let i = 0; i < count; i++) {
        const r = 20 + rnd() * 130;
        // 半径 [20,150] → 级联层级 [0, LAG-1]：内圈领跑、外圈拖尾。
        const lag = Math.min(GRAVITY_LAG_LEVELS - 1, Math.floor(((r - 20) / 130) * GRAVITY_LAG_LEVELS));
        cfgs.push({
            r,
            a0: rnd() * Math.PI * 2,
            spin: (rnd() - 0.5) * 0.5,
            wob: 6 + rnd() * 16,
            ws: 0.4 + rnd() * 0.9,
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
    coreGlow: number;  // 中心引力点辉光半径
    opacity: number;
}> = {
    dark: { green: '#00ff88', blue: '#00d4ff', glow: 6, coreGlow: 14, opacity: 0.9 },
    light: { green: '#00a352', blue: '#0090be', glow: 0, coreGlow: 0, opacity: 0.78 },
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
    const greenCfg = React.useMemo(() => buildConfigs(46, 1337), []);
    const blueCfg = React.useMemo(() => buildConfigs(24, 8081), []);

    const onLayout = React.useCallback((e: { nativeEvent: { layout: { width: number; height: number } } }) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
    }, []);

    // 引力点：缓慢的利萨茹漂移（时间的纯函数）。直接内联进每个 worklet，避免跨
    // worklet 调用闭包函数的运行时风险。
    const greenPts = useDerivedValue<SkPoint[]>(() => {
        const { w, h } = size;
        if (w === 0) return [];
        const t = clock.value * 0.0017;
        const sh = shake.value;
        const ax0 = w * 0.5 + Math.cos(t * 0.35) * w * 0.20;
        const ay0 = h * 0.46 + Math.sin(t * 0.5) * h * 0.18;
        const cx = gx.value;
        const cy = gy.value;
        const out: SkPoint[] = [];
        for (let i = 0; i < greenCfg.length; i++) {
            const p = greenCfg[i];
            // 按粒子层级取延迟级联偏移：内圈领跑、外圈拖尾 → 整团有流动感。
            const ax = ax0 + cx[p.lag] * w * GRAV_AMP;
            const ay = ay0 + cy[p.lag] * h * GRAV_AMP;
            const ang = p.a0 + t * p.spin;
            const rad = (p.r + p.wob * Math.sin(t * p.ws + p.a0)) * (1 + sh * SHAKE_RAD);
            const jx = sh * SHAKE_JIT * Math.sin(t * 6.1 + p.a0 * 5.0);
            const jy = sh * SHAKE_JIT * Math.cos(t * 5.7 + p.a0 * 4.0);
            out.push({ x: ax + Math.cos(ang) * rad + jx, y: ay + Math.sin(ang) * rad + jy });
        }
        return out;
    }, [greenCfg, size.w, size.h]);

    const bluePts = useDerivedValue<SkPoint[]>(() => {
        const { w, h } = size;
        if (w === 0) return [];
        const t = clock.value * 0.0017;
        const sh = shake.value;
        const ax0 = w * 0.5 + Math.cos(t * 0.35) * w * 0.20;
        const ay0 = h * 0.46 + Math.sin(t * 0.5) * h * 0.18;
        const cx = gx.value;
        const cy = gy.value;
        const out: SkPoint[] = [];
        for (let i = 0; i < blueCfg.length; i++) {
            const p = blueCfg[i];
            const ax = ax0 + cx[p.lag] * w * GRAV_AMP;
            const ay = ay0 + cy[p.lag] * h * GRAV_AMP;
            const ang = p.a0 + t * p.spin;
            const rad = (p.r + p.wob * Math.sin(t * p.ws + p.a0)) * (1 + sh * SHAKE_RAD);
            const jx = sh * SHAKE_JIT * Math.sin(t * 6.1 + p.a0 * 5.0);
            const jy = sh * SHAKE_JIT * Math.cos(t * 5.7 + p.a0 * 4.0);
            out.push({ x: ax + Math.cos(ang) * rad + jx, y: ay + Math.sin(ang) * rad + jy });
        }
        return out;
    }, [blueCfg, size.w, size.h]);

    // 中心引力点本身渲染成一颗更大更亮的粒子。
    const corePts = useDerivedValue<SkPoint[]>(() => {
        const { w, h } = size;
        if (w === 0) return [];
        const t = clock.value * 0.0017;
        // 中心引力点是「领头羊」，用 level0（最跟手那层）。
        const ax = w * 0.5 + Math.cos(t * 0.35) * w * 0.20 + gx.value[0] * w * GRAV_AMP;
        const ay = h * 0.46 + Math.sin(t * 0.5) * h * 0.18 + gy.value[0] * h * GRAV_AMP;
        return [{ x: ax, y: ay }];
    }, [size.w, size.h]);

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
            <Canvas style={styles.canvas}>
                <Points points={greenPts} mode="points" color={pal.green} style="stroke" strokeWidth={3} strokeCap="round" opacity={pal.opacity}>
                    {pal.glow > 0 ? <BlurMask blur={pal.glow} style="solid" /> : null}
                </Points>
                <Points points={bluePts} mode="points" color={pal.blue} style="stroke" strokeWidth={2.6} strokeCap="round" opacity={pal.opacity}>
                    {pal.glow > 0 ? <BlurMask blur={pal.glow} style="solid" /> : null}
                </Points>
                <Points points={corePts} mode="points" color={pal.green} style="stroke" strokeWidth={7} strokeCap="round">
                    {pal.coreGlow > 0 ? <BlurMask blur={pal.coreGlow} style="solid" /> : null}
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
