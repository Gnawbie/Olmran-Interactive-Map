// Individual amenity markers placed by dragging a badge onto the map in the
// dev "Tag amenities — drag onto a room" tool. Independent of
// ZONE_AMENITIES (zone-level tags) — these are precise point locations, e.g.
// the exact room a shop or bank sits in. Coordinates are in the source
// image's pixel space (origin top-left), same space the coordinate picker
// reports.
//
// { type: "hospital", layer: "land-of-kaid", x: 1234, y: 567 }
const AMENITY_POINTS = [
  { type: "evil", layer: "land-of-kaid", x: 2458, y: 3830 },
  { type: "chaos", layer: "land-of-kaid", x: 1774, y: 2636 },
  { type: "good", layer: "land-of-kaid", x: 3770, y: 2208 }
];
