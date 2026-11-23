// File/Blob/URL -> ImageData (8-bit sRGB, straight alpha, upright)
export class DecodeError extends Error {}

export async function blobFromUrl(url) {
  let res;
  try { res = await fetch(url, { mode: 'cors' }); }
  catch (e) { throw new DecodeError(`Couldn't fetch ${url} (blocked by CORS or offline). Download it and drop the file instead.`); }
  if (!res.ok) throw new DecodeError(`Fetching ${url} failed: HTTP ${res.status}`);
  return res.blob();
}

export async function decodeToImageData(blob, maxPixels = 40e6) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',   // apply EXIF rotation (the default in current browsers, explicit here)
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'default',  // convert embedded ICC profiles to sRGB
    });
  } catch (e) {
    const type = blob.type || 'unknown type';
    const heic = /heic|heif/i.test(type) || /\.hei[cf]$/i.test(blob.name ?? '');
    throw new DecodeError(heic
      ? "This browser can't decode HEIC. Export it as JPEG (iPhone: Settings > Camera > Formats > Most Compatible)."
      : `This browser couldn't decode the image (${type}).`);
  }
  const { width, height } = bitmap;
  if (width * height > maxPixels) { bitmap.close(); throw new DecodeError(`Image is ${width}x${height}, too large.`); }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height, { colorSpace: 'srgb', pixelFormat: 'rgba-unorm8' });
}
