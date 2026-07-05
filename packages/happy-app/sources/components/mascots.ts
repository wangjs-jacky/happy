import type { ImageSourcePropType } from 'react-native';
import { t } from '@/text';
import type { ThemePackId } from '@/themePacks';

//
// 吉祥物注册表
// ------------------------------------------------------------------
// 7 套自有土拨鼠人设（透明底 3D 皮克斯风），用于空状态引导页与设置页头部装饰。
// 每只吉祥物绑定一个主题配色包（mascot ↔ themePack 一一对应），选吉祥物即联动切主题色。
// require() 路径必须是静态字面量（Metro 打包要求），所以这里用固定映射表。
//

export type MascotId = 'hoodie' | 'explorer' | 'astro' | 'barista' | 'ninja' | 'scientist' | 'florist';

export const MASCOT_IDS: MascotId[] = ['hoodie', 'explorer', 'astro', 'barista', 'ninja', 'scientist', 'florist'];

export const DEFAULT_MASCOT: MascotId = 'hoodie';

const MASCOT_IMAGES: Record<MascotId, ImageSourcePropType> = {
    hoodie: require('@/assets/images/mascots/hoodie.png'),
    explorer: require('@/assets/images/mascots/explorer.png'),
    astro: require('@/assets/images/mascots/astro.png'),
    barista: require('@/assets/images/mascots/barista.png'),
    ninja: require('@/assets/images/mascots/ninja.png'),
    scientist: require('@/assets/images/mascots/scientist.png'),
    florist: require('@/assets/images/mascots/florist.png'),
};

//
// 吉祥物 ↔ 主题配色包 映射
// ------------------------------------------------------------------
// 每只土拨鼠的服装/道具配色对应一个主题包：选吉祥物时自动套用它的主题色。
//
const MASCOT_THEME: Record<MascotId, ThemePackId> = {
    hoodie: 'terminal',    // 极客 → 霓虹绿
    barista: 'caramel',    // 咖啡师 → 焦糖
    astro: 'gingham',      // 宇航员 → 天蓝
    explorer: 'acorn',     // 探险家 → 橡果橙
    scientist: 'sage',     // 科学家 → 鼠尾草绿
    ninja: 'grape',        // 忍者 → 葡萄紫
    florist: 'sakura',     // 花艺师 → 樱花粉
};

/** 把任意字符串安全解析为已知 MascotId，未知值回退到默认 */
export function resolveMascotId(id: string | undefined | null): MascotId {
    return (id && (MASCOT_IDS as string[]).includes(id)) ? (id as MascotId) : DEFAULT_MASCOT;
}

/** 取吉祥物图片资源（容错：未知 id 返回默认形象） */
export function getMascotImage(id: string | undefined | null): ImageSourcePropType {
    return MASCOT_IMAGES[resolveMascotId(id)];
}

/** 取吉祥物绑定的主题包 id（容错：未知 id 回退到默认形象的主题） */
export function getMascotTheme(id: string | undefined | null): ThemePackId {
    return MASCOT_THEME[resolveMascotId(id)];
}

/** 取吉祥物展示名（已 i18n，用字面量 key 保证类型安全） */
export function getMascotName(id: MascotId): string {
    switch (id) {
        case 'hoodie': return t('settingsAppearance.mascotOptions.hoodie');
        case 'explorer': return t('settingsAppearance.mascotOptions.explorer');
        case 'astro': return t('settingsAppearance.mascotOptions.astro');
        case 'barista': return t('settingsAppearance.mascotOptions.barista');
        case 'ninja': return t('settingsAppearance.mascotOptions.ninja');
        case 'scientist': return t('settingsAppearance.mascotOptions.scientist');
        case 'florist': return t('settingsAppearance.mascotOptions.florist');
    }
}
