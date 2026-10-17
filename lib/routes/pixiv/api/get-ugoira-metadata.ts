import queryString from 'query-string';

import { maskHeader } from '../constants';
import got from '../pixiv-got';

export default function getUgoiraMetadata(illustId: string, token: string) {
    return got('https://app-api.pixiv.net/v1/ugoira/metadata', {
        headers: {
            ...maskHeader,
            Authorization: 'Bearer ' + token,
        },
        searchParams: queryString.stringify({
            illust_id: illustId,
        }),
    });
}
