import { describe, expect, it } from 'vitest';

import { resolvePluginRoute } from './pluginClientAdapters';

describe('resolvePluginRoute', () => {
    it('resolves only bundled, trusted route adapters', () => {
        expect(resolvePluginRoute('relationship-advisor', 'relationship-advisor'))
            .toBe('/relationship-advisor');
        expect(resolvePluginRoute('generated-images-gallery', 'generated-images-gallery'))
            .toBe('/generated-images');
    });

    it('does not execute unknown or mismatched server-declared routes', () => {
        expect(resolvePluginRoute('third-party-plugin', 'javascript-alert')).toBeNull();
        expect(resolvePluginRoute('relationship-advisor', 'generated-images-gallery')).toBeNull();
    });
});
