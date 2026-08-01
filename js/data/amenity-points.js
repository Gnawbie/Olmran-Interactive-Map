// Individual amenity markers placed by dragging a badge onto the map in the
// dev "Tag amenities — drag onto a room" tool. Independent of
// ZONE_AMENITIES (zone-level tags) — these are precise point locations, e.g.
// the exact room a shop or bank sits in. Coordinates are in the source
// image's pixel space (origin top-left), same space the coordinate picker
// reports.
//
// { type: "hospital", layer: "land-of-kaid", x: 1234, y: 567 }
const AMENITY_POINTS = [];
