// Songkick genre slugs → Concertix's six genre keys.
export const GENRE_MAP = {
  indie_alternative: "indie", pop: "indie",
  electronic: "electronic", dance: "electronic", house: "electronic", techno: "electronic",
  jazz: "jazz", funk_soul: "jazz", blues: "jazz",
  rock: "rock", metal: "rock", punk: "rock",
  hip_hop: "hiphop", rap: "hiphop", rnb: "hiphop",
  folk_blues: "acoustic", country: "acoustic", acoustic: "acoustic", singer_songwriter: "acoustic", classical: "acoustic",
};

export function mapGenre(skGenres) {
  for (const g of skGenres || []) if (GENRE_MAP[g]) return GENRE_MAP[g];
  return "indie";
}
