import { describe, expect, it } from 'vitest';

import {
  PluginCatalogResponseSchema,
  PluginInstallRequestSchema,
  PluginManifestSchema,
} from './plugins';

const manifest = {
  schemaVersion: 1 as const,
  id: 'relationship-advisor',
  version: '1.0.0',
  title: { default: 'Relationship Advisor', translations: { 'zh-Hans': '狗头军师' } },
  description: { default: 'Fast cloud conversations' },
  icon: 'chatbubbles-outline',
  featured: true,
  installedAction: 'configure' as const,
  entrypoint: { type: 'app-route' as const, routeId: 'relationship-advisor' },
  configuration: {
    notice: { default: 'Secrets are encrypted on the Paws server.' },
    fields: [
      {
        key: 'apiKey',
        type: 'secret' as const,
        required: true,
        label: { default: 'API Key' },
        placeholder: { default: 'sk-...' },
      },
    ],
  },
};

describe('plugin wire contract', () => {
  it('accepts a server-driven manifest with localized metadata and declarative fields', () => {
    expect(PluginManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it('rejects executable entrypoints and invalid plugin versions', () => {
    expect(() => PluginManifestSchema.parse({
      ...manifest,
      version: 'latest',
      entrypoint: { type: 'javascript', source: 'alert(1)' },
    })).toThrow();
  });

  it('models installed versions without returning secret configuration values', () => {
    const catalog = PluginCatalogResponseSchema.parse({
      plugins: [{
        manifest,
        status: {
          installed: true,
          version: '1.0.0',
          configuration: {},
          secretHints: { apiKey: '1234' },
        },
      }],
    });

    expect(catalog.plugins[0].status).toEqual({
      installed: true,
      version: '1.0.0',
      configuration: {},
      secretHints: { apiKey: '1234' },
    });
  });

  it('requires clients to pin the manifest version when installing', () => {
    expect(PluginInstallRequestSchema.parse({
      version: '1.0.0',
      configuration: { apiKey: 'secret' },
    })).toEqual({
      version: '1.0.0',
      configuration: { apiKey: 'secret' },
    });
    expect(() => PluginInstallRequestSchema.parse({ version: 'latest', configuration: {} })).toThrow();
  });
});
