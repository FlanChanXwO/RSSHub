import { unzipSync } from 'fflate';
import * as gifenc from 'gifenc';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

import { config } from '@/config';
import cache from '@/utils/cache';

import getUgoiraMetadata from './api/get-ugoira-metadata';
import { getToken } from './token';

const { applyPalette, GIFEncoder, quantize } = gifenc.GIFEncoder ? gifenc : gifenc.default;

const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_GIF_BYTES = 8 * 1024 * 1024;
const MAX_FRAMES = 400;
const MAX_TOTAL_PIXELS = 100_000_000;
const GIF_CACHE_TTL = 7 * 24 * 60 * 60;
const METADATA_CACHE_TTL = 60 * 60;

export interface UgoiraFrame {
    file: string;
    delay: number;
}

interface UgoiraMetadata {
    zip_urls: {
        medium?: string;
        original?: string;
    };
    frames: UgoiraFrame[];
}

export class UgoiraMediaError extends Error {
    constructor(
        message: string,
        readonly status: 413 | 422 | 502 | 503 = 422
    ) {
        super(message);
        this.name = 'UgoiraMediaError';
    }
}

function validateZipSize(zip: Uint8Array): void {
    if (zip.byteLength > MAX_ZIP_BYTES) {
        throw new UgoiraMediaError('Pixiv animation ZIP exceeds the 20 MiB download limit', 413);
    }

    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const searchStart = Math.max(0, zip.byteLength - 65557);
    let endRecord = -1;

    for (let offset = zip.byteLength - 22; offset >= searchStart; offset--) {
        if (view.getUint32(offset, true) === 0x06_05_4b_50) {
            endRecord = offset;
            break;
        }
    }
    if (endRecord < 0) {
        throw new UgoiraMediaError('Pixiv returned an invalid animation ZIP');
    }

    const entryCount = view.getUint16(endRecord + 10, true);
    const centralDirectorySize = view.getUint32(endRecord + 12, true);
    const centralDirectoryOffset = view.getUint32(endRecord + 16, true);
    if (entryCount > MAX_FRAMES + 4 || entryCount === 0xffff || centralDirectorySize === 0xff_ff_ff_ff || centralDirectoryOffset === 0xff_ff_ff_ff || centralDirectoryOffset + centralDirectorySize > endRecord) {
        throw new UgoiraMediaError('Pixiv animation ZIP has an unsupported directory layout', 422);
    }

    let offset = centralDirectoryOffset;
    let totalUncompressedBytes = 0;
    for (let i = 0; i < entryCount; i++) {
        if (offset + 46 > centralDirectoryOffset + centralDirectorySize || view.getUint32(offset, true) !== 0x02_01_4b_50) {
            throw new UgoiraMediaError('Pixiv returned an invalid animation ZIP directory');
        }

        const flags = view.getUint16(offset + 8, true);
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const fileNameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);

        if ((flags & 1) !== 0 || (method !== 0 && method !== 8) || compressedSize === 0xff_ff_ff_ff || uncompressedSize === 0xff_ff_ff_ff) {
            throw new UgoiraMediaError('Pixiv animation ZIP uses an unsupported compression format', 422);
        }

        totalUncompressedBytes += uncompressedSize;
        if (totalUncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
            throw new UgoiraMediaError('Pixiv animation expands beyond the 100 MiB processing limit', 413);
        }

        offset += 46 + fileNameLength + extraLength + commentLength;
    }
}

function resizeRgba(data: Uint8Array, width: number, height: number, maxEdge: number) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    if (targetWidth === width && targetHeight === height) {
        return { data, width, height };
    }

    const output = new Uint8Array(targetWidth * targetHeight * 4);
    const scaleX = width / targetWidth;
    const scaleY = height / targetHeight;
    for (let y = 0; y < targetHeight; y++) {
        const sourceY = (y + 0.5) * scaleY - 0.5;
        const y0 = Math.max(0, Math.floor(sourceY));
        const y1 = Math.min(height - 1, y0 + 1);
        const fy = Math.max(0, sourceY - y0);
        for (let x = 0; x < targetWidth; x++) {
            const sourceX = (x + 0.5) * scaleX - 0.5;
            const x0 = Math.max(0, Math.floor(sourceX));
            const x1 = Math.min(width - 1, x0 + 1);
            const fx = Math.max(0, sourceX - x0);
            const topLeft = (y0 * width + x0) * 4;
            const topRight = (y0 * width + x1) * 4;
            const bottomLeft = (y1 * width + x0) * 4;
            const bottomRight = (y1 * width + x1) * 4;
            const target = (y * targetWidth + x) * 4;
            for (let channel = 0; channel < 4; channel++) {
                const top = data[topLeft + channel] * (1 - fx) + data[topRight + channel] * fx;
                const bottom = data[bottomLeft + channel] * (1 - fx) + data[bottomRight + channel] * fx;
                output[target + channel] = Math.round(top * (1 - fy) + bottom * fy);
            }
        }
    }
    return { data: output, width: targetWidth, height: targetHeight };
}

