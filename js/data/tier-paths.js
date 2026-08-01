// Colored path overlays showing Kaid's Green/Red/Purple gear tiers, traced
// by hand on top of the map. The source PNG doesn't encode this, and the
// reference spreadsheet (reference/Olmran_Kaid_Equipment_and_Stats.xlsx,
// "Equipment" sheet, Realm/Area columns) only lists which zone NAMES contain
// rooms of each tier, not exact in-zone boundaries — a single named zone can
// contain rooms of more than one tier. White areas are left uncolored (the
// map's default look), so there's no "white" tier to trace here.
//
// { tier: "green", layer: "land-of-kaid", points: [[x,y], [x,y], ...] }
const TIER_PATHS = [];
