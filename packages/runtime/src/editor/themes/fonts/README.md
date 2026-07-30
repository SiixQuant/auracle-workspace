# Bundled UI typeface

The app ships its own UI face so the chrome renders identically on every
platform and with no network fetch. Before this, `--font-family-ui` was a bare
system stack, which meant the UI was SF Pro on macOS, Segoe on Windows and
whatever `sans-serif` resolved to elsewhere.

## Files

| File                       | Size   | Family       | Axis          |
| -------------------------- | ------ | ------------ | ------------- |
| `Geist-Variable.woff2`     | 68 KB  | `Geist`      | `wght 100..900` |
| `GeistMono-Variable.woff2` | 70 KB  | `Geist Mono` | `wght 100..900` |

138 KB total. These are the **variable** upright faces: one file each covers the
whole weight range, which is smaller than shipping the four static weights the
UI actually uses (400/500/600/700) and lets any weight be requested later
without adding another file.

Italics are deliberately not bundled. No UI chrome in this app sets
`font-style: italic`, and the two italic files would have doubled the payload.
`font-synthesis` is left at `none` in the theme, so if italics are ever needed
the italic file must be added here rather than slanted by the renderer.

## Source and version

- Upstream: <https://github.com/vercel/geist-font>
- Release: `v1.7.2` (`geist-font-v1.7.2.zip`, sha256
  `7fc800d2ac6b92844895196e5041aca55d814c15db70c44f79b3b83ab82b04e2`)
- In-font version strings: Geist `Version 1.800`, Geist Mono `Version 1.700`
- Original names in the release archive were `Geist[wght].woff2` and
  `GeistMono[wght].woff2`. They are renamed here only to keep square brackets
  out of asset paths and bundler glob patterns; the bytes are unmodified.

Vendored as files rather than added as an npm dependency so the build stays
plain and the licence travels with the fonts.

## Licence

SIL Open Font License 1.1 — see `OFL.txt`, copied verbatim from the release.
Copyright 2024 The Geist Project Authors.

OFL permits bundling and redistribution inside this application. The two
conditions that matter here: the licence file must ship alongside the fonts
(it does), and the fonts must not be sold on their own (they are not). If a
font file is ever *modified*, OFL requires it be renamed — hence the note above
that these bytes are unmodified despite the filename change.

## Numerals

This product is mostly figures in columns, so the digit metrics matter:

- **Geist Sans proportional digits are not uniform width** (advances run
  384–663 units). Anything that puts numbers in a column must therefore set
  `font-variant-numeric: tabular-nums`, which is already the house rule and is
  what panelkit's `numeric` style does.
- Under `tnum`, Geist Sans digits are all 600/1000 em.
- Geist Mono digits are 600/1000 em natively, so Sans-with-`tnum` and Mono
  figures share one advance width and line up against each other.
- Geist Mono's default zero carries an inner mark distinguishing it from `O`
  (the font names its *optional* stylistic set "Non-slashed zero", i.e. marked
  is the default). Do not enable that set.
