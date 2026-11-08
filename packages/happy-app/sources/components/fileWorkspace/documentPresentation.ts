import type { ViewStyle } from 'react-native';

/** The same reading geometry for working Markdown and immutable history. */
export const documentScrollStyle: ViewStyle = { paddingHorizontal: 28, paddingTop: 32, paddingBottom: 64 };
export const documentBodyStyle: ViewStyle = { width: '100%', maxWidth: 840, alignSelf: 'center' };

/** Cap the chat against the space shared with the file, excluding the right panel. */
export function getWorkspaceChatWidth(preferred: number, rowWidth: number, rightPanelWidth: number): number {
    return rowWidth > 0 ? Math.min(preferred, Math.max(310, (rowWidth - rightPanelWidth - 6) / 2)) : preferred;
}
