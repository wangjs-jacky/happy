import { describe, expect, it } from 'vitest';
import * as preview from './interactivePreview';

const UUID = '018f6c2d-3c52-7b51-9a41-6be68eb5cb31';

function asset(path: string, size = 12, mimeType = 'text/html') {
  return { id: `asset-${path.replace(/[^a-z0-9]/gi, '-')}`, path, size, sha256: 'a'.repeat(64), mimeType };
}

function manifest(assets = [asset('index.html')]) {
  return { version: 1 as const, previewId: UUID, title: 'Interaction draft', assets };
}

describe('interactive preview manifest', () => {
  it('exports a validating function', () => {
    expect(typeof (preview as any).validateInteractivePreviewManifest).toBe('function');
  });

  it('accepts a bounded static site with root index.html', () => {
    expect((preview as any).validateInteractivePreviewManifest(manifest([
      asset('index.html'),
      asset('assets/app.js', 1024, 'text/javascript'),
      asset('assets/app.css', 512, 'text/css'),
    ]))).toEqual(manifest([
      asset('index.html'),
      asset('assets/app.js', 1024, 'text/javascript'),
      asset('assets/app.css', 512, 'text/css'),
    ]));
  });

  it.each(['../secret', '/absolute.html', './index.html', 'a//b.js', 'a\\b.js', '.env', 'assets/.hidden'])('rejects unsafe path %s', (path) => {
    expect(() => (preview as any).validateInteractivePreviewManifest(manifest([asset('index.html'), asset(path)]))).toThrow();
  });

  it('rejects duplicate paths', () => {
    expect(() => (preview as any).validateInteractivePreviewManifest(manifest([asset('index.html'), asset('index.html')]))).toThrow(/duplicate/i);
  });

  it('rejects unsupported file types', () => {
    expect(() => (preview as any).validateInteractivePreviewManifest(manifest([asset('index.html'), asset('server.php', 10, 'application/x-httpd-php')]))).toThrow();
  });

  it('requires root index.html', () => {
    expect(() => (preview as any).validateInteractivePreviewManifest(manifest([asset('page.html')]))).toThrow(/index\.html/i);
  });

  it('uses one 96-character opaque asset-id boundary for manifest consumers', () => {
    expect((preview as any).validateInteractivePreviewManifest(manifest([
      { ...asset('index.html'), id: 'a'.repeat(96) },
    ]))).toMatchObject({ assets: [{ id: 'a'.repeat(96) }] });
    expect(() => (preview as any).validateInteractivePreviewManifest(manifest([
      { ...asset('index.html'), id: 'a'.repeat(97) },
    ]))).toThrow();
  });

  it('enforces count, per-file, and total byte limits', () => {
    expect(() => (preview as any).validateInteractivePreviewManifest(manifest([
      asset('index.html'),
      ...Array.from({ length: 100 }, (_, index) => asset(`assets/${index}.js`, 1, 'text/javascript')),
    ]))).toThrow();
    expect(() => (preview as any).validateInteractivePreviewManifest(manifest([asset('index.html', 5 * 1024 * 1024 + 1)]))).toThrow();
    expect(() => (preview as any).validateInteractivePreviewManifest(manifest([
      asset('index.html', 5 * 1024 * 1024),
      asset('a.js', 5 * 1024 * 1024, 'text/javascript'),
      asset('b.js', 1, 'text/javascript'),
    ]))).toThrow();
  });
});
