import { config } from '@/config';
import md5 from '@/utils/md5';

const getImageUrls = (illust) => {
    const urls = illust.meta_pages?.length
        ? illust.meta_pages.map((page) => page.image_urls.large || page.image_urls.medium || page.image_urls.original)
        : [illust.image_urls?.large || illust.image_urls?.medium || illust.meta_single_page?.original_image_url];

    return urls.filter(Boolean).map((url) => url.replace('https://i.pximg.net', () => config.pixiv.imgProxy));
};

const getItemMedia = (illust, requestUrl: string, previewImages = false) => {
    if (illust.type === 'ugoira') {
        const path = '/pixiv/ugoira/' + illust.id + '.gif';
        const mediaUrl = new URL(path, requestUrl);
        if (config.accessKey) {
            mediaUrl.searchParams.set('code', md5(path + config.accessKey));
        }
        const gif = mediaUrl.href;
        return {
            description: '<p><img src="' + gif + '" /></p>',
            enclosure_url: gif,
            enclosure_type: 'image/gif',
        };
    }
    const urls = getImageUrls(illust);
    const imageUrl = urls[0];
    return {
        description: previewImages ? urls.map((url) => '<p><img src="' + url + '" /></p>').join('') : getImgs(illust).join(''),
        enclosure_url: imageUrl,
        enclosure_type: imageUrl ? (/\.png(?:\?|$)/i.test(imageUrl) ? 'image/png' : 'image/jpeg') : undefined,
    };
};

const getImgs = (illust) => {
    const images: string[] = [];
    if (illust.meta_pages?.length) {
        for (const page of illust.meta_pages) {
            const original = page.image_urls.original.replace('https://i.pximg.net', () => config.pixiv.imgProxy);
            images.push(`<p><img src="${original}" width="${page.width}" height="${page.height}" /></p>`);
        }
    } else if (illust.meta_single_page.original_image_url) {
        const original = illust.meta_single_page.original_image_url.replace('https://i.pximg.net', () => config.pixiv.imgProxy);
        images.push(`<p><img src="${original}" width="${illust.width}" height="${illust.height}" /></p>`);
    }
    return images;
};

export default {
    getItemMedia,
    getImageUrls,
    getImgs,
    getProxiedImageUrl: (originalUrl: string): string => originalUrl.replace('https://i.pximg.net', () => config.pixiv.imgProxy || ''),
};
