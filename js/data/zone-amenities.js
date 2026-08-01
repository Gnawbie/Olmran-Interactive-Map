// Maps a zone name (must match a name in zones.js) to the amenity ids present
// there (see amenities.js).
//
// Hospital(H)/Bank(B)/Shop(Sb)/Repair(Sm) tags were read directly off the
// source map's icon boxes, at native tile resolution. "Sm" is the Repair
// icon, not a shop subtype.
//
// zone-white/green/red/purple tags come from reference/Olmran_Kaid_
// Equipment_and_Stats.xlsx ("Equipment" sheet, Realm/Area columns), which
// lists which named zones contain rooms of each gear tier. Some zones
// (e.g. Field of Sorrow) have rooms of more than one tier, so they carry
// multiple zone-* tags — this is zone-level ("this area has some White
// rooms and some Green rooms"), not room-by-room precision. For exact
// pathway boundaries, use the dev "Trace tier path" tool instead, which
// draws real overlays at hand-picked coordinates.
//
// A few spreadsheet area names use different spellings than the map/zones.js
// (e.g. "Terngild" -> Cerngild, "Kercpa Lair" -> Kerpea Lair, "Azulago
// Village" -> Azurlago Village, "Timetold Range" -> Cimetold Range, "Ruins
// of Helk" -> Ruins of Belh, "Dunes of Al'kafi" -> Dunes of Al'Rafi) — these
// were matched by hand assuming they refer to the same in-game location.
//
// No "safe area" icon was identifiable anywhere on the map — add zones here
// (or via the dev drag-and-drop tagging tool) once that symbol is known.
const ZONE_AMENITIES = {
  "Elven Nation Border": ["hospital", "zone-purple"],
  "Cave of Fury": ["hospital"],
  "Clockwork": ["zone-red"],
  "Fury Mountains": ["zone-red"],
  "Town of Green Hills": ["hospital", "zone-green"],
  "Riverswift Downs": ["zone-green"],
  "Cimetold Range": ["zone-red"],
  "Green Valley": ["zone-green"],
  "Namm River": ["zone-green", "zone-white"],
  "Fire Valley (North)": ["zone-green", "zone-white"],
  "Fire Valley (South)": ["zone-green", "zone-white"],
  "Ruins of Belh": ["zone-red"],
  "Al'nomi Graveyard": ["zone-white"],
  "Village of Al'nomi": ["shop", "hospital", "bank", "repair", "zone-white"],
  "Kaid Wilderness": ["zone-green", "zone-white"],
  "Plains of Helk": ["zone-green", "zone-white"],
  "Field of Sorrow": ["hospital", "zone-green", "zone-white"],
  "Kaid Local (North)": ["zone-white"],
  "Kaid Local (South)": ["zone-white"],
  "Kerpea Lair": ["zone-red"],
  "Pacific Lowlands": ["zone-green", "zone-white"],
  "Freehold": ["shop", "hospital", "bank", "repair", "zone-white"],
  "Freehold Cemetery": ["zone-white"],
  "Freehold Coast": ["zone-white"],
  "Long John's Hideout": ["zone-green", "zone-white"],
  "Sun Gulf": ["zone-red"],
  "Dire Mountains": ["zone-red"],
  "Vale Fort": ["hospital", "zone-red"],
  "River Valley": ["zone-green"],
  "Azurlago Village": ["hospital", "zone-red"],
  "Planes of Suffering": ["zone-purple"],
  "Buccaneer's Den": ["shop", "hospital", "bank", "repair", "zone-white"],
  "Temple of Ahrimal": ["hospital", "zone-purple"],
  "Peaks of Ahrimal": ["hospital", "zone-green"],
  "Forked Tongue": ["zone-green", "zone-white"],
  "Golem Lake": ["zone-green"],
  "Dunes of Al'Rafi": ["zone-red"],
  "Nahaz Bay": ["zone-green"],
  "Xian Forest": ["zone-red"],
  "Oyster Bay": ["zone-purple"],
  "Tokat Bamboo Forest": ["zone-green"],
  "Nosho Rainforest": ["zone-green"],
  "Thousand Falls": ["hospital", "zone-red"],
  "Cerngild, Lost City of Gold": ["hospital", "zone-purple", "zone-red"],
  "Imperial City of Kaid": ["zone-white"],
  "Religious Quarters (Imperial City)": ["hospital", "zone-green"],
  "Merchant Quarters (Imperial City)": ["zone-green", "zone-white"],
  "Arena (Imperial City)": ["zone-red"],
  "Government Quarters (Imperial City)": ["zone-red"],
  "Emperor's Palace (Imperial City)": ["zone-purple"],
  "Slum Quarters (Imperial City)": ["zone-green"],
  "Military Quarters (Imperial City)": ["repair", "hospital", "zone-green"]
};
