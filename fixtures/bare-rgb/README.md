# Bare-RGB fixtures

Two small real images that `test/bare-rgb-check.test.js` reads, so the rule behind the `rgb-as-rgba` warning is pinned on real pixels as well as synthetic ones. The full corpus (2,103 RGBA images) stays in `bench/spikes/bare-rgb/`, downloaded on demand.

- `kodim23-crop.png`: a 96×64 crop of kodim23 from the Kodak Lossless True Color Image Suite, which Kodak released for unrestricted use (the same set `fixtures/kodak.js` downloads).
- `noto-emoji_u1f34e.png`: the red apple emoji (U+1F34E, 128×128, anti-aliased edges) from Google's Noto Emoji 2.047, https://github.com/googlefonts/noto-emoji, licensed under the Apache License 2.0.
