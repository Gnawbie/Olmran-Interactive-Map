// Maps a zone name (must match a name in zones.js) to the amenity ids present
// there (see amenities.js). Populated by reading the Hospital(H)/Bank(B)/
// Shop(S) icon boxes visible on the source map, at native tile resolution.
// No "repair" or "safe area" icon was identifiable anywhere on the map — add
// entries here once those symbols are known.
const ZONE_AMENITIES = {
  "Elven Nation Border": ["hospital"],
  "Cave of Fury": ["hospital"],
  "Town of Green Hills": ["hospital"],
  "Village of Al'nomi": ["shop", "hospital", "bank"],
  "Freehold": ["shop", "hospital", "bank"],
  "Buccaneer's Den": ["shop", "hospital", "bank"],
  "Temple of Ahrimal": ["hospital"],
  "Peaks of Ahrimal": ["hospital"],
  "Vale Fort": ["hospital"],
  "Azurlago Village": ["hospital"],
  "Thousand Falls": ["hospital"],
  "Cerngild, Lost City of Gold": ["hospital"],
  "Religious Quarters (Imperial City)": ["hospital"],
  "Military Quarters (Imperial City)": ["shop", "hospital"],
  "Field of Sorrow": ["hospital"]
};
