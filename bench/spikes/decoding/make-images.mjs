// Test files for the decoding spike, written into images/ (gitignored) from the Kodak fixtures.
// node make-images.mjs   (needs fixtures/images/kodim23.png and kodim05.png: run the Kodak tests once)
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const out = new URL('./images/', import.meta.url).pathname;
const kodak = (n) => new URL(`../../../fixtures/images/kodim${n}.png`, import.meta.url).pathname;
await mkdir(out, { recursive: true });

const src = kodak('23');
await sharp(src).toFile(out + 'photo.png');                                    // 8-bit RGB, 768×512
await sharp(src).jpeg({ quality: 90 }).toFile(out + 'photo.jpg');              // baseline sRGB JPEG
await sharp(src).png({ palette: true, colours: 256 }).toFile(out + 'indexed.png');   // colour type 3
await sharp(src).toColourspace('b-w').png().toFile(out + 'grey.png');                  // colour type 0
await sharp(src).toColourspace('rgb16').png().toFile(out + 'deep.png');         // 16 bits per channel
await sharp(src).webp({ quality: 90 }).toFile(out + 'photo.webp');
await sharp(src).avif({ quality: 70 }).toFile(out + 'photo.avif');
await sharp(src).gif().toFile(out + 'photo.gif');
// A phone photo: pixels stored rotated, with EXIF orientation 6 ("rotate 90° clockwise to display").
await sharp(src).rotate(-90).withMetadata({ orientation: 6 }).jpeg({ quality: 90 }).toFile(out + 'rotated.jpg');
// A wide-gamut photo (Display P3 pixels with their ICC profile), as iPhones and Macs write.
await sharp(src).withIccProfile('p3').jpeg({ quality: 90 }).toFile(out + 'p3.jpg');
// Straight alpha: a horizontal gradient from opaque to transparent over a photo.
{
    const { data, info } = await sharp(kodak('05')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y++) {for (let x = 0; x < info.width; x++) {data[(y * info.width + x) * 4 + 3] = Math.round(255 * (1 - x / (info.width - 1)));}}
    await sharp(data, { raw: info }).png().toFile(out + 'alpha.png');
}
// 12 megapixels (4240×2832), as a camera JPEG.
await sharp(src).resize(4240, 2832).jpeg({ quality: 90 }).toFile(out + 'large.jpg');
console.log('written to', out);
// A 1-bit black-and-white PNG (bit-packed rows), as scanners and line-art tools write.
await sharp(src).toColourspace('b-w').threshold(128).png({ colours: 2, palette: true }).toFile(out + 'onebit.png');
// Two-frame animations: the first frame the photo, the second solid red.
{
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const frames = Buffer.concat([data, Buffer.alloc(data.length, 0).fill(Buffer.from([255, 0, 0, 255]))]);
    const raw = { width: info.width, height: info.height * 2, channels: 4, pageHeight: info.height };
    await sharp(frames, { raw }).gif({ loop: 0 }).toFile(out + 'animated.gif');
    await sharp(frames, { raw }).webp({ quality: 90, loop: 0 }).toFile(out + 'animated.webp');
}
