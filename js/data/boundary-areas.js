// Freeform polygon areas whose white pixels get recolored to a Kaid gear
// tier (Green/Red/Purple), drawn via the dev "Draw Boundary Area" tool.
// White needs no recoloring, so it's not offered as an option there.
// Coordinates are in the source image's pixel space (origin top-left).
// The polygon is implicitly closed (the last point connects back to the
// first) — you don't need to click back on the starting point by hand.
//
// { tier: "green", layer: "land-of-kaid", points: [[x,y], [x,y], [x,y], ...] }
const BOUNDARY_AREAS = [];
