# Stability and versioning

Within a major version these don't change:
- the functions, their options and defaults;
- the palettes, weights and mapped images you get for the same input and options (the golden tests pin them, and they are byte-identical from 2.0 to 3.0, with one exception: an OKLab `Palette` passed to `quantizeWithPalette` is now matched in OKLab, see [Migrating](migrating.md));
- the ability to read every clustering an earlier release wrote. The format is versioned: an older release that meets a newer clustering rejects it with an `unsupported-version` error asking you to upgrade, rather than misreading it.

Releases may get faster, add functions, options, error codes and clustering formats; anything that would change what an existing call returns waits for a new major version. Switch over error `code`s with a default branch, since new codes can appear in a minor release. Anything slated for removal is first marked `@deprecated` in the types and keeps working for the rest of that major version.
