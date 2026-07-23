import * as React from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, Points, BlurMask, useClock, type SkPoint } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';
import { useGravityField, GRAVITY_LAG_LEVELS } from '@/hooks/useGravityField';

/**
 * 首页空白区的「蜂群」氛围背景。
 *
 * 设计动机：ComposeHome 顶部问候 + 底部输入框之间是一大片空白，这里用一团
 * 缓慢游走的霓虹粒子把它填活。不消费任何触摸事件（外层 View pointerEvents="none"），
 * 绝不会干扰输入框点击、抽屉侧滑等手势——它只是会呼吸的背景。
 *
 * 运动模型：**curl 噪声流场漂移**。所有粒子共享同一个随时间缓慢演化的噪声向量场，
 * 每颗按自己的家位置去采样这个场，得到一个漂移偏移。于是相邻粒子顺着同一股「暗流」
 * 一起走，路径非周期、有机，像尘埃在气流里——而不是各自按固定正弦节奏原地抖动
 * （早期版本的毛病）。用 curl（标量势的旋度）保证流场无源无汇，粒子不会结块。
 * 位置仍是 (时间) 的纯函数（噪声以时间为第三维），无逐帧状态积分，可中断、可重放。
 *
 * 配色随主题切换：深色用霓虹绿/蓝 + Skia BlurMask 辉光；浅色压暗成墨绿/钢蓝、
 * 去辉光（白底辉光发糊），由 ComposeHome 传入的 mode 决定。
 *
 * 重力感应：通过 useGravityField 读手机加速度计，叠加到漂移上 —— 倾斜手机 → 整团
 * 朝重力方向飘移（GRAV_AMP，按粒子层级走延迟级联拖尾）；摇一摇 → 流场振幅放大 +
 * 整团略炸开 + 混沌抖动。真机生效；模拟器/Web 无传感器时退回纯流场，不影响表现。
 */

// —— 蜂群规模与铺开范围 ——
const GREEN_COUNT = 96;       // 绿色粒子数
const BLUE_COUNT = 54;        // 蓝色粒子数（点缀）
const HOME_R_MIN = 18;        // 家位置离中心的下限
const HOME_R_SPAN = 220;      // 家位置散布跨度 → 半径 [18, 238]，越大整团铺得越开

// —— curl 噪声流场参数 ——
const NOISE_SCALE = 0.0065;   // 空间频率：越大流场格子越密（相邻粒子越快出现差异）
const FLOW_TIME = 0.22;       // 流场随时间演化速度：越大流动越快
const FLOW_AMP = 340;         // 漂移幅度（乘在 curl 梯度上，px 量级由噪声梯度决定）
const NOISE_EPS = 0.8;        // 求梯度的有限差分步长（噪声空间单位）

// —— 重力感应叠加幅度 ——
const GRAV_AMP = 0.30;        // 倾斜飘移：偏移 = 归一化倾斜 × 屏幕尺寸 × 此系数
const SHAKE_RAD = 0.8;        // 摇晃时流场振幅 + 炸开比例
const SHAKE_JIT = 42;         // 摇晃时叠加的混沌抖动幅度（px）

interface ParticleCfg {
    hr: number;     // 家位置离中心的半径
    ha: number;     // 家位置方位角
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
        const lag = Math.min(GRAVITY_LAG_LEVELS - 1, Math.floor(((hr - HOME_R_MIN) / HOME_R_SPAN) * GRAVITY_LAG_LEVELS));
        cfgs.push({ hr, ha: rnd() * TAU, lag });
    }
    return cfgs;
}

// —— worklet 工具：3D 值噪声（哈希角点 + 三线性平滑插值），用于 curl 流场 ——
// 第三维喂时间 → 流场随时间平滑演化、非周期。

function hash3(ix: number, iy: number, iz: number) {
    'worklet';
    const n = ix * 127.1 + iy * 311.7 + iz * 74.7;
    const s = Math.sin(n) * 43758.5453123;
    return s - Math.floor(s); // [0, 1)
}

function vnoise(x: number, y: number, z: number) {
    'worklet';
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    const c000 = hash3(ix, iy, iz);
    const c100 = hash3(ix + 1, iy, iz);
    const c010 = hash3(ix, iy + 1, iz);
    const c110 = hash3(ix + 1, iy + 1, iz);
    const c001 = hash3(ix, iy, iz + 1);
    const c101 = hash3(ix + 1, iy, iz + 1);
    const c011 = hash3(ix, iy + 1, iz + 1);
    const c111 = hash3(ix + 1, iy + 1, iz + 1);
    const x00 = c000 + (c100 - c000) * ux;
    const x10 = c010 + (c110 - c010) * ux;
    const x01 = c001 + (c101 - c001) * ux;
    const x11 = c011 + (c111 - c011) * ux;
    const y0 = x00 + (x10 - x00) * uy;
    const y1 = x01 + (x11 - x01) * uy;
    return y0 + (y1 - y0) * uz; // [0, 1)
}

type ParticleMode = 'dark' | 'light';

