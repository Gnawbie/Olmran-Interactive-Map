// Amenity types shown as badges on zones that have them. "safe" (Safe Area)
// has no confirmed icon on the source map yet (see zone-amenities.js) — add
// zones to ZONE_AMENITIES once that symbol is identified.
const AMENITY_TYPES = [
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
