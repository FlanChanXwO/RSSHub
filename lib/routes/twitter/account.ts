import { createHash } from 'node:crypto';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import InvalidParameterError from '@/errors/types/invalid-parameter';

export type TwitterAccount = {
    alias: string;
    token: string;
    scope: string;
};

export function getTwitterAccountAlias(requestPath: string): string | undefined {
    const match = requestPath.match(/^\/twitter\/(?:home|home_latest)\/([^/]+)$/);
    if (!match) {
        return;
    }
    let routeParams: string;
    try {
        routeParams = decodeURIComponent(match[1]);
    } catch {
        throw new InvalidParameterError('Invalid Twitter route parameter encoding');
    }
    const params = new URLSearchParams(routeParams);
    if (!params.has('account')) {
        return;
    }
    const alias = params.get('account')!;
    if (params.getAll('account').length !== 1 || !/^[A-Z][A-Z0-9_]*$/.test(alias)) {
        throw new InvalidParameterError('Invalid Twitter account alias');
    }
    return alias;
}

export function resolveTwitterAccount(alias: string): TwitterAccount {
    const token = config.twitter.namedAuthTokens[alias]?.trim();
    if (!token || /[\s;,]/.test(token)) {
        throw new ConfigNotFoundError(`Configure a single TWITTER_AUTH_TOKEN_${alias}`);
    }
    return {
        alias,
        token,
        scope: `twitter:${alias}:${createHash('sha256').update(token).digest('hex')}`,
    };
}