const PALETTE: Record<ParticleMode, {
    green: string;
    blue: string;
    glow: number;      // 普通粒子辉光半径（0 = 关闭）
    opacity: number;
}> = {
    // Paws 暖色粒子：green 槽 = 焦糖（主），blue 槽 = 格纹蓝（点缀）。颜色实际由主题包覆盖。
    dark: { green: '#E0975A', blue: '#7FB6D9', glow: 6, opacity: 0.9 },
    light: { green: '#C77D3E', blue: '#5E97C0', glow: 0, opacity: 0.82 },
};

interface Props {
    mode: ParticleMode;
}

export const ComposeHomeParticles = React.memo(({ mode }: Props) => {
    const [size, setSize] = React.useState({ w: 0, h: 0 });
    const clock = useClock();
    const { theme } = useUnistyles();
    // 颜色跟随当前主题包（particle.primary/accent）；glow/opacity 仍按明暗态走
    const pal = { ...PALETTE[mode], green: theme.colors.particle.primary, blue: theme.colors.particle.accent };
    // 重力感应：gx/gy 倾斜飘移（延迟级联数组），shake 摇晃能量 [0,1]。真机生效，否则恒 0。
    const { gx, gy, shake } = useGravityField();

    const greenCfg = React.useMemo(() => buildConfigs(GREEN_COUNT, 1337), []);
    const blueCfg = React.useMemo(() => buildConfigs(BLUE_COUNT, 8081), []);

    const onLayout = React.useCallback((e: { nativeEvent: { layout: { width: number; height: number } } }) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
    }, []);

    // 每颗粒子 = 家位置 + curl 流场漂移 + 重力偏移。流场与梯度直接内联进 worklet。
    const greenPts = useDerivedValue<SkPoint[]>(() => {
        const { w, h } = size;
        if (w === 0) return [];
        const t = clock.value * 0.0017;
        const tz = t * FLOW_TIME;
        const sh = shake.value;
        const cx0 = w * 0.5;
        const cy0 = h * 0.46;
        const cx = gx.value;
        const cy = gy.value;
        const amp = FLOW_AMP * (1 + sh * SHAKE_RAD);
        const out: SkPoint[] = [];
        for (let i = 0; i < greenCfg.length; i++) {
            const p = greenCfg[i];
            const hr = p.hr * (1 + sh * 0.3);
            const homeX = cx0 + Math.cos(p.ha) * hr;
            const homeY = cy0 + Math.sin(p.ha) * hr;
            // curl 流场：在家位置采样标量势 ψ 的梯度，旋度 (∂ψ/∂y, -∂ψ/∂x) 作漂移。
            const nx = homeX * NOISE_SCALE;
            const ny = homeY * NOISE_SCALE;
            const p0 = vnoise(nx, ny, tz);
            const pdx = vnoise(nx + NOISE_EPS, ny, tz);
            const pdy = vnoise(nx, ny + NOISE_EPS, tz);
            const flowX = (pdy - p0) * amp;
            const flowY = -(pdx - p0) * amp;
            // 重力偏移（按层级取延迟级联）+ 摇晃抖动
            const ox = cx[p.lag] * w * GRAV_AMP + sh * SHAKE_JIT * Math.sin(t * 6.1 + p.ha * 5.0);
            const oy = cy[p.lag] * h * GRAV_AMP + sh * SHAKE_JIT * Math.cos(t * 5.7 + p.ha * 4.0);
            out.push({ x: homeX + flowX + ox, y: homeY + flowY + oy });
        }
        return out;
    }, [greenCfg, size.w, size.h]);

    const bluePts = useDerivedValue<SkPoint[]>(() => {
        const { w, h } = size;
        if (w === 0) return [];
        const t = clock.value * 0.0017;
        const tz = t * FLOW_TIME;
        const sh = shake.value;
        const cx0 = w * 0.5;
        const cy0 = h * 0.46;
        const cx = gx.value;
        const cy = gy.value;
        const amp = FLOW_AMP * (1 + sh * SHAKE_RAD);
        const out: SkPoint[] = [];
        for (let i = 0; i < blueCfg.length; i++) {
            const p = blueCfg[i];
            const hr = p.hr * (1 + sh * 0.3);
            const homeX = cx0 + Math.cos(p.ha) * hr;
            const homeY = cy0 + Math.sin(p.ha) * hr;
            // 蓝色用错开的噪声坐标，避免和绿色完全同向（+偏移解相关）。
            const nx = homeX * NOISE_SCALE + 31.7;
            const ny = homeY * NOISE_SCALE + 17.3;
            const p0 = vnoise(nx, ny, tz);
            const pdx = vnoise(nx + NOISE_EPS, ny, tz);
            const pdy = vnoise(nx, ny + NOISE_EPS, tz);
            const flowX = (pdy - p0) * amp;
            const flowY = -(pdx - p0) * amp;
            const ox = cx[p.lag] * w * GRAV_AMP + sh * SHAKE_JIT * Math.sin(t * 6.1 + p.ha * 5.0);
            const oy = cy[p.lag] * h * GRAV_AMP + sh * SHAKE_JIT * Math.cos(t * 5.7 + p.ha * 4.0);
            out.push({ x: homeX + flowX + ox, y: homeY + flowY + oy });
        }
        return out;
    }, [blueCfg, size.w, size.h]);

    return (
        <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]} onLayout={onLayout}>
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
