#pragma once
#include <cstdint>

// The 4.0.0 `get_clustering`: the same arguments, and a result in the same form (a 4-byte length, then the clustering; malloc'd).
uint8_t* reference_get_clustering(uint8_t* image_data, int image_length, int image_format, int color_space, int precision, int weight_alpha, int transparent);
