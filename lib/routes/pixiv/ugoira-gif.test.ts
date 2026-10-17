import { zipSync } from 'fflate';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { encodeUgoiraGif, UgoiraMediaError } from './ugoira-gif';

const first = jpeg.encode(
    {
        width: 3,
        height: 2,
        data: Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => (i % 4 === 3 || i % 4 === 0 ? 255 : 0)),
    },
    85
).data;
const second = PNG.sync.write({
    width: 3,
    height: 2,
    data: Buffer.from(Array.from({ length: 3 * 2 * 4 }, (_, i) => (i % 4 === 3 || i % 4 === 1 ? 255 : 0))),
    gamma: 0,
} as PNG);

const files = { '000000.jpg': first, '000001.png': second };
const frames = [
    { file: '000000.jpg', delay: 100 },
    { file: '000001.png', delay: 200 },
];

describe('Pixiv Ugoira GIF', () => {
    it('decodes ZIP frames and produces an animated GIF', () => {
        const gif = encodeUgoiraGif(zipSync(files), frames);
        expect(Buffer.from(gif.subarray(0, 6)).toString('ascii')).toBe('GIF89a');
        expect(gif.length).toBeGreaterThan(50);
        expect([...gif].filter((_, i) => gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 4)).toHaveLength(2);
    });

    it('rejects a missing frame', () => {
        expect(() => encodeUgoiraGif(zipSync({ '000000.jpg': first }), frames)).toThrow('missing a frame');
    });

    it('rejects invalid ZIP input', () => {
        expect(() => encodeUgoiraGif(new Uint8Array([1, 2, 3]), frames)).toThrow(UgoiraMediaError);
    });

    it('rejects hostile frame names', () => {
        expect(() => encodeUgoiraGif(zipSync(files), [{ file: '../secret.jpg', delay: 20 }, frames[1]])).toThrow('unsupported frame filename');
    });

    it('rejects excessive frame counts', () => {
        expect(() =>
            encodeUgoiraGif(
                zipSync(files),
                Array.from({ length: 121 }, () => frames[0])
            )
        ).toThrow('between 2 and 120');
    });
});
