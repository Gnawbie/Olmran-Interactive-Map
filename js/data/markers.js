// Points of interest (banks, shops, healers, etc.). Populate once marker
// meanings are defined. Coordinates are [x, y] in the SOURCE IMAGE's pixel
// space (origin top-left), same space the coordinate picker reports.
//
// {
//   name: "Kaid Local Bank",
//   type: "bank",            // used for filter chips + icon label
//   layer: "land-of-kaid",   // must match an id in layers.js
//   x: 1234,
//   y: 567,
//   description: "Optional longer text shown in the popup."
// }
const MARKERS = [];
