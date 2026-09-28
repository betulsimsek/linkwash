# Linkwash extra rules

`linkwash-extra.json` adds tracking parameters that the ClearURLs catalog does not cover. It uses the same format and is merged into the catalog at build time. Unlike the catalog, this file is MIT-licensed.

Rules for adding a parameter:
- It must be an ad-click, remarketing or analytics identifier.
- It must carry no page state.
- Affiliate/referral IDs are deliberately left out, because removing them takes revenue from creators.

| Parameter(s) | Set by | Purpose |
|---|---|---|
| `ds_rl` | Google Search Ads 360 | Remarketing-list ID added to landing pages ([docs](https://support.google.com/sa360/answer/12501665)) |
| `ds_kid`, `ds_kids`, `ds_cid`, `ds_eid`, `ds_agid`, `ds_a_*`, `ds_e_*`, `ds_url_v`, `ds_dest_url` | Google Search Ads 360 | Keyword, campaign, ad group, engine and device IDs used for click attribution ([docs](https://support.google.com/sa360/answer/9238861)) |
| `gclsrc` | Google Ads | Click source that goes with `gclid` |
| `gbraid`, `wbraid` | Google Ads | Aggregated click IDs used on iOS for app and web conversions |
| `ttclid` | TikTok Ads | Click ID |
| `li_fat_id` | LinkedIn Ads | First-party ad tracking ID |
| `igsh`, `igshid` | Instagram | Share-sheet ID on shared links, tied to the sharing account |
| `epik` | Pinterest Ads | Click ID |
| `rdt_cid` | Reddit Ads | Click ID |
| `sccid` | Snapchat Ads | Click ID |
| `s_kwcid`, `ef_id` | Adobe Advertising | Keyword and click IDs |
| `_kx` | Klaviyo | Email recipient ID on email links |
| `_branch_match_id` | Branch.io | Deep-link attribution ID |
