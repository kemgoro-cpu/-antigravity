# Bundled JavaScript libraries

Updated on 2026-10-29. These files are bundled locally; the application does not
load them from a CDN. Downloaded npm archives were checked against the SHA-512
integrity values in the official npm registry metadata before extraction.
Exact versions, artifact URLs, archive integrity and bundled-file SHA-256 hashes
are recorded in `vendor-manifest.json`.

| Library | Version | License | Official release |
|---|---|---|---|
| Apache ECharts | 6.1.0 | Apache-2.0 | https://github.com/apache/echarts/releases/tag/6.1.0 |
| PapaParse | 5.7.0 | MIT | https://github.com/mholt/PapaParse/releases/tag/5.7.0 |

The ECharts bundle and official `theme/v5.js` are unchanged upstream files.
The v5 theme and explicit axis-layout settings preserve the existing viewer's
appearance across the ECharts 5-to-6 upgrade. See the official migration guide:
https://echarts.apache.org/handbook/en/basics/release-note/v6-upgrade-guide/

ECharts 6.1.0 includes the fix for CVE-2026-45249. That issue concerns the Lines
series tooltip under specific conditions; the viewer's ordinary line series is
a different series type. Updating dependencies does not establish that the
application is free of vulnerabilities.

Upstream license and notice files are retained in `licenses/`:

- `echarts-LICENSE.txt`
- `echarts-NOTICE.txt`
- `papaparse-LICENSE.txt`

Existing icon and font assets are unchanged. The bundled Inter font metadata
reports 4.001 and Roboto Mono reports 3.001. Boxicons' font metadata reports 2.0;
this does not identify its distribution package version.

Inter's internal 4.001 numbering is consistent with the official v4.1 release;
Roboto Mono's official release is v3.001. Binary/subset identity was not verified.
Boxicons v3.0.8 changes the icon class conventions and requires a separate UI
migration, so the existing icon font was not replaced in this update.
