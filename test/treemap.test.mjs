import test from "node:test";
import assert from "node:assert/strict";
import { treemap } from "../public/lib/treemap.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

test("칸 넓이는 값에 비례하고 전체 영역을 겹침 없이 채운다", () => {
  const values = [1350, 348, 313, 229, 209, 193, 144, 141, 114, 97, 89, 21, 19];
  const width = 640, height = 400;
  const tiles = treemap(values, width, height);
  const total = values.reduce((sum, value) => sum + value, 0);
  tiles.forEach((tile, i) => {
    close(tile.width * tile.height, values[i] / total * width * height);
    assert.ok(tile.x >= -1e-6 && tile.y >= -1e-6 && tile.x + tile.width <= width + 1e-6 && tile.y + tile.height <= height + 1e-6);
  });
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    const a = tiles[i], b = tiles[j];
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    assert.ok(overlapX < 1e-6 || overlapY < 1e-6, `${i}와 ${j} 겹침`);
  }
  // 가장 큰 값이 왼쪽 위에서 시작한다.
  close(tiles[0].x, 0);
  close(tiles[0].y, 0);
});

test("길쭉한 칸을 피한다", () => {
  const tiles = treemap([6, 6, 4, 3, 2, 2, 1], 600, 400);
  for (const tile of tiles) assert.ok(Math.max(tile.width / tile.height, tile.height / tile.width) < 3.1);
});

test("0 이하인 값과 빈 영역은 자리를 만들지 않는다", () => {
  assert.deepEqual(treemap([0, -1], 100, 100), [null, null]);
  assert.deepEqual(treemap([1, 2], 0, 100), [null, null]);
  const tiles = treemap([2, 0, 2], 100, 50);
  assert.equal(tiles[1], null);
  close(tiles[0].width * tiles[0].height, 2500);
  close(tiles[2].width * tiles[2].height, 2500);
});
