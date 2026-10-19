// The image every clustering fixture in this folder was made from: 24×16 RGBA, opaque, with repeated colours.
export const width = 24, height = 16;

export function fixtureImage() {
    const rgba = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) {
        const x = p % width, y = Math.floor(p / width);
        rgba.set([(x * 11) & 255, (y * 16) & 255, ((x >> 2) * 40 + (y >> 2) * 25) & 255, 255], p * 4);
    }
    return rgba;
}

export const sizes = [1, 2, 3, 5, 8, 16, 64, 1000];
