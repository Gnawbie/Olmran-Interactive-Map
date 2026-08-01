// Individual amenity markers placed by dragging a badge onto the map in the
// dev "Tag amenities — drag onto a room" tool. Independent of
// ZONE_AMENITIES (zone-level tags) — these are precise point locations, e.g.
// the exact room a shop or bank sits in. Coordinates are in the source
// image's pixel space (origin top-left), same space the coordinate picker
// reports.
//
// { type: "hospital", layer: "land-of-kaid", x: 1234, y: 567 }
const AMENITY_POINTS = [
  { type: "shop", layer: "olmran-evil", x: 2455, y: 1597 },
  { type: "repair", layer: "olmran-evil", x: 2487, y: 1597 },
  { type: "shop", layer: "olmran-evil", x: 1929, y: 1411 },
  { type: "hospital", layer: "olmran-evil", x: 994, y: 689 },
  { type: "shop", layer: "olmran-evil", x: 1030, y: 687 },
  { type: "hospital", layer: "olmran-evil", x: 604, y: 1031 },
  { type: "shop", layer: "olmran-evil", x: 844, y: 1030 },
  { type: "hospital", layer: "olmran-evil", x: 533, y: 2176 },
  { type: "shop", layer: "olmran-evil", x: 1440, y: 2227 },
  { type: "hospital", layer: "olmran-evil", x: 1674, y: 2893 },
  { type: "repair", layer: "olmran-evil", x: 1674, y: 2929 },
  { type: "shop", layer: "olmran-evil", x: 2100, y: 2834 },
  { type: "hospital", layer: "olmran-evil", x: 2636, y: 2852 },
  { type: "safe", layer: "olmran-evil", x: 4783, y: 3340 },
  { type: "hospital", layer: "olmran-evil", x: 5063, y: 3261 },
  { type: "shop", layer: "olmran-evil", x: 4370, y: 3807 },
  { type: "hospital", layer: "olmran-evil", x: 4243, y: 3118 },
  { type: "shop", layer: "olmran-evil", x: 4134, y: 3504 },
  { type: "shop", layer: "olmran-evil", x: 4394, y: 2124 },
  { type: "shop", layer: "olmran-evil", x: 4271, y: 2253 },
  { type: "good-boat", layer: "olmran-evil", x: 2790, y: 3000 },
  { type: "chaos-boat", layer: "olmran-evil", x: 2806, y: 2999 },
  { type: "kaid-boat", layer: "olmran-evil", x: 2979, y: 3544 },
  { type: "evil-realm-boat", layer: "olmran-evil", x: 3016, y: 3544 },
  { type: "airship", layer: "olmran-evil", x: 2837, y: 3155 },
  { type: "shop", layer: "olmran-evil", x: 1290, y: 863 },
  { type: "hospital", layer: "olmran-evil", x: 1277, y: 864 },
  { type: "repair", layer: "olmran-evil", x: 1301, y: 864 },
  { type: "hospital", layer: "olmran-evil", x: 3056, y: 3295 },
  { type: "bank", layer: "olmran-evil", x: 2801, y: 3327 },
  { type: "shop", layer: "olmran-evil", x: 2819, y: 3327 },
  { type: "repair", layer: "olmran-evil", x: 2782, y: 3327 },
  { type: "safe", layer: "olmran-evil", x: 3041, y: 3295 },
  { type: "trainer", layer: "olmran-evil", x: 3023, y: 3296 },
  { type: "trainer", layer: "olmran-evil", x: 2993, y: 3645 }
];
