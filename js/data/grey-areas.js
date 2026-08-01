// Traced polygon areas that render as a flat semi-transparent grey tint,
// regardless of the underlying map pixels (unlike BOUNDARY_AREAS, which only
// recolors white pixels). Drawn with the same freeform point-tracing tool
// as boundary areas -- see "Draw grey area" in the dev panel.
// { layer, points: [[x,y], ...] }
const GREY_AREAS = [];
