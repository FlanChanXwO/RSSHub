import { afterEach, describe, expect, it } from 'vitest';

import { config } from '@/config';

import pixivUtils from './utils';

const originalProxy = config.pixiv.imgProxy;

afterEach(() => {
    config.pixiv.imgProxy = originalProxy;
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
            meta_pages: [
                { image_urls: { large: 'https://i.pximg.net/img-master/page0.jpg', original: 'https://i.pximg.net/img-original/page0.jpg' } },
                { image_urls: { original: 'https://i.pximg.net/img-original/page1.png' } },
            ],
        };

        expect(pixivUtils.getImageUrls(illust)).toEqual(['https://i.pixiv.re/img-master/page0.jpg', 'https://i.pixiv.re/img-original/page1.png']);
        expect(pixivUtils.getImgs(illust)).toHaveLength(2);
    });

    it('falls back to the original image and omits absent images', () => {
        config.pixiv.imgProxy = 'https://i.pixiv.re';

        expect(pixivUtils.getImageUrls({ meta_single_page: { original_image_url: 'https://i.pximg.net/img-original/one.jpg' } })).toEqual([
            'https://i.pixiv.re/img-original/one.jpg',
        ]);
        expect(pixivUtils.getImageUrls({})).toEqual([]);
    });
});
