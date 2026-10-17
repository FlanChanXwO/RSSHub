import { config } from '@/config';

const getImageUrls = (illust) => {
    const urls = illust.meta_pages?.length
        ? illust.meta_pages.map((page) => page.image_urls.large || page.image_urls.medium || page.image_urls.original)
        : [illust.image_urls?.large || illust.image_urls?.medium || illust.meta_single_page?.original_image_url];

    return urls.filter(Boolean).map((url) => url.replace('https://i.pximg.net', () => config.pixiv.imgProxy));
};

export default {
    getImageUrls,
    getImgs(illust) {
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
    },
    getProxiedImageUrl: (originalUrl: string): string => originalUrl.replace('https://i.pximg.net', () => config.pixiv.imgProxy || ''),
};
