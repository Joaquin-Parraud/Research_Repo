# Vendored CSL files

These files are copied unmodified from the Citation Style Language projects. They are licensed
under the [Creative Commons Attribution-ShareAlike 3.0 License](https://creativecommons.org/licenses/by-sa/3.0/)
(CC BY-SA 3.0), as stated in each file's `<rights>` element. Authors and contributors are listed
in each file's `<info>` block.

| File | Source | Revision (`<updated>`) | sha256 |
|---|---|---|---|
| `apa.csl` | <https://github.com/citation-style-language/styles> (`apa.csl`, master), "APA Style 7th edition" by Brenton M. Wiernik, Andrew Dunning et al. | 2026-02-07 | `3917def5fc951b104d64216c3373096042368b9704ba269ca83c14ebaba889fc` |
| `locales-en-US.xml` | <https://github.com/citation-style-language/locales> (master) | 2026-01-10 | `ac864c7c21166b4390d82c31792cdc509400727fa0060b43d8aa17e07f9cb079` |
| `locales-es-ES.xml` | <https://github.com/citation-style-language/locales> (master) | 2026-01-10 | `ae4a12f612be754e54843ba88ae6641eb708647cea164b5b922bb6bf9b21c91f` |

The project citation locale `es` (neutral Spanish) uses `locales-es-ES.xml`, the primary
Spanish dialect in CSL. The narrative in-text variant of the style is derived from `apa.csl` in
memory when the service starts (see `../lib/style.js`); the file on disk is never changed.
