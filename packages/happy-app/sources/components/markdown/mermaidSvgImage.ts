/** Mermaid emits HTML void tags inside foreignObject; an SVG image requires valid XML. */
export function createMermaidImageUri(svg: string): string {
    const document = new DOMParser().parseFromString(svg, 'text/html');
    const element = document.querySelector('svg');
    if (!element) throw new Error('Mermaid did not render an SVG');
    // HTML-parsed XHTML xmlns attributes lack the XMLNS namespace. Let the
    // serializer declare each element's actual namespace without duplicate attributes.
    for (const node of [element, ...element.querySelectorAll('[xmlns]')]) {
        node.removeAttribute('xmlns');
    }
    const serialized = new XMLSerializer().serializeToString(element);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
}
