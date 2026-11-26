// The 4.0.0 clustering code (a copy, see clustering.cpp), compiled into its own namespace so that it can link into one binary with
// the code in src/. Everything it includes from the standard library is included first, outside the namespace.
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <utility>
#include <vector>

namespace reference {
#include "clustering.cpp"
}

#include "reference.hpp"

uint8_t* reference_get_clustering(uint8_t* image_data, int image_length, int image_format, int color_space, int precision, int weight_alpha, int transparent) {
    return reference::exports::get_clustering(image_data, image_length, image_format, color_space, precision, weight_alpha, transparent);
}
