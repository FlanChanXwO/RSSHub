import { afterEach, describe, expect, it, vi } from 'vitest';

import { config } from '@/config';
import type { Data } from '@/types';

import getRanking from './api/get-ranking';
import { route } from './ranking';
import { getToken } from './token';

vi.mock('./api/get-ranking', () => ({ default: vi.fn() }));
vi.mock('./token', () => ({ getToken: vi.fn() }));

const originalRefreshToken = config.pixiv.refreshToken;
const originalProxy = config.pixiv.imgProxy;

afterEach(() => {
    config.pixiv.refreshToken = originalRefreshToken;
    config.pixiv.imgProxy = originalProxy;
    vi.resetAllMocks();
});

describe('Pixiv weekly R-18 ranking', () => {
    it('provides an image enclosure alongside the complete description gallery', async () => {
        config.pixiv.refreshToken = 'test-token';
        config.pixiv.imgProxy = 'https://i.pixiv.re';
        vi.mocked(getToken).mockResolvedValue('access-token' as never);
        vi.mocked(getRanking).mockResolvedValue({
            data: {
                illusts: [
                    {
                        id: 123,
                        title: 'One image',
                        caption: '<p>caption</p>',
                        create_date: '2026-10-16T12:00:00+09:00',
                        user: { id: 42, name: 'Artist', profile_image_urls: { medium: 'https://example.com/avatar.jpg' } },
                        total_view: 10,
                        total_bookmarks: 2,
                        tags: [{ name: 'art' }],
                        image_urls: { large: 'https://i.pximg.net/img-master/one.png' },
                    },
                    {
                        id: 456,
                        title: 'Two images',
                        caption: '',
                        create_date: '2026-10-16T12:00:00+09:00',
                        user: { id: 43, name: 'Another artist', profile_image_urls: { medium: 'https://example.com/avatar.jpg' } },
                        total_view: 20,
                        total_bookmarks: 5,
                        tags: [],
                        meta_pages: [{ image_urls: { large: 'https://i.pximg.net/img-master/first.jpg' } }, { image_urls: { large: 'https://i.pximg.net/img-master/second.jpg' } }],
                    },
                ],
            },
        } as never);

        const feed = (await route.handler({ req: { param: (name: string) => (name === 'mode' ? 'week_r18' : undefined) } } as never)) as Data;

        expect(feed.title).toBe('pixiv R-18 周排行');
        expect(feed.item).toHaveLength(2);
        expect(feed.item?.[0].enclosure_url).toBe('https://i.pixiv.re/img-master/one.png');
        expect(feed.item?.[0].enclosure_type).toBe('image/png');
        expect(feed.item?.[1].enclosure_url).toBe('https://i.pixiv.re/img-master/first.jpg');
        expect(feed.item?.[1].enclosure_type).toBe('image/jpeg');
        expect(feed.item?.[1].description).toContain('<img src="https://i.pixiv.re/img-master/first.jpg"');
        expect(feed.item?.[1].description).toContain('<img src="https://i.pixiv.re/img-master/second.jpg"');
    });
});
