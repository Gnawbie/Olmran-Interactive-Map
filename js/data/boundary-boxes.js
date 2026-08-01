// Rectangular boundary boxes whose white pixels get recolored to a Kaid
// gear tier (Green/Red/Purple), drawn via the dev "Draw Boundary Box" tool.
// White needs no recoloring, so it's not offered as an option there.
// Coordinates are in the source image's pixel space (origin top-left);
// x1/y1 is the top-left corner, x2/y2 is the bottom-right corner.
//
// { tier: "green", layer: "land-of-kaid", x1: 100, y1: 200, x2: 400, y2: 600 }
const BOUNDARY_BOXES = [];
