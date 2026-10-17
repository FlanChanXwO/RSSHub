import { afterEach, describe, expect, it } from 'vitest';

import { config } from '@/config';

import pixivUtils from './utils';

const originalProxy = config.pixiv.imgProxy;
const originalAccessKey = config.accessKey;

afterEach(() => {
    config.pixiv.imgProxy = originalProxy;
    config.accessKey = originalAccessKey;
});

describe('Pixiv image URLs', () => {
    it('uses a smaller display image before the original for single-page artworks', () => {
        config.pixiv.imgProxy = 'https://i.pixiv.re';

        const illust = {
            image_urls: { large: 'https://i.pximg.net/img-master/single_p0_master1200.png' },
            meta_single_page: { original_image_url: 'https://i.pximg.net/img-original/single_p0.png' },
        };

        expect(pixivUtils.getImageUrls(illust)).toEqual(['https://i.pixiv.re/img-master/single_p0_master1200.png']);
        expect(pixivUtils.getImgs({ ...illust, width: 1024, height: 1024 })).toEqual(['<p><img src="https://i.pixiv.re/img-original/single_p0.png" width="1024" height="1024" /></p>']);
    });

    it('preserves the image order of a multi-page artwork and falls back when needed', () => {
        config.pixiv.imgProxy = 'https://i.pixiv.re';

        const illust = {
            meta_pages: [{ image_urls: { large: 'https://i.pximg.net/img-master/page0.jpg', original: 'https://i.pximg.net/img-original/page0.jpg' } }, { image_urls: { original: 'https://i.pximg.net/img-original/page1.png' } }],
        };

        expect(pixivUtils.getImageUrls(illust)).toEqual(['https://i.pixiv.re/img-master/page0.jpg', 'https://i.pixiv.re/img-original/page1.png']);
        expect(pixivUtils.getImgs(illust)).toHaveLength(2);
    });

    it('falls back to the original image and omits absent images', () => {
        config.pixiv.imgProxy = 'https://i.pixiv.re';

        expect(pixivUtils.getImageUrls({ meta_single_page: { original_image_url: 'https://i.pximg.net/img-original/one.jpg' } })).toEqual(['https://i.pixiv.re/img-original/one.jpg']);
        expect(pixivUtils.getImageUrls({})).toEqual([]);
    });

    it('provides a playable GIF enclosure without a duplicate static cover', () => {
        config.accessKey = undefined;
        const media = pixivUtils.getItemMedia({ id: 150_092_202, type: 'ugoira' }, 'https://rss.example/pixiv/ranking/week');
        expect(media.enclosure_type).toBe('image/gif');
        expect(media.enclosure_url).toBe('https://rss.example/pixiv/ugoira/150092202.gif');
        expect(media.description).toBe('<p><img src="https://rss.example/pixiv/ugoira/150092202.gif" /></p>');
    });

    it('includes a path-based access code for protected feeds', () => {
        config.accessKey = 'test-key';
        const media = pixivUtils.getItemMedia({ id: 100, type: 'ugoira' }, 'https://rss.example/pixiv/ranking/week?key=test-key');
        const url = new URL(media.enclosure_url);
        expect(url.pathname).toBe('/pixiv/ugoira/100.gif');
        expect(url.searchParams.get('code')).toMatch(/^[\da-f]{32}$/);
        expect(url.searchParams.has('key')).toBe(false);
    });
});
