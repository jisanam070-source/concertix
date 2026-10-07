import test from "node:test";
import assert from "node:assert/strict";
import { mapGenre } from "../scripts/songkick/genres.mjs";

test("maps first matching songkick genre", () => {
  assert.equal(mapGenre(["indie_alternative", "rock"]), "indie");
  assert.equal(mapGenre(["rock", "indie_alternative"]), "rock");
  assert.equal(mapGenre(["funk_soul"]), "jazz");
  assert.equal(mapGenre(["hip_hop"]), "hiphop");
  assert.equal(mapGenre(["techno"]), "electronic");
  assert.equal(mapGenre(["country"]), "acoustic");
  assert.equal(mapGenre(["classical"]), "acoustic");
});

test("unknown or missing genre falls back to indie", () => {
  assert.equal(mapGenre(["comedy"]), "indie");
  assert.equal(mapGenre([]), "indie");
  assert.equal(mapGenre(undefined), "indie");
});
