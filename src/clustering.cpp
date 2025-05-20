// Average Hierarchical Agglomerative Color Clustering
#include <stdint.h>
#include <stdlib.h>
#include <emscripten.h>

extern "C" {

// `input` is a pointer to the input array
// `length` is the number of elements
// returns a pointer to a new array
EMSCRIPTEN_KEEPALIVE
uint8_t* process(uint8_t* input, int length) {
    uint8_t* output = (uint8_t*)malloc(length);
    for (int i = 0; i < length; ++i) {
        output[i] = 255 - input[i];  // You can change this logic
    }
    return output;
}

}