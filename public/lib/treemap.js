// 값에 비례한 넓이의 사각형으로 영역을 빈틈없이 채운다(squarified treemap).
// 입력 순서대로 왼쪽 위부터 놓는다. 큰 값부터 넘기면 칸이 정사각형에 가까워진다.
// 0 이하인 값의 자리는 null이다.
export function treemap(values, width, height) {
  const out = values.map(() => null);
  const items = values.map((value, index) => ({ index, value })).filter(item => item.value > 0);
  if (!items.length || !(width > 0 && height > 0)) return out;
  const scale = width * height / items.reduce((sum, item) => sum + item.value, 0);
  // 한 줄에 놓인 칸 가운데 가장 길쭉한 칸의 가로세로비
  const worst = (sum, min, max, side) => Math.max(side * side * max / (sum * sum), sum * sum / (side * side * min));
  let x = 0, y = 0, w = width, h = height, start = 0;
  while (start < items.length) {
    const side = Math.min(w, h);
    let end = start, sum = 0, min = Infinity, max = 0, best = Infinity;
    while (end < items.length) {
      const area = items[end].value * scale;
      const next = worst(sum + area, Math.min(min, area), Math.max(max, area), side);
      if (end > start && next > best) break;
      sum += area;
      min = Math.min(min, area);
      max = Math.max(max, area);
      best = next;
      end++;
    }
    const thick = sum / side;
    let offset = 0;
    for (let i = start; i < end; i++) {
      const length = items[i].value * scale / thick;
      out[items[i].index] = w >= h
        ? { x, y: y + offset, width: thick, height: length }
        : { x: x + offset, y, width: length, height: thick };
      offset += length;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    start = end;
  }
  return out;
}
