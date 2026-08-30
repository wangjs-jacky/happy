export function isPublicSessionSharePath(pathname: string | null | undefined): boolean {
    return /^\/share\/[^/]+\/?$/.test(pathname ?? '');
}
