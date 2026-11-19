# Rekonvia self-hosted fonts

Downloaded unchanged from the Google Fonts CDN on 19 November 2026. These normal-style variable WOFF2 subsets load locally; the application does not contact Google Fonts at runtime. The complete SIL Open Font License 1.1 and copyright notices accompany each family.

| File | Family | CSS weight range | Subset | SHA-256 |
|---|---|---|---|---|
| `inter-latin.woff2` | Inter | 400–600 | Latin | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` |
| `inter-latin-ext.woff2` | Inter | 400–600 | Latin extended | `34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956` |
| `plus-jakarta-sans-latin.woff2` | Plus Jakarta Sans | 600–700 | Latin | `153fc85b70298beeb1d61a5f723331649e7f23bb77302a66e61cb3e2fbdb5e79` |
| `plus-jakarta-sans-latin-ext.woff2` | Plus Jakarta Sans | 600–700 | Latin extended | `38e3b8fd8045048eb311d90170a4429ed2c8f405852dc3d91b5af8452758703f` |

Use `font-style: normal`, `font-display: swap`, and the ranges below in each `@font-face` so the browser requests an extended subset only when its characters occur. Other writing systems and italic styles use the system fallback.

```css
/* Latin, both families */
unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
/* Latin extended, both families */
unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF;
```

Sources:

- [Google Fonts CSS2 response](https://fonts.googleapis.com/css2?family=Inter:wght@400..600&family=Plus+Jakarta+Sans:wght@600..700&display=swap), requested with a modern Chromium user agent.
- Inter v20 CDN: [Latin](https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2), [Latin extended](https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2).
- Plus Jakarta Sans v12 CDN: [Latin](https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yw.woff2), [Latin extended](https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko40yyygA.woff2).
- [Inter upstream](https://github.com/rsms/inter), [Google Fonts distribution/license](https://github.com/google/fonts/tree/main/ofl/inter); local license: `inter-OFL.txt`.
- [Plus Jakarta Sans upstream](https://github.com/tokotype/PlusJakartaSans), [Google Fonts distribution/license](https://github.com/google/fonts/tree/main/ofl/plusjakartasans); local license: `plus-jakarta-sans-OFL.txt`.
