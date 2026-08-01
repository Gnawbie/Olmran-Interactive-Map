# Reference data

`Olmran_Kaid_Equipment_and_Stats.xlsx` — a Kaid-only cut of the community
equipment/stats spreadsheet (originally `Olmran Community Eq and Stats List
(2).xlsx`, which covers all four realms: Chaos, Evil, Good, Kaid).

## What was removed

- Whole sheets that were entirely about another realm: **Chaos Maps**,
  **Chaos Hunting Guide**, **Evil Maps**, **Evil Hunting Guide**, **Good
  Maps**, **Good Hunting Guide**. **Kaid Maps** was kept.
- Rows tagged `Chaos`, `Evil`, `Good`, or `Crafted - Chaos/Good/Evil` in the
  `Realm` column of: **Equipment**, **Enchant & Craft Mats**, **MobList**,
  **Gear Tier Guide**, **Spells**, **Scribe List**.

## What was kept

- Everything tagged with a Kaid realm value (`Kaid`, `Kaid Green`, `Kaid
  Purple`, `Kaid Red`, `Kaid White`).
- Realm-agnostic categories that aren't tied to a specific area: `Crafted`,
  `Event`, `Glory Bea`, and blank/unlabeled rows (e.g. Training Academy).
- Sheets that aren't realm/area-specific to begin with (Class Stats, Skills,
  Siegecraft, Fortifications, Crafting Recipes, Gemcutting, Experience,
  Extra Info, Misc, Best Kaid Gear).
- **Realm & Class Titles** was left untouched — it's a Chaos/Evil/Good realm
  rank-title table with no Kaid equivalent in the source data, so there was
  no "Kaid area" to filter it down to.

## Heads up

The **Spells** sheet ended up with only 1 leftover row — the source data has
zero Kaid-tagged spell entries (spells there are only ever tagged Chaos,
Evil, or Good). If Kaid has its own spell list somewhere, it isn't in this
column, and this sheet is basically empty now.

---

`Olmran_EvilGoodChaos_Equipment_and_Stats.xlsx` — the mirror image of the
file above: a Kaid-*removed* cut of `Item List 2.xlsx` (the same underlying
community spreadsheet), covering Chaos, Evil, and Good only.

### What was removed

- Whole sheets that were entirely about Kaid: **Kaid Maps**, **Best Kaid
  Gear**.
- Rows tagged `Kaid`, `Kaid Green`, `Kaid Purple`, `Kaid Red`, or `Kaid White`
  in the `Realm` column of: **Equipment**, **Enchant & Craft Mats**,
  **MobList**, **Gear Tier Guide**, **Spells**, **Scribe List**.

### What was kept

- Everything tagged `Chaos`, `Evil`, `Good`, or `Crafted - Chaos/Good/Evil`.
- Realm-agnostic categories: `Crafted`, `Event`, `Glory Bea`, blank rows.
- Sheets that aren't realm-specific to begin with, plus **Chaos/Evil/Good
  Maps** and **Chaos/Evil/Good Hunting Guide**.
- **Realm & Class Titles** was left untouched (no Kaid column to remove).

### Heads up

- Zone names were pulled from the **Equipment** sheet's `Area` column, only
  (rows tagged `Class`, `Crafted`, `Obsolete`, or blank were excluded — those
  aren't real locations). A few obvious typo/capitalization duplicates were
  merged: `Island of MIngo` → `Island of Mingo`, `Fields of Mo'serat` →
  `Fields of Mo'Serat`, `Shrouded Castle of Craebean` → `Shrouded Castle of
  Craebaen` (standardized on the spelling used elsewhere, e.g. "Shrouded
  City/Forest of Craebaen").
- The Evil/Good/Chaos maps are brand new and have never been walked with the
  coordinate picker, so all 151 zones pulled from this file were added to
  `zones.js` at their map's center as a placeholder, ready to be repositioned
  one at a time with the existing **Dev: Pick Coords → Re-center zone on
  click** tool. Until that happens, "jump to zone" for any of them will just
  center on the same spot each time.
