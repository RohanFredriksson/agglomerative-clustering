# Value briefs

A value brief comes before any spec for a new capability (CLAUDE.md "Design review"). It answers one question: **is the built-in worth more than the best recipe, counting what the recipe costs its users?** It is one page, and it can end the work either way: a recipe that is short, safe and as good becomes a guides entry, not a spec; one that is long, slow or easy to get wrong is a case for building.

Not needed for bug fixes, speed work, error messages, docs or internal changes: only for something a user can do afterwards that they couldn't before.

File it as `YYYY-MM-DD-<topic>-brief.md` in this folder, with these sections.

## Who asked

Quote the request and name its source: an issue (link), a person, the maintainer, or an exploratory-round agent (which round, which project). The maintainer asking, with the use case, passes PRINCIPLES test 2. Say plainly if no one asked.

## The symptom

What the user sees or can't do, in the words they would search for (for linear light: "dithered photos come out too light on the panel", not "linear-light mixing"). These words go into the docs, whatever is built.

## The best recipe

The strongest version a user could write outside the library with the published API, **built and measured through the real package** (`dist/index.mjs`), not imagined. Look for transformations that make the library's existing behaviour do the work: encoding inputs so its matching or error carrying acts in another space, cutting a clustering more than once, mapping indices back. Put the script in `bench/spikes/<topic>/` and its output beside it.

Give its code length, its quality on the project's usual measure (Kodak and synthetic images, the bench harness or a spike metric), its speed, and its traps (what a user would get wrong copying it). These are the recipe's costs, paid by every user who needs it; they count against it (PRINCIPLES test 1).

## What a built-in adds over it

With numbers, against the recipe, not against doing nothing:
- quality the recipe can't reach, and why it can't;
- speed (a conversion on the calling thread, a second pass);
- convenience, and the traps it removes.

And what it costs: options and types kept for the whole major version, WebAssembly size, rules users must learn, tests.

Weigh the two lists against each other: which costs users more over the major version, the API or the recipe in every app that needs it?

## Recommendation

One of: **recipe** (document it, test it in `test/recipes.test.js`, record the built-in under ROADMAP "Considered"), **build** (write the spec), or **wait** (record it under "Later, if asked for" with what evidence would reopen it). The maintainer decides.
