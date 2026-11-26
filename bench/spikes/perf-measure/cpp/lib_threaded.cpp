// The shipped library source plus one extra export, for the cost of a -pthread build (sizes, start-up, browsers):
// quantize_with_palette_threaded maps in row stripes on `threads` std::threads, output identical to quantize_with_palette
// for no dither and for ordered dither (stripes start on multiples of 8 rows). Floyd-Steinberg isn't offered (see README).
// Built unchanged otherwise: #include of the real src/clustering.cpp.
#include "../../../../src/clustering.cpp"
#include <thread>

extern "C" {
EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_with_palette_threaded(uint8_t* image_data, int image_length, int image_format, uint8_t* palette_data, int palette_length, int color_space, double dither, int dither_method, int dither_steps, int width, int threads) {
    const PixelLayout L = layout_of(image_format);
    const size_t pixels = size_t(image_length) / size_t(L.stride), w = size_t(width), height = w ? pixels / w : 0;
    if (threads <= 1 || w == 0 || pixels % w != 0 || height < 16) {
        return _quantize(image_data, image_length, image_format, palette_data, size_t(palette_length), ColorSpace(color_space), dither, dither_method, dither_steps, width);
    }
    size_t rows = (height + size_t(threads) - 1) / size_t(threads);
    rows = (rows + 7) / 8 * 8;
    uint8_t* packed = allocate_variable_size(pixels * size_t(L.stride));
    std::vector<std::thread> pool;
    for (int t = 0; t < threads; t++) {
        const size_t r0 = std::min(height, size_t(t) * rows), r1 = std::min(height, r0 + rows);
        if (r0 >= r1) {continue;}
        pool.emplace_back([=] {
            const size_t row_bytes = w * size_t(L.stride);
            uint8_t* part = _quantize(image_data + r0 * row_bytes, int((r1 - r0) * row_bytes), image_format, palette_data, size_t(palette_length), ColorSpace(color_space), dither, dither_method, dither_steps, width);
            std::memcpy(packed + 4 + r0 * row_bytes, part + 4, (r1 - r0) * row_bytes);
            std::free(part);
        });
    }
    for (std::thread& th : pool) {th.join();}
    return packed;
}
}
