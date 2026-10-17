declare module 'gifenc' {
    export type Palette = number[][];

    export function GIFEncoder(options?: Record<string, unknown>): {
        writeFrame(
            index: Uint8Array,
            width: number,
            height: number,
            options?: {
                palette?: Palette;
                delay?: number;
                repeat?: number;
                dispose?: number;
                colorDepth?: number;
            }
        ): void;
        finish(): void;
        bytes(): Uint8Array;
    };

    export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: Record<string, unknown>): Palette;
    export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: string): Uint8Array;

    const gifenc: {
        GIFEncoder: typeof GIFEncoder;
        quantize: typeof quantize;
        applyPalette: typeof applyPalette;
    };
    export default gifenc;
}
