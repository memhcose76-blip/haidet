# PRINOVA — Mobile-first document & card editor

PRINOVA is a browser-based Arabic image editor for preparing photo cards, ID/residence cards, and print layouts. It runs locally inside the browser, uses on-device processing, and keeps the project flow private to the current device.

## Features
- Mobile-first workflow for image placement and print prep
- Drag, resize, rotate, flip, crop, and duplicate cards/images
- Multi-image import and card auto-detection
- Card measurement presets for ID, residence, and passport forms
- Arabic text generation with custom font, size, color, and alignment
- Local filters, brightness/contrast/saturation controls
- Paper presets and custom paper sizing
- Export to PNG and browser print / PDF workflow
- Local autosave using IndexedDB
- Camera scan flow for supported browsers

## Run locally
1. Open the project folder in a static web server.
2. Use any of the following:
   - Python: `python -m http.server 8000`
   - Node (if installed): `npx serve .`
3. Open `http://localhost:8000` in the browser.

## Files
- `index.html` — main app structure and modal panels
- `style.css` — responsive UI system and dark luxury theme
- `script.js` — editor logic, state, export, layouts, and interactions
- `advanced.js` — scanner and smart card-detection tools

## Notes
- The app works fully on-device; no external upload is required.
- Camera access requires HTTPS or localhost and user permission.
- Some advanced detection actions are local computations and may perform better on simpler or well-lit card images.

## Browser support
Works best in modern Chromium-based browsers and current Safari/Firefox builds with media capture support.
