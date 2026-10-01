import { expect, it } from 'vitest';
import { parseMarkdown } from '@/components/markdown/parseMarkdown';
it('renders a closed valid Agent card and keeps following options', () => {
    const blocks = parseMarkdown('已保存\n\n<happy-agent>\n{"id":"agent-a","name":"军师","summary":"挑战假设"}\n</happy-agent>\n\n<options>\n<option>继续</option>\n</options>');
    expect(blocks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'my-agent', card: { id: 'agent-a', name: '军师', summary: '挑战假设' } }), expect.objectContaining({ type: 'options' })]));
});
it('does not render partial streaming data or unsafe route identifiers', () => {
    for (const payload of ['<happy-agent>\n{"id":"a","name":"军师"}', '<happy-agent>\n{"id":"../../accounts","name":"军师"}\n</happy-agent>']) expect(parseMarkdown(payload).some(b => b.type === 'my-agent')).toBe(false);
});
