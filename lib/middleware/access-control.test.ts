import { CookieJar } from 'tough-cookie';
import undici from 'undici';
import { afterEach, describe, expect, it, vi } from 'vitest';

import md5 from '@/utils/md5';

process.env.NODE_NAME = 'mock';

async function checkBlock(response) {
    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/Access denied\./);
}

afterEach(() => {
    delete process.env.ACCESS_KEY;
    vi.restoreAllMocks();
    vi.resetModules();
});

describe('access-control', () => {
    it('access key', async () => {
        const key = '1L0veRSSHub';
        const code = md5('/test/2' + key);
        process.env.ACCESS_KEY = key;
        const app = (await import('@/app')).default;

        const response01 = await app.request('/');
        expect(response01.status).toBe(200);

        const response02 = await app.request('/robots.txt');
        expect(response02.status).toBe(404);

        // no key/code
        const response21 = await app.request('/test/2');
        await checkBlock(response21);

        // wrong key/code
        const response321 = await app.request(`/test/2?key=wrong+${key}`);
        await checkBlock(response321);

        const response322 = await app.request(`/test/2?code=wrong+${code}`);
        await checkBlock(response322);

        // right key/code
        const response331 = await app.request(`/test/2?key=${key}`);
        expect(response331.status).toBe(200);

        const response332 = await app.request(`/test/2?code=${code}`);
        expect(response332.status).toBe(200);
    });
});

describe('Worker named-account subscriptions', () => {
    it('isolates a rebound credential before cache lookup and rejects revoked subscriptions', async () => {
        process.env.ACCESS_KEY = 'test-access-key';
        const { config } = await import('@/config');
        config.accessKey = 'test-access-key';
        config.twitter.namedAuthTokens = { A: 'test-token-a', B: 'test-token-b' };
        const cache = (await import('@/utils/cache')).default;
        const { resolveTwitterAccount } = await import('@/routes/twitter/account');
        await Promise.all(
            ['A', 'B'].map(async (alias) => {
                const account = resolveTwitterAccount(alias);
                const jar = new CookieJar();
                jar.setCookieSync(`auth_token=${account.token}`, 'https://x.com');
                jar.setCookieSync('ct0=test-csrf', 'https://x.com');
                await cache.set(`twitter:cookie:${account.scope}`, JSON.stringify(jar.serializeSync()));
            })
        );
        await cache.set('twitter:gql-query-ids', { HomeTimeline: 'test-query' });
        vi.spyOn(undici, 'fetch').mockImplementation(() =>
            Promise.resolve(
                new undici.Response(JSON.stringify({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [] }] } } } }), {
                    headers: { 'content-type': 'application/json' },
                })
            )
        );
        const app = (await import('@/app.worker')).default;
        const path = '/twitter/home/account=A';
        const url = path + '?code=' + md5(path + config.accessKey);
        const first = await app.request(url);
        expect(first.status).toBe(200);
        const oldEtag = first.headers.get('etag')!;
        expect((await app.request(url)).headers.get('rsshub-cache-status')).toBe('HIT');
        await checkBlock(await app.request(path, { headers: { 'If-None-Match': oldEtag } }));

        config.twitter.namedAuthTokens.A = 'test-token-b';
        const rebound = resolveTwitterAccount('A');
        const jar = new CookieJar();
        jar.setCookieSync('auth_token=test-token-b', 'https://x.com');
        jar.setCookieSync('ct0=test-csrf', 'https://x.com');
        await cache.set(`twitter:cookie:${rebound.scope}`, JSON.stringify(jar.serializeSync()));
        const changed = await app.request(url, { headers: { 'If-None-Match': oldEtag } });
        expect(changed.status).toBe(200);
        expect(changed.headers.get('rsshub-cache-status')).not.toBe('HIT');
        expect(changed.headers.get('etag')).not.toBe(oldEtag);
        expect(changed.headers.get('cache-control')).toBe('private, no-cache');
        const other = await app.request('/twitter/home/account=B?key=test-access-key');
        expect(other.status).toBe(200);
        expect(other.headers.get('etag')).not.toBe(changed.headers.get('etag'));
        delete config.twitter.namedAuthTokens.A;
        expect((await app.request(url, { headers: { 'If-None-Match': oldEtag } })).status).toBe(503);
    });
});
