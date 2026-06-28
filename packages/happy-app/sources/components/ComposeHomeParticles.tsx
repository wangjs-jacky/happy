import * as React from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, Points, BlurMask, useClock, type SkPoint } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

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
 */

interface ParticleCfg {
    r: number;      // 公转基础半径
    a0: number;     // 初始角度 / 摆动相位
    spin: number;   // 角速度（可正可负 → 顺逆时针混合）
    wob: number;    // 半径摆动幅度
    ws: number;     // 半径摆动频率
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
        cfgs.push({
            r: 20 + rnd() * 130,
            a0: rnd() * Math.PI * 2,
            spin: (rnd() - 0.5) * 0.5,
            wob: 6 + rnd() * 16,
            ws: 0.4 + rnd() * 0.9,
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
    // Paws 暖色粒子：green 槽 = 焦糖（主），blue 槽 = 格纹蓝（点缀）
    dark: { green: '#E0975A', blue: '#7FB6D9', glow: 6, coreGlow: 14, opacity: 0.9 },
    light: { green: '#C77D3E', blue: '#5E97C0', glow: 0, coreGlow: 0, opacity: 0.82 },
};

interface Props {
    mode: ParticleMode;
}

export const ComposeHomeParticles = React.memo(({ mode }: Props) => {
    const [size, setSize] = React.useState({ w: 0, h: 0 });
    const clock = useClock();
    const pal = PALETTE[mode];

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
        const ax = w * 0.5 + Math.cos(t * 0.35) * w * 0.20;
        const ay = h * 0.46 + Math.sin(t * 0.5) * h * 0.18;
        const out: SkPoint[] = [];
        for (let i = 0; i < greenCfg.length; i++) {
            const p = greenCfg[i];
            const ang = p.a0 + t * p.spin;
            const rad = p.r + p.wob * Math.sin(t * p.ws + p.a0);
            out.push({ x: ax + Math.cos(ang) * rad, y: ay + Math.sin(ang) * rad });
        }
        return out;
    }, [greenCfg, size.w, size.h]);

    const bluePts = useDerivedValue<SkPoint[]>(() => {
        const { w, h } = size;
        if (w === 0) return [];
        const t = clock.value * 0.0017;
        const ax = w * 0.5 + Math.cos(t * 0.35) * w * 0.20;
        const ay = h * 0.46 + Math.sin(t * 0.5) * h * 0.18;
        const out: SkPoint[] = [];
        for (let i = 0; i < blueCfg.length; i++) {
            const p = blueCfg[i];
            const ang = p.a0 + t * p.spin;
            const rad = p.r + p.wob * Math.sin(t * p.ws + p.a0);
            out.push({ x: ax + Math.cos(ang) * rad, y: ay + Math.sin(ang) * rad });
        }
        return out;
    }, [blueCfg, size.w, size.h]);

    // 中心引力点本身渲染成一颗更大更亮的粒子。
    const corePts = useDerivedValue<SkPoint[]>(() => {
        const { w, h } = size;
        if (w === 0) return [];
        const t = clock.value * 0.0017;
        const ax = w * 0.5 + Math.cos(t * 0.35) * w * 0.20;
        const ay = h * 0.46 + Math.sin(t * 0.5) * h * 0.18;
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
