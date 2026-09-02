import { describe, expect, it } from 'vitest';

import { pageNonce, webviewPage } from './html.js';

const page = {
  title: 'A view',
  scriptUri: 'https://host/dist/webview/canvas.js',
  styleUri: 'https://host/dist/webview/canvas.css',
  cspSource: 'https://host',
  nonce: 'abc123',
};

describe('the webview page', () => {
  it('loads the bundle the host resolved', () => {
    const html = webviewPage(page);

    expect(html).toContain(page.scriptUri);
    expect(html).toContain(page.styleUri);
  });

  /**
   * Without this the page renders and the script
   * silently does not run, which looks exactly
   * like a webview that failed to build.
   */
  it('admits its own script and nothing else', () => {
    const html = webviewPage(page);

    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain('nonce="abc123"');
  });

  /** React writes `style` attributes directly. */
  it('allows element styles', () => {
    expect(webviewPage(page)).toMatch(/style-src[^;]*'unsafe-inline'/);
  });

  it('escapes a title rather than pasting it in', () => {
    const html = webviewPage({ ...page, title: '<script>alert(1)</script>' });

    expect(html).not.toContain('<script>alert(1)');
  });

  it('mints a different nonce each load', () => {
    expect(pageNonce()).not.toBe(pageNonce());
  });
});
