import type { TextStyle } from 'react-native';
import { Typography } from '@/constants/Typography';

export type MarkdownTypographyMode = 'default' | 'chatMono';

type MarkdownTypographyStyles = {
    body?: TextStyle;
    inlineCode?: TextStyle;
    italic?: TextStyle;
    strong?: TextStyle;
};

/**
 * One type family for every textual surface rendered inside a chat message.
 * Visual hierarchy is expressed through the bundled faces, size, color, and
 * surrounding chrome instead of switching between sans-serif and monospace.
 */
const CHAT_MONO_TYPOGRAPHY = {
    body: Typography.mono(),
    inlineCode: Typography.mono(),
    italic: {
        ...Typography.mono('italic'),
        // The italic asset is registered under its own family name.
        fontStyle: 'normal' as const,
    },
    strong: {
        ...Typography.mono('semiBold'),
        // The face already carries the weight. Reset inherited 600/700/900
        // values so native and web do not synthesize a second bold weight.
        fontWeight: 'normal' as const,
    },
} as const;

const DEFAULT_TYPOGRAPHY: MarkdownTypographyStyles = {};

/**
 * Returns late style overrides for an explicitly selected Markdown surface.
 * The default mode intentionally returns no overrides so existing changelog,
 * artifact, settings, and file-view typography stays untouched.
 */
export function getMarkdownTypography(mode: MarkdownTypographyMode): MarkdownTypographyStyles {
    return mode === 'chatMono' ? CHAT_MONO_TYPOGRAPHY : DEFAULT_TYPOGRAPHY;
}
