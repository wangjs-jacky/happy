import Color from 'color';

export function multiplyColorOpacity(color: string, alpha: number): string {
    try {
        const parsed = Color(color);
        return parsed.alpha(parsed.alpha() * alpha).rgb().string();
    } catch {
        return color;
    }
}
