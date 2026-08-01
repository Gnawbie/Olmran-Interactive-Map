// Amenity types shown as badges on zones that have them. "safe" (Safe Area)
// has no confirmed icon on the source map yet (see zone-amenities.js) — add
// zones to ZONE_AMENITIES once that symbol is identified.
const AMENITY_TYPES = [
  { id: "hospital", label: "Hospital", symbol: "H", color: "#e0615c" },
  { id: "bank", label: "Bank", symbol: "B", color: "#e0b64c" },
  { id: "shop", label: "Shop", symbol: "S", color: "#5c9ee0" },
  { id: "repair", label: "Repair", symbol: "R", color: "#9a9a9a" },
  { id: "safe", label: "Safe Area", symbol: "✓", color: "#5cc26a" },
  { id: "evil", label: "Evil Starting Area", symbol: "E", color: "#d92b2b" },
  { id: "good", label: "Good Starting Area", symbol: "G", color: "#2b6fd9" },
  { id: "chaos", label: "Chaos Starting Area", symbol: "C", color: "#2bb84a" },
  { id: "zone-white", label: "White Zone", symbol: "●", color: "#f0f0f0" },
  { id: "zone-green", label: "Green Zone", symbol: "●", color: "#4ade56" },
  { id: "zone-red", label: "Red Zone", symbol: "●", color: "#d92b2b" },
  { id: "zone-purple", label: "Purple Zone", symbol: "●", color: "#9b59d6" }
];
