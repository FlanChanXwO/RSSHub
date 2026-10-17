import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { config } from '@/config';

import { route } from './ugoira';
import getUgoiraGif from './ugoira-gif';

vi.mock('./ugoira-gif', () => ({
    default: vi.fn(() => Promise.resolve(Uint8Array.from([71, 73, 70, 56, 57, 97]))),
    UgoiraMediaError: class extends Error {},
}));

const originalToken = config.pixiv.refreshToken;

afterEach(() => {
    config.pixiv.refreshToken = originalToken;
    vi.clearAllMocks();
});

describe('Pixiv animated media route', () => {
    const app = new Hono();
    app.get('/pixiv' + route.path, route.handler);

    it('returns a GIF and its media headers', async () => {
        config.pixiv.refreshToken = 'test-token';
        const response = await app.request('https://rss.example/pixiv/ugoira/123.gif');
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/gif');
        expect(response.headers.get('cache-control')).toContain('max-age=604800');
        expect(await response.text()).toBe('GIF89a');
        expect(getUgoiraGif).toHaveBeenCalledWith('123');
    });

    it('rejects malformed IDs before fetching', async () => {
        config.pixiv.refreshToken = 'test-token';
        const response = await app.request('https://rss.example/pixiv/ugoira/not-an-id.gif');
        expect(response.status).toBe(400);
        expect(getUgoiraGif).not.toHaveBeenCalled();
    });

    it('reports missing Pixiv authentication', async () => {
        config.pixiv.refreshToken = undefined;
        const response = await app.request('https://rss.example/pixiv/ugoira/123.gif');
        expect(response.status).toBe(503);
        expect(getUgoiraGif).not.toHaveBeenCalled();
    });
});
