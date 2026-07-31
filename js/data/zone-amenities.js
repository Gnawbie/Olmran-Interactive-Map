// Maps a zone name (must match a name in zones.js) to the amenity ids present
// there (see amenities.js). Populated by reading the Hospital(H)/Bank(B)/
// Shop(Sb)/Repair(Sm) icon boxes visible on the source map, at native tile
// resolution. "Sm" is the Repair icon, not a shop subtype. No "safe area"
// icon was identifiable anywhere on the map — add entries here (or via the
// dev drag-and-drop tagging tool) once that symbol is known.
const ZONE_AMENITIES = {
  "Elven Nation Border": ["hospital"],
  "Cave of Fury": ["hospital"],
  "Town of Green Hills": ["hospital"],
  "Village of Al'nomi": ["shop", "hospital", "bank", "repair"],
  "Freehold": ["shop", "hospital", "bank", "repair"],
  "Buccaneer's Den": ["shop", "hospital", "bank", "repair"],
  "Temple of Ahrimal": ["hospital"],
  "Peaks of Ahrimal": ["hospital"],
  "Vale Fort": ["hospital"],
  "Azurlago Village": ["hospital"],
  "Thousand Falls": ["hospital"],
  "Cerngild, Lost City of Gold": ["hospital"],
  "Religious Quarters (Imperial City)": ["hospital"],
  "Military Quarters (Imperial City)": ["repair", "hospital"],
  "Field of Sorrow": ["hospital"]
};