function encodeFrames(files: Record<string, Uint8Array>, frames: UgoiraFrame[], maxEdge: number, maxColors: number): Uint8Array {
    const gif = GIFEncoder();
    let totalSourcePixels = 0;

    for (const frame of frames) {
        if (!/^[\w.-]+\.(?:jpe?g|png)$/i.test(frame.file) || frame.file.includes('..')) {
            throw new UgoiraMediaError('Pixiv animation contains an unsupported frame filename', 422);
        }
        const bytes = files[frame.file];
        if (!bytes) {
            throw new UgoiraMediaError('Pixiv animation is missing a frame from its ZIP');
        }
        if (!Number.isFinite(frame.delay) || frame.delay < 0) {
            throw new UgoiraMediaError('Pixiv animation contains an invalid frame delay');
        }

        let decoded: { data: Uint8Array; width: number; height: number };
        try {
            if (/\.png$/i.test(frame.file)) {
                if (bytes.length < 24) {
                    throw new UgoiraMediaError('Pixiv animation contains an incomplete PNG frame');
                }
                const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                const width = header.getUint32(16);
                const height = header.getUint32(20);
                if (width < 1 || height < 1 || width > 4000 || height > 4000 || width * height > 16_000_000 || totalSourcePixels + width * height > MAX_TOTAL_PIXELS) {
                    throw new UgoiraMediaError('Pixiv animation frame dimensions exceed the processing limit', 413);
                }
                decoded = PNG.sync.read(Buffer.from(bytes));
            } else {
                decoded = jpeg.decode(bytes, {
                    useTArray: true,
                    maxResolutionInMP: 16,
                    maxMemoryUsageInMB: 128,
                });
            }
        } catch (error) {
            if (error instanceof UgoiraMediaError) {
                throw error;
            }
            throw new UgoiraMediaError('Failed to decode a Pixiv animation frame');
        }
        if (decoded.width < 1 || decoded.height < 1 || decoded.width > 4000 || decoded.height > 4000 || decoded.data.length !== decoded.width * decoded.height * 4) {
            throw new UgoiraMediaError('Pixiv animation frame dimensions exceed the processing limit', 413);
        }
        totalSourcePixels += decoded.width * decoded.height;
        if (totalSourcePixels > MAX_TOTAL_PIXELS) {
            throw new UgoiraMediaError('Pixiv animation contains too many source pixels to convert safely', 413);
        }

        const resized = resizeRgba(decoded.data, decoded.width, decoded.height, maxEdge);
        const palette = quantize(resized.data, maxColors, { format: 'rgb565' });
        const index = applyPalette(resized.data, palette);
        gif.writeFrame(index, resized.width, resized.height, {
            palette,
            delay: Math.max(20, Math.round(frame.delay)),
            repeat: 0,
            dispose: 2,
        });
    }

    gif.finish();
    return gif.bytes();
}

export function encodeUgoiraGif(zip: Uint8Array, frames: UgoiraFrame[]): Uint8Array {
    if (!Array.isArray(frames) || frames.length < 2 || frames.length > MAX_FRAMES) {
        throw new UgoiraMediaError('Pixiv animation must contain between 2 and ' + MAX_FRAMES + ' frames', 413);
    }
    validateZipSize(zip);

    let files: Record<string, Uint8Array>;
    try {
        files = unzipSync(zip);
    } catch {
        throw new UgoiraMediaError('Pixiv returned an unreadable animation ZIP');
    }

    for (const [maxEdge, maxColors] of [
        [480, 128],
        [360, 96],
        [240, 64],
    ]) {
        const gif = encodeFrames(files, frames, maxEdge, maxColors);
        if (gif.byteLength <= MAX_GIF_BYTES) {
            return gif;
        }
    }

    throw new UgoiraMediaError('Pixiv animation remains larger than the 8 MiB GIF limit after downscaling', 413);
}

