export type SidebarGroupExpansion = Record<string, boolean>;
export type SidebarGroupExpansionScope = 'lists' | 'projects';

function expansionKey(scope: SidebarGroupExpansionScope, id: string): string {
    return `${scope}:${id}`;
}

export function isSidebarGroupExpanded(
    expansion: SidebarGroupExpansion,
    scope: SidebarGroupExpansionScope,
    id: string,
    defaultExpanded: boolean,
): boolean {
    return expansion[expansionKey(scope, id)] ?? defaultExpanded;
}

export function setSidebarGroupExpanded(
    expansion: SidebarGroupExpansion,
    scope: SidebarGroupExpansionScope,
    id: string,
    expanded: boolean,
    defaultExpanded: boolean,
): SidebarGroupExpansion {
    const key = expansionKey(scope, id);
    if (expanded === defaultExpanded) {
        if (!(key in expansion)) return expansion;
        const next = { ...expansion };
        delete next[key];
        return next;
    }
    if (expansion[key] === expanded) return expansion;
    return { ...expansion, [key]: expanded };
}
