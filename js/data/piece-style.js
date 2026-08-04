// The flat gray background every room-grid piece image was originally
// rendered on (confirmed identical across all four realms) before it was
// stripped to transparent. Kept here so anything that needs to render
// behind a piece (the realm-builder canvas, the future composite viewer)
// can match it, and so the split-piece tool knows what counted as
// "background" before pieces were made transparent.
const PIECE_BACKGROUND_COLOR = "#bdbdbd"; // rgb(189, 189, 189)
