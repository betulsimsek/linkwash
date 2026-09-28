# Rule catalog notice

`clearurls-data.min.json` is the unmodified ClearURLs rule catalog, downloaded from
https://rules2.clearurls.xyz/data.minify.json (source: https://github.com/ClearURLs/Rules).

Copyright © Kevin Röbert and the ClearURLs contributors. Licensed under the GNU Lesser
General Public License v3.0 (`LICENSE-LGPL-3.0.txt`, which supplements `COPYING-GPL-3.0.txt`).

`providers.js`, `dnr_rules.json` and `build-info.json` are generated from that catalog by
`scripts/build-rules.mjs` and are distributed under the same license. You can replace the
catalog with any other ClearURLs-format file and rebuild with `npm run build`.

Linkwash is not affiliated with or endorsed by the ClearURLs project.

`linkwash-extra.json` and `EXTRA.md` are Linkwash's own additions (MIT), not part of the ClearURLs catalog. They are merged into the generated files at build time.