function getMetadata(illustId: string, token: string): Promise<UgoiraMetadata> {
    return cache.tryGet<UgoiraMetadata>(
        'pixiv:ugoira:metadata:' + illustId,
        async () => {
            const response = await getUgoiraMetadata(illustId, token);
            const metadata = response.data?.ugoira_metadata as UgoiraMetadata | undefined;
            if (!metadata?.frames?.length || (!metadata.zip_urls?.medium && !metadata.zip_urls?.original)) {
                throw new UgoiraMediaError('Pixiv did not return animation metadata', 502);
            }
            return metadata;
        },
        METADATA_CACHE_TTL,
        false
    );
}

async function downloadZip(metadata: UgoiraMetadata): Promise<Uint8Array> {
    const sourceUrl = metadata.zip_urls.medium || metadata.zip_urls.original;
    if (!sourceUrl) {
        throw new UgoiraMediaError('Pixiv did not provide an animation ZIP URL', 502);
    }

    const source = new URL(sourceUrl);
    if (source.protocol !== 'https:' || source.hostname !== 'i.pximg.net') {
        throw new UgoiraMediaError('Pixiv returned an unexpected animation host', 502);
    }

    const proxyUrl = sourceUrl.replace('https://i.pximg.net', () => config.pixiv.imgProxy || 'https://i.pximg.net');
    const candidates = proxyUrl === sourceUrl ? [sourceUrl] : [proxyUrl, sourceUrl];
    let lastError: unknown;

    for (const url of candidates) {
        try {
            // The primary URL must fail before the fallback URL is attempted.
            // eslint-disable-next-line no-await-in-loop
            const response = await fetch(url, {
                headers: { Referer: 'https://www.pixiv.net/' },
                signal: AbortSignal.timeout(30000),
            });
            if (!response.ok) {
                throw new Error('Pixiv animation archive returned HTTP ' + response.status);
            }
            if (Number(response.headers.get('content-length') || 0) > MAX_ZIP_BYTES) {
                throw new UgoiraMediaError('Pixiv animation ZIP exceeds the 20 MiB download limit', 413);
            }
            if (!response.body) {
                throw new Error('Pixiv animation archive response has no body');
            }

            const chunks: Uint8Array[] = [];
            let byteLength = 0;
            // Stream in order so oversized archives stop before exhausting memory.
            // eslint-disable-next-line no-await-in-loop
            for await (const chunk of response.body) {
                byteLength += chunk.byteLength;
                if (byteLength > MAX_ZIP_BYTES) {
                    throw new UgoiraMediaError('Pixiv animation ZIP exceeds the 20 MiB download limit', 413);
                }
                chunks.push(chunk);
            }
            const zip = Buffer.concat(chunks, byteLength);
            validateZipSize(zip);
            return zip;
        } catch (error) {
            if (error instanceof UgoiraMediaError) {
                throw error;
            }
            lastError = error;
        }
    }

    throw new UgoiraMediaError('Unable to download Pixiv animation ZIP' + (lastError instanceof Error ? ': ' + lastError.message : ''), 502);
}

async function getCachedGif(illustId: string): Promise<Uint8Array> {
    const base64 = await cache.tryGet<string>(
        'pixiv:ugoira:gif:v1:' + illustId,
        async () => {
            const token = await getToken();
            if (!token) {
                throw new UgoiraMediaError('Pixiv authentication is unavailable', 503);
            }
            const metadata = await getMetadata(illustId, token);
            const zip = await downloadZip(metadata);
            return Buffer.from(encodeUgoiraGif(zip, metadata.frames)).toString('base64');
        },
        GIF_CACHE_TTL,
        false
    );
    return new Uint8Array(Buffer.from(base64, 'base64'));
}

const inflight = new Map<string, Promise<Uint8Array>>();

export default function getUgoiraGif(illustId: string): Promise<Uint8Array> {
    const running = inflight.get(illustId);
    if (running) {
        return running;
    }
    const pending = (async () => {
        try {
            return await getCachedGif(illustId);
        } finally {
            inflight.delete(illustId);
        }
    })();
    inflight.set(illustId, pending);
    return pending;
}
