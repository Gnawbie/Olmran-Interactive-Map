// Amenity types shown as badges on zones that have them. "repair" and "safe"
// have no confirmed icon on the source map yet (see zone-amenities.js) — add
// zones to ZONE_AMENITIES once those symbols are identified.
const AMENITY_TYPES = [
  { id: "hospital", label: "Hospital", symbol: "H", color: "#e0615c" },
  { id: "bank", label: "Bank", symbol: "B", color: "#e0b64c" },
  { id: "shop", label: "Shop", symbol: "S", color: "#5c9ee0" },
  { id: "repair", label: "Repair", symbol: "R", color: "#9a9a9a" },
  { id: "safe", label: "Safe Area", symbol: "✓", color: "#5cc26a" }
];
