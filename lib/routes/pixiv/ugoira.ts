import { config } from '@/config';
import type { Route } from '@/types';

import getUgoiraGif, { UgoiraMediaError } from './ugoira-gif';

export const route: Route = {
    path: '/ugoira/:file',
    categories: ['social-media'],
    example: '/pixiv/ugoira/150092202.gif',
    parameters: { file: 'Pixiv animated artwork ID followed by .gif' },
    name: 'Animated artwork GIF',
    maintainers: ['FlanChanXwO'],
    features: {
        nsfw: true,
        requireConfig: [{ name: 'PIXIV_REFRESHTOKEN', description: 'Pixiv refresh token' }],
    },
    handler: async (ctx) => {
        const file = ctx.req.param('file') || '';
        const matched = /^([1-9]\d{0,15})\.gif$/.exec(file);
        if (!matched) {
            return ctx.text('Invalid Pixiv artwork ID', 400);
        }
        const id = matched[1];
        if (!config.pixiv.refreshToken) {
            return ctx.text('Pixiv refresh token is not configured', 503);
        }
        try {
            const gif = await getUgoiraGif(id);
            return new Response(Buffer.from(gif), {
                headers: {
                    'Content-Type': 'image/gif',
                    'Content-Length': gif.byteLength.toString(),
                    'Cache-Control': 'public, max-age=604800',
                },
            });
        } catch (error) {
            if (error instanceof UgoiraMediaError) {
                return ctx.text(error.message, error.status);
            }
            throw error;
        }
    },
};
