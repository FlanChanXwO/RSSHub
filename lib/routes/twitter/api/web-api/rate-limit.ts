import { isWorker } from '@/utils/is-worker';

export function getRateLimitTtl(reset: string | null, namedAccount: boolean): number {
    const delay = Math.ceil((Number(reset) * 1000 - Date.now()) / 1000) * 2;
    return reset && Number.isSafeInteger(delay) && delay > 0 ? Math.max(namedAccount || isWorker ? 60 : 1, delay) : 2000;
}
