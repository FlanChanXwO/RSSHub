import { CookieJar } from 'tough-cookie';
import type { Response as UndiciResponse } from 'undici';
import undici from 'undici';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { config as testConfig } from '@/config';
import type { resolveTwitterAccount as resolveAccount } from '@/routes/twitter/account';
import type { twitterGot as requestTwitter } from '@/routes/twitter/api/web-api/utils';
import type cacheModule from '@/utils/cache';
import wait from '@/utils/wait';

beforeAll(() => {
    process.env.CACHE_EXPIRE = '1';
    process.env.CACHE_CONTENT_EXPIRE = '3';
});

afterEach(() => {
    delete process.env.CACHE_TYPE;
    vi.resetModules();
});

afterAll(() => {
    delete process.env.CACHE_EXPIRE;
});

describe('cache', () => {
    it('memory', async () => {
        process.env.CACHE_TYPE = 'memory';
        const cache = (await import('@/utils/cache')).default;
        if (!cache.clients.memoryCache || !cache.status.available) {
            throw new Error('Memory cache client error');
        }
        await cache.set('mock', undefined);
        expect(await cache.get('mock')).toBe('');
        expect(await cache.has('mock')).toBe(true);

        await cache.globalCache.set('mock', undefined);
        expect(await cache.globalCache.get('mock')).toBe('');
        expect(await cache.globalCache.has('mock')).toBe(true);
        await cache.globalCache.set('mock', {
            mock: 1,
        });
        expect(await cache.globalCache.get('mock')).toBe('{"mock":1}');
    }, 10000);

    it('memory get returns null before init', async () => {
        const memory = (await import('@/utils/cache/memory')).default;
        expect(await memory.get('missing')).toBeNull();
        expect(await memory.has('missing')).toBe(false);
    });

    it('tryGet preserves snowflake ID precision', async () => {
        process.env.CACHE_TYPE = 'memory';
        const cache = (await import('@/utils/cache')).default;
        if (!cache.clients.memoryCache || !cache.status.available) {
            throw new Error('Memory cache client error');
        }

        const snowflakeId = '1234567890123456789';
        const fetcher = vi.fn(() => Promise.resolve(snowflakeId));

        const fresh = await cache.tryGet('snowflake', fetcher);
        expect(fresh).toBe(snowflakeId);
        const cached = await cache.tryGet('snowflake', fetcher);
        expect(typeof cached).toBe('string');
        expect(cached).toBe(snowflakeId);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('redis', async () => {
        process.env.CACHE_TYPE = 'redis';
        const cache = (await import('@/utils/cache')).default;
        await wait(500);
        if (!cache.clients.redisClient || !cache.status.available) {
            throw new Error('Redis client error');
        }
        await cache.set('mock1', undefined);
        expect(await cache.get('mock1')).toBe('');
        await cache.set('mock2', '2');
        await cache.set('mock2', '2');
        expect(await cache.get('mock2')).toBe('2');
        expect(await cache.has('mock2')).toBe(true);
        await cache.clients.redisClient?.quit();
    }, 10000);

    it('redis with quit', async () => {
        process.env.CACHE_TYPE = 'redis';
        const cache = (await import('@/utils/cache')).default;
        if (cache.clients.redisClient) {
            await cache.clients.redisClient.quit();
        } else {
            throw new Error('No redis client');
        }
        await cache.set('mock2', '2');
        expect(await cache.get('mock2')).toBe(null);
        expect(await cache.has('mock2')).toBe(false);
    });

    it('redis with error', async () => {
        process.env.CACHE_TYPE = 'redis';
        process.env.REDIS_URL = 'redis://wrongpath:6379';
        const cache = (await import('@/utils/cache')).default;
        await cache.set('mock2', '2');
        expect(await cache.get('mock2')).toBe(null);
        expect(await cache.has('mock2')).toBe(false);
        cache.clients.redisClient?.disconnect();
    });

    it('no cache', async () => {
        process.env.CACHE_TYPE = 'NO';
        const cache = (await import('@/utils/cache')).default;
        await cache.init();
        await cache.set('mock2', '2');
        expect(await cache.get('mock2')).toBe(null);
        expect(await cache.has('mock2')).toBe(false);
        expect(await cache.globalCache.get('mock2')).toBeNull();
        expect(await cache.globalCache.has('mock2')).toBe(false);
        expect(cache.globalCache.set('mock2', '2')).toBeNull();
    });

    it('throws TTL key', async () => {
        process.env.CACHE_TYPE = 'redis';
        const cache = (await import('@/utils/cache')).default;

        try {
            await cache.get('rsshub:cacheTtl:mock');
        } catch (error: any) {
            expect(error.message).toContain('reserved for the internal usage');
        } finally {
            await cache.clients.redisClient?.quit();
        }
    });
});

describe('Twitter named-account cache and cooldowns', () => {
    const cacheType = process.env.CACHE_TYPE || 'memory';
    let config: typeof testConfig;
    let cache: typeof cacheModule;
    let resolveTwitterAccount: typeof resolveAccount;
    let twitterGot: typeof requestTwitter;
    const endpoint = 'https://x.com/i/api/graphql/test/HomeTimeline';
    const response = (status = 200, headers: Record<string, string> = {}) => new undici.Response(JSON.stringify({ data: {} }), { status, headers: { 'content-type': 'application/json', ...headers } });

    async function seed(alias: string, token: string) {
        config.twitter.namedAuthTokens[alias] = token;
        const account = resolveTwitterAccount(alias);
        const jar = new CookieJar();
        jar.setCookieSync(`auth_token=${token}`, 'https://x.com');
        jar.setCookieSync('ct0=test-csrf', 'https://x.com');
        await cache.set(`twitter:cookie:${account.scope}`, JSON.stringify(jar.serializeSync()), 4000);
        return account;
    }

    beforeEach(async () => {
        process.env.CACHE_TYPE = cacheType;
        ({ config } = await import('@/config'));
        cache = (await import('@/utils/cache')).default;
        ({ resolveTwitterAccount } = await import('@/routes/twitter/account'));
        ({ twitterGot } = await import('@/routes/twitter/api/web-api/utils'));
        await vi.waitFor(() => expect(cache.status.available).toBe(true));
        config.twitter.namedAuthTokens = {};
        cache.clients.memoryCache?.clear();
        if (cache.clients.redisClient) {
            const keys = await cache.clients.redisClient.keys('twitter:*');
            if (keys.length) {
                await cache.clients.redisClient.del(...keys);
            }
        }
    });

    function remainingTtl(key: string) {
        return cache.clients.redisClient ? cache.clients.redisClient.pttl(key) : cache.clients.memoryCache!.getRemainingTTL(key);
    }

    afterEach(async () => {
        await cache.clients.redisClient?.quit();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('named-account rate limiting', () => {
        it('keeps a 429 cooldown when an earlier concurrent request succeeds', async () => {
            const account = await seed('A', 'token-a');
            const other = await seed('B', 'token-b');
            const { promise: pending, resolve: started } = Promise.withResolvers<void>();
            const { promise: success, resolve: succeed } = Promise.withResolvers<UndiciResponse>();
            const fetch = vi.spyOn(undici, 'fetch');
            fetch.mockImplementationOnce(() => {
                started();
                return success;
            });
            fetch.mockResolvedValueOnce(response(429));
            const first = twitterGot(endpoint, {}, { account });
            await pending;
            await expect(twitterGot(endpoint, {}, { account })).rejects.toThrow('429');
            succeed(response());
            await first;
            fetch.mockResolvedValue(response());
            await expect(twitterGot(endpoint, {}, { account })).rejects.toThrow('temporarily rate limited');
            await expect(twitterGot(endpoint, {}, { account: other })).resolves.toEqual({ data: {} });
        });

        it.each(['', 'NaN', 'Infinity', '-1', '0', '123junk'])('uses a valid fallback cooldown for reset %j', async (reset) => {
            const account = await seed('A', 'token-a');
            vi.spyOn(undici, 'fetch').mockResolvedValue(response(429, { 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': reset }));
            await expect(twitterGot(endpoint, {}, { account })).rejects.toThrow('429');
            const ttl = await remainingTtl(`twitter:lock-token1:${account.scope}`);
            expect(ttl).toBeGreaterThan(1_999_000);
            expect(ttl).toBeLessThan(2_001_000);
        });

        it('honors a future reset on 429 even without a remaining header', async () => {
            const account = await seed('A', 'token-a');
            vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
            vi.spyOn(undici, 'fetch').mockResolvedValue(response(429, { 'x-rate-limit-reset': '2000000010' }));
            await expect(twitterGot(endpoint, {}, { account })).rejects.toThrow('429');
            const ttl = await remainingTtl(`twitter:lock-token1:${account.scope}`);
            expect(ttl).toBeGreaterThan(59_000);
            expect(ttl).toBeLessThan(61_000);
        });

        it('does not switch identity after authentication failure', async () => {
            const account = await seed('A', 'token-a');
            await seed('B', 'token-b');
            config.twitter.authToken = ['legacy-token'];
            const fetch = vi.spyOn(undici, 'fetch').mockResolvedValue(response(401));
            await expect(twitterGot(endpoint, {}, { account })).rejects.toThrow('authentication failed: 401');
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(config.twitter.authToken).toEqual(['legacy-token']);
        });
    });

    describe('named-account cookies', () => {
        it('does not replace newly initialized cookies with an older successful request jar', async () => {
            const account = await seed('A', 'token-a');
            const { promise: pending, resolve: started } = Promise.withResolvers<void>();
            const { promise: success, resolve: finish } = Promise.withResolvers<UndiciResponse>();
            const fetch = vi.spyOn(undici, 'fetch').mockImplementationOnce(() => {
                started();
                return success;
            });
            const first = twitterGot(endpoint, {}, { account });
            await pending;
            const refreshed = new CookieJar();
            refreshed.setCookieSync('auth_token=token-a', 'https://x.com');
            refreshed.setCookieSync('ct0=new-csrf', 'https://x.com');
            await cache.set(`twitter:cookie:${account.scope}`, JSON.stringify(refreshed.serializeSync()));
            finish(response());
            await first;
            fetch.mockResolvedValue(response());
            await twitterGot(endpoint, {}, { account });
            expect(fetch.mock.lastCall?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'new-csrf' });
        });
    });

    it('initializes and reinitializes only the selected credential after an initialization failure', async () => {
        config.twitter.namedAuthTokens.A = 'token-a';
        config.twitter.authToken = ['legacy-token'];
        const account = resolveTwitterAccount('A');
        const mock = new undici.MockAgent();
        mock.disableNetConnect();
        const origin = mock.get('https://x.com');
        origin.intercept({ path: '/home', method: 'GET', headers: { cookie: 'auth_token=token-a' } }).reply(403, 'denied');
        origin.intercept({ path: '/home', method: 'GET', headers: { cookie: 'auth_token=token-a' } }).reply(200, '', { headers: { 'set-cookie': 'ct0=initialized-csrf; Path=/; Secure' } });
        origin
            .intercept({ path: /^\/i\/api\/graphql\/test\/HomeTimeline/, method: 'GET' })
            .reply(200, { data: {} })
            .persist();
        vi.spyOn(undici.Agent.prototype, 'dispatch').mockImplementation((options, handler) => origin.dispatch(options, handler));
        try {
            await expect(twitterGot(endpoint, {}, { account })).rejects.toThrow('initialization failed');
            await expect(twitterGot(endpoint, {}, { account })).resolves.toEqual({ data: {} });
            await expect(twitterGot(endpoint, {}, { account })).resolves.toEqual({ data: {} });
            expect(config.twitter.authToken).toEqual(['legacy-token']);
            mock.assertNoPendingInterceptors();
        } finally {
            await mock.close();
        }
    });

    it('preserves legacy token-pool unlock and successful cookie writes', async () => {
        const account = await seed('A', 'legacy-token');
        const serialized = await cache.get(`twitter:cookie:${account.scope}`);
        await cache.set('twitter:cookie:legacy-token', serialized!);
        config.twitter.authToken = ['legacy-token'];
        vi.spyOn(undici, 'fetch').mockResolvedValue(response());
        await expect(twitterGot(endpoint, {})).resolves.toEqual({ data: {} });
        expect(await cache.get('twitter:lock-token1:legacy-token', false)).toBeFalsy();
        expect(await cache.get('twitter:cookie:legacy-token')).toBeTruthy();
    });

    it('keeps the Node legacy pool cooldown below the Worker minimum when requested by the server', async () => {
        const account = await seed('A', 'legacy-token');
        await cache.set('twitter:cookie:legacy-token', (await cache.get(`twitter:cookie:${account.scope}`))!);
        config.twitter.authToken = ['legacy-token'];
        vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
        vi.spyOn(undici, 'fetch').mockResolvedValue(response(200, { 'x-rate-limit-remaining': '1', 'x-rate-limit-reset': '2000000001' }));
        await twitterGot(endpoint, {});
        expect(await remainingTtl('twitter:lock-token1:legacy-token')).toBeLessThan(3_000);
        expect(await cache.get('twitter:lock-token1:legacy-token', false)).toBe('1');
    });

    it('resumes the selected account after its cooldown expires', async () => {
        const account = await seed('A', 'token-a');
        const fetch = vi.spyOn(undici, 'fetch').mockResolvedValue(response(429));
        await expect(twitterGot(endpoint, {}, { account })).rejects.toThrow('429');
        await expect(twitterGot(endpoint, {}, { account })).rejects.toThrow('temporarily rate limited');
        const key = `twitter:lock-token1:${account.scope}`;
        if (cache.clients.redisClient) {
            await cache.clients.redisClient.pexpire(key, 1);
            await vi.waitFor(async () => expect(await cache.get(key, false)).toBeFalsy());
        } else {
            await new Promise((resolve) => setTimeout(resolve, 5));
            const now = performance.now();
            vi.spyOn(performance, 'now').mockReturnValue(now + 2_001_000);
        }
        fetch.mockResolvedValue(response());
        await expect(twitterGot(endpoint, {}, { account })).resolves.toEqual({ data: {} });
    });
});
