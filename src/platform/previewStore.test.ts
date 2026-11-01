import { describe, expect, it } from 'vitest';
import { createCachePreviewBackend } from './previewStore';

describe('document dans le Cache API', () => {
  it('écrit puis relit le document ; sans cache, rien', async () => {
    const entries = new Map<string, string>();
    const cache = {
      match: async (url: string) => (entries.has(url) ? new Response(entries.get(url)) : undefined),
      put: async (url: string, response: Response) => { entries.set(url, await response.text()); },
    };
    const backend = createCachePreviewBackend({ open: async () => cache as unknown as Cache });
    expect(await backend.read()).toBeNull();
    await backend.write('{"version":1}');
    expect(await backend.read()).toBe('{"version":1}');

    const none = createCachePreviewBackend(null);
    await none.write('x');
    expect(await none.read()).toBeNull();
  });
});
