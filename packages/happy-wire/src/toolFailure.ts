/** Select actionable diagnostics before truncating mixed command output. */
export function summarizeToolFailureOutput(output: string): string | null {
    const lines = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/);
    let fence: string | null = null;
    const diagnostics: string[] = [];
    for (const rawLine of lines) {
        const line = rawLine.trim();
        const marker = line.match(/^(`{3,}|~{3,})/);
        if (marker) {
            if (!fence) fence = marker[1][0];
            else if (marker[1][0] === fence) fence = null;
            continue;
        }
        if (fence) continue;
        // Match terminal diagnostics, not a Skill's prose about error handling.
        if (/^(?:(?:[^\s:]+[\\/])?(?:sed|cat|head|tail|less|more|bat|batcat|zsh|bash|sh|Get-Content)(?:\.exe)?:\s+.+|(?:error|fatal|exception)(?:\s+\[[^\]]+\])?:\s+.+)$/i.test(line)) {
            diagnostics.push(line);
        }
    }
    if (diagnostics.length > 0) return diagnostics[diagnostics.length - 1].slice(0, 280);

    const firstLine = lines.find((line) => line.trim().length > 0)?.trim();
    // A Markdown/frontmatter heading describes the successfully read document,
    // not why the enclosing command failed. Let the caller use its exit code.
    if (!firstLine || /^(?:---|\+\+\+|#{1,6}\s|`{3,}|~{3,})/.test(firstLine)) return null;
    return firstLine.slice(0, 280);
}

/** Keep the selected diagnostic visible even when it follows a large stdout dump. */
export function toolFailureDetail(output: string, summary: string): string {
    const text = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
    const limit = 4000;
    if (text.length <= limit) return text;
    const diagnosticOffset = summary ? text.lastIndexOf(summary) : -1;
    const start = diagnosticOffset + summary.length > limit - 4 ? Math.max(0, diagnosticOffset - 1000) : 0;
    const prefix = start > 0 ? '...\n' : '';
    const remaining = text.slice(start);
    const available = limit - prefix.length;
    return prefix + (remaining.length <= available
        ? remaining
        : remaining.slice(0, available - 4) + '\n...');
}
