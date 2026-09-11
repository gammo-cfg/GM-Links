# GAMMO Signal Hub

A high-impact, dependency-free personal link hub for **GAMMO**.

Live target: https://way-cfg.github.io/waylinks/

## Design direction

The site intentionally avoids the common "rounded glass cards on a gradient" link-in-bio aesthetic. It uses an editorial / creative-developer visual system instead: oversized typography, asymmetric layout, hard rules, kinetic interaction, an original realtime WebGL signal field, platform-reactive color, and a compact HUD.

## Highlights

- Original raw-WebGL animated signal field with no framework or graphics dependency
- Responsive editorial layout and oversized kinetic typography
- Platform-reactive color system for GitHub, YouTube, Twitch and Kick
- Desktop cursor follower and parallax interactions
- Optional layout-grid easter egg (`G`)
- Motion toggle (`M`) with local preference persistence
- Native Share API with clipboard fallback
- `prefers-reduced-motion` support
- Keyboard-accessible interactions and semantic navigation
- WebGL DPR cap and visibility pausing for performance
- SEO / Open Graph / structured metadata
- No build step; deploy directly to GitHub Pages

## Project structure

```text
waylinks/
├── assets/
│   └── avatar.jpg
├── index.html
├── app.js
├── style.css
├── site.webmanifest
├── robots.txt
├── sitemap.xml
└── README.md
```

## Local preview

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.


## Background audio

The site includes a looping local MP3 at `assets/background-music.mp3`. First-run volume is 20%. Visitors can adjust or mute it from the SOUND control, and their preference is stored locally in the browser. Because modern browsers block audible autoplay, playback begins on the first user interaction when needed.
