# Land of Kaid — Interactive Map

A pannable, zoomable interactive map viewer for the Land of Kaid game world.

## Features

- Pan/zoom over the full-resolution map image (Leaflet, `CRS.Simple`)
- Search box that jumps to any named zone or marker
- Filter chips to show/hide marker types (once markers are defined)
- Layer dropdown to switch between map images (currently just the overworld;
  add more region maps in `js/data/layers.js`)
- Built-in coordinate picker ("Dev: Pick Coords") for adding new zones/markers —
  toggle it on, click anywhere on the map, and it logs `{layer, x, y}` as JSON
  in the bottom panel

## Running locally

This is a static site — no build step. Serve the folder with any static
file server, e.g.:

```
python -m http.server 8080
```

then open `http://localhost:8080`.

(Opening `index.html` directly via `file://` won't work in most browsers
because the data files are loaded as scripts relative to the page — a local
server avoids any path issues.)

## Project structure

```
index.html
css/style.css        toolbar, popups, marker pin styling
js/app.js             map setup, search, filters, coordinate picker
js/data/layers.js      map image definitions (id, name, image, width, height)
js/data/zones.js       named regions used by search ("jump to zone")
js/data/markers.js     points of interest (banks, shops, healers, etc.)
maps/                  source map images
```

## Adding markers

`js/data/markers.js` is currently empty — marker meanings (what B, S, h, etc.
stand for in-game) haven't been defined yet. To add one:

1. Open the site, click "Dev: Pick Coords", click the spot on the map.
2. Copy the `{x, y}` it logs.
3. Add an entry to `MARKERS` in `js/data/markers.js`:

```js
{
  name: "Kaid Local Bank",
  type: "bank",
  layer: "land-of-kaid",
  x: 1234,
  y: 567,
  description: "Optional longer text shown in the popup."
}
```

The `type` field drives both the filter chips and the marker icon letter.

## Adding a new region map

1. Drop the image into `maps/`.
2. Add an entry to `MAP_LAYERS` in `js/data/layers.js` with its pixel
   width/height.
3. It shows up automatically in the layer dropdown.
