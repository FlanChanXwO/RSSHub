declare module 'jpeg-js' {
    interface DecodeOptions {
        useTArray?: boolean;
        formatAsRGBA?: boolean;
        tolerantDecoding?: boolean;
        maxResolutionInMP?: number;
        maxMemoryUsageInMB?: number;
    }

    interface DecodedImage {
        data: Uint8Array;
        width: number;
        height: number;
    }

    interface EncodedImage {
        data: Uint8Array;
        width: number;
        height: number;
    }

    const jpeg: {
        decode(data: Uint8Array, options?: DecodeOptions): DecodedImage;
        encode(image: { data: Uint8Array; width: number; height: number }, quality?: number): EncodedImage;
    };

    export default jpeg;
}
