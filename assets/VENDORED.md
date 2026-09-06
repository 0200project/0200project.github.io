# Vendored libraries

Self-hosted so that no visitor's browser contacts a third-party script host.
Each file is byte-identical to the CDN release it was taken from; the hash was
checked against the hash the CDN publishes for that file on 2026-09-06.

| file | version | taken from | integrity | licence |
|---|---|---|---|---|
| gsap.min.js | 3.12.5 | cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js | sha512 matched the cdnjs API | GSAP Standard License (banner inside the file) |
| ScrollTrigger.min.js | 3.12.5 | cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js | sha512 matched the cdnjs API | GSAP Standard License (banner inside the file) |
| lenis.min.js | 1.1.18 | cdn.jsdelivr.net/npm/lenis@1.1.18/dist/lenis.min.js | sha256 matched data.jsdelivr.com | MIT, Copyright (c) darkroom.engineering |

Lenis's MIT licence text: https://github.com/darkroomengineering/lenis/blob/main/LICENSE
GSAP's licence: https://gsap.com/standard-license

To upgrade: download the new release, verify it against the CDN's published
hash the same way, replace the file, bump the ?v= on every page, update this table.
