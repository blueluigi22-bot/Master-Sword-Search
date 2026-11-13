# Master Sword Search 3.0

Puts Google's own Ocarina of Time Master Sword Easter egg on every Google web search. Version 3 replaces the hand-made SVG art, CSS warp and synthesized sound from version 2 with the actual files and timings Google uses.

## Install in Chrome

1. Extract the ZIP to a permanent folder, or use the supplied master-sword-search folder.
2. Open chrome://extensions in Chrome.
3. Disable the old Master Sword Search extension to avoid two copies running.
4. Turn on Developer mode at the upper right.
5. Click Load unpacked and select the folder containing manifest.json.
6. Refresh your Google search tab. Try an ordinary search such as coffee, then click the sword at the bottom right.

For an existing unpacked installation, you can instead replace its files, click Reload on its extension card, and refresh your Google tabs. Keep the unpacked folder in place while using the extension.

## Use

Click the sword to plunge it and enter the 1998 page; click again or press Esc to return. Search fields, result links, and paging work. The selected era persists in the same tab and Google domain across refreshes and new searches. On the modern page the sword ducks away after you scroll down 150px and comes back when you scroll up, as Google's does.

The extension popup controls enable/disable, sound, and whether Zelda searches are left to Google's own Easter egg. With that option off, this sword replaces Google's on those searches, so only one shows.

Works on All and Web results. Images, Shopping, News, AI Mode, and other special views are left alone. Supports the original 15 www.google domains: .com, .ca, .co.uk, .com.au, .co.nz, .ie, .co.in, .co.jp, .de, .fr, .es, .it, .nl, .com.br, .com.mx.

## What comes from Google's Easter egg

All files load at run time from `https://www.gstatic.com/delight/srp/oot/`. None are included in this package.

| Part | Files |
| --- | --- |
| Sword and pedestal, modern and 1998 | `MasterSword-2026.png`, `MasterSword-1998.png`, `Stand-2026.png`, `Stand-1998.png` |
| Portal glow (36-frame sprite) | `BGGlow-370x348-12fps-36f.png` |
| Time warp | `TransitionTile.2.png`, `Triforce-Yellow.png`, `BlueParticle.png` |
| 1998 logo | `1998_lm.png` |
| Plunging the sword | `AdultLink.mp3`, then `ReturnMS.mp3` at 350 ms |
| Pulling the sword | `DrawMS.mp3` and `YoungLink.mp3` together |
| Time warp sound | `TimeWarp.mp3` |

These follow Google's code:

- The sword's slide-in, bob, plunge keyframes, and glow fade.
- The warp: scrolling tile, Triforce, and rising particles drawn on a full-page canvas for 3.5 seconds, with the page swapping at the 2-second peak. A plunge starts the warp 450 ms after the click.
- The 1998 page's layout, colors, and fonts.
- How results are read, so only organic results appear, with readable source lines.

## Differences from Google's

- It runs on every search, not only Zelda ones, and your era survives reloads and new searches.
- It keeps the Result Page links and an Esc shortcut. Reduced-motion settings skip the warp animation.
- The stats line shows the real result range. Google's joke "approximately 1,998" results and fixed search time are left out, and the footer explains how to return instead of showing Google's 1998 copyright line.
- The 1998 page is always in light mode.

## If Google removes the files

The Easter egg is promotional, so Google may take these files down at any time. Like Google's own egg, the sword only appears once its images have loaded, so if they go away the sword will stop appearing and the console will log a warning naming the file. Modern Google is not affected.

## Sharing

Keep this for personal use. The art and audio belong to Google and Nintendo. This package holds no copies of them, but a public release that reuses them, such as a Chrome Web Store listing, would still need their permission.

## Privacy

Titles, snippets, and destinations are read locally and never sent anywhere. On pages where the sword is active, the browser requests the files above from gstatic.com, Google's own static file host; there are no analytics or other network requests. Searches and links navigate normally. Only the storage permission is requested; content access is restricted to listed Google search pages. Preferences use Chrome sync storage; the era uses the tab's session storage.

Unofficial fan extension. Not affiliated with Google or Nintendo.
