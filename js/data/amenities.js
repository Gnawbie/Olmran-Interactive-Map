// Amenity types shown as badges on zones that have them. "safe" (Safe Area)
// has no confirmed icon on the source map yet (see zone-amenities.js) — add
// zones to ZONE_AMENITIES once that symbol is identified.
// Legend groups: sets of AMENITY_TYPES (tagged via the "group" field below)
// that render as one collapsible section instead of flat rows. Clicking the
// section header collapses it AND hides every type in the group from the
// map in one action (see renderAmenityLegend); expanding does the reverse.
const AMENITY_GROUPS = [
  { id: "invasion-boats", label: "Invasion Boats" },
  { id: "tickets", label: "Tickets" }
];

const AMENITY_TYPES = [
  // Boat icons. Optional "layers" restricts a type to specific realm maps --
  // Kaid Boat has no "layers" restriction, so it shows on every map (Kaid
  // included). Each realm's own "Realm Boat" T is a different color per
  // map, and Evil/Good/Chaos Boat only show up on the *other two* realms'
  // maps (the boat that takes you there). See renderAmenityLegend/
  // renderAmenityPalette for the filter.
  { id: "kaid-boat", label: "Kaid Boat", symbol: "T", color: "#f4d35e", group: "tickets" },
  { id: "evil-realm-boat", label: "Realm Boat", symbol: "T", color: "#d92b2b", layers: ["olmran-evil"], group: "tickets" },
  { id: "good-realm-boat", label: "Realm Boat", symbol: "T", color: "#2b6fd9", layers: ["olmran-good"], group: "tickets" },
  { id: "chaos-realm-boat", label: "Realm Boat", symbol: "T", color: "#2bb84a", layers: ["olmran-chaos"], group: "tickets" },
  { id: "evil-boat", label: "Evil Boat", symbol: "Be", color: "#f28b82", layers: ["olmran-good", "olmran-chaos"], group: "invasion-boats" },
  { id: "good-boat", label: "Good Boat", symbol: "Bg", color: "#8ab4f8", layers: ["olmran-evil", "olmran-chaos"], group: "invasion-boats" },
  { id: "chaos-boat", label: "Chaos Boat", symbol: "Bc", color: "#81c995", layers: ["olmran-evil", "olmran-good"], group: "invasion-boats" },
  { id: "airship", label: "Airship", symbol: "A", color: "#f0f0f0", layers: ["olmran-evil", "olmran-good", "olmran-chaos"], group: "tickets" },
  { id: "boss", label: "Boss", symbol: "B", color: "#f97316" },
  { id: "hospital", label: "Hospital", symbol: "H", color: "#e0615c" },
  { id: "bank", label: "Bank", symbol: "B", color: "#e0b64c" },
  { id: "shop", label: "Shop", symbol: "S", color: "#5c9ee0" },
  { id: "repair", label: "Repair", symbol: "R", color: "#9a9a9a" },
  { id: "safe", label: "Safe Area", symbol: "✓", color: "#5cc26a" },
  // The zone-* tier types are intentionally excluded from the legend, the
  // map badges, and the drag-tag palette (see renderAmenityLegend,
  // renderAmenityBadges, renderAmenityPalette) — the boundary-area tool now
  // paints actual rooms for these tiers, so a dot badge duplicating that on
  // top would just be clutter. They stay defined here (hidden: true) purely
  // so ZONE_AMENITIES tags still resolve to a color for the Zone Tier
  // Reference panel's swatches.
  { id: "zone-white", label: "White Zone", symbol: "●", color: "#f0f0f0", hidden: true },
  { id: "zone-green", label: "Green Zone", symbol: "●", color: "#4ade56", hidden: true },
  { id: "zone-red", label: "Red Zone", symbol: "●", color: "#d92b2b", hidden: true },
  { id: "zone-purple", label: "Purple Zone", symbol: "●", color: "#9b59d6", hidden: true }
];
