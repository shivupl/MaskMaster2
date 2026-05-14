## Mask Master

Mask Master is a focused client-side Adobe Express add-on panel for quick clipping masks. It uses browser-native JavaScript and Canvas2D only: no Python service or backend image processing.

## Features

- Upload an image to mask.
- Choose an ellipse, rectangle, rounded rectangle, or uploaded transparent image mask.
- Use a PNG/WebP/SVG-style image with transparency as the mask alpha.
- Drag image content inside the mask, then scroll or pinch directly on the preview to zoom.
- Adjust rotation, mask size, feather, opacity, and invert.
- Add the masked transparent PNG directly to the current Adobe Express page.
- Falls back to downloading the PNG when opened outside Adobe Express.

## Architecture

- `index.html`: compact panel layout.
- `styles.css`: dark panel styling sized for an Adobe Express add-on panel.
- `index.js`: Canvas2D preview, mask rendering, pointer dragging, wheel/pinch zoom, controls, and PNG export.

## Setup

1. To install the dependencies, run `npm install`.
2. To build the application, run `npm run build`.
3. To start the application, run `npm run start`.
