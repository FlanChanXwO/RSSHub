import type { Route } from '@/types';

import type { TwitterAccount } from './account';
import api from './api';
import webApi from './api/web-api/api';
import utils from './utils';

export const route: Route = {
    path: '/home_latest/:routeParams?',
    categories: ['social-media'],
    example: '/twitter/home_latest',
    features: {
        requireConfig: [
            // {
            //     name: 'TWITTER_USERNAME',
            //     description: 'Please see above for details.',
            // },
            // {
            //     name: 'TWITTER_PASSWORD',
            //     description: 'Please see above for details.',
            // },
            {
                name: 'TWITTER_AUTH_TOKEN',
                description: 'Use TWITTER_AUTH_TOKEN for legacy requests, or TWITTER_AUTH_TOKEN_<ALIAS> and ACCESS_KEY for named accounts.',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Home latest timeline',
    maintainers: ['DIYgod', 'CaoMeiYouRen'],
    handler,
    description: 'Select a named ENV credential with `account=A` in routeParams. Named accounts require ACCESS_KEY; credentials change after restarting RSSHub.',
    radar: [
        {
            source: ['x.com/home'],
            target: '/home_latest',
        },
    ],
};

async function handler(ctx) {
    // For compatibility
    const { count, include_rts, only_media } = utils.parseRouteParams(ctx.req.param('routeParams'));
    const params = count ? { count } : {};

    const account: TwitterAccount | undefined = ctx.get('twitterAccount');
    const selectedApi = account ? webApi : api;
    await selectedApi.init();
    let data = account ? await webApi.getHomeLatestTimeline('', params, account) : await api.getHomeLatestTimeline('', params);
    if (!include_rts) {
        data = utils.excludeRetweet(data);
    }
    if (only_media) {
        data = utils.keepOnlyMedia(data);
    }

    return {
        title: account ? `Twitter following timeline (${account.alias})` : 'Twitter following timeline',
        link: 'https://x.com/home',
        // description: userInfo?.description,
        item: utils.ProcessFeed(ctx, {
            data,
        }),
    };
}
