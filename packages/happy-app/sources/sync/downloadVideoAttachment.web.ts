export async function downloadVideoAttachment(
    uri: string,
    fileName: string,
): Promise<boolean> {
    const anchor = document.createElement('a');
    anchor.href = uri;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
}
