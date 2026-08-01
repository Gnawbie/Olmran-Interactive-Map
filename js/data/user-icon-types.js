// Icon types visitors can place themselves from the "My Icons" legend
// section. Placement + notes are stored only in the visitor's own browser
// (localStorage) via USER_ICONS in app.js -- never committed to this repo.
// Each type is scoped to a single realm map: Evil/Chaos/Good icons only
// ever appear (and can only be placed) on their matching layer.
const USER_ICON_TYPES = [
  { id: "IeS", label: "Evil Strength", color: "#d92b2b", layer: "olmran-evil" },
  { id: "IeP", label: "Evil Power", color: "#d92b2b", layer: "olmran-evil" },
  { id: "IeK", label: "Evil Knowledge", color: "#d92b2b", layer: "olmran-evil" },
  { id: "IcS", label: "Chaos Strength", color: "#2bb84a", layer: "olmran-chaos" },
  { id: "IcP", label: "Chaos Power", color: "#2bb84a", layer: "olmran-chaos" },
  { id: "IcK", label: "Chaos Knowledge", color: "#2bb84a", layer: "olmran-chaos" },
  { id: "IgS", label: "Good Strength", color: "#2b6fd9", layer: "olmran-good" },
  { id: "IgP", label: "Good Power", color: "#2b6fd9", layer: "olmran-good" },
  { id: "IgK", label: "Good Knowledge", color: "#2b6fd9", layer: "olmran-good" }
];
