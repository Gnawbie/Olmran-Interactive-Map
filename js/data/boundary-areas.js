// Freeform polygon areas whose white pixels get recolored to a Kaid gear
// tier (Green/Red/Purple), drawn via the dev "Draw Boundary Area" tool.
// White needs no recoloring, so it's not offered as an option there.
// Coordinates are in the source image's pixel space (origin top-left).
// The polygon is implicitly closed (the last point connects back to the
// first) — you don't need to click back on the starting point by hand.
//
// { tier: "green", layer: "land-of-kaid", points: [[x,y], [x,y], [x,y], ...] }
const BOUNDARY_AREAS = [
  { tier: "red", layer: "land-of-kaid", points: [[1089, 318], [1031, 463], [1058, 577], [949, 662], [842, 567], [778, 514], [717, 511], [572, 451], [579, 408], [667, 316]] },
  { tier: "purple", layer: "land-of-kaid", points: [[547, 492], [555, 365], [693, 284], [798, 190], [699, 44], [614, 5], [140, 18], [171, 337], [199, 517], [436, 513], [521, 515]] },
  { tier: "red", layer: "land-of-kaid", points: [[235, 660], [245, 523], [441, 517], [507, 516], [546, 539], [572, 545], [556, 624], [435, 685], [857, 667], [872, 1022], [693, 1030], [555, 998], [518, 1049], [455, 1047], [166, 1037]] },
  { tier: "green", layer: "land-of-kaid", points: [[430, 1055], [476, 1052], [583, 1059], [613, 1060], [669, 1063], [683, 1233], [533, 1335], [432, 1341], [319, 1330], [295, 1071]] }
];
