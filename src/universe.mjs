import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

// universe.json을 화면과 수집기가 쓰는 평평한 목록으로 바꾼다. id는 국내 종목코드, 해외 티커.
export function loadUniverse(path = new URL("../universe.json", import.meta.url)) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const stocks = [
    ...raw.domestic.map((row) => ({
      id: row.code, kind: "KR", code: row.code, name: row.name, market: row.market, country: "KR", cur: "KRW",
      seg: row.seg, desc: row.desc, aliases: [],
      url: `https://m.stock.naver.com/domestic/stock/${row.code}/total`,
    })),
    ...raw.overseas.map((row) => ({
      id: row.symbol, kind: "GL", code: row.reuters, name: row.name, nameEn: row.nameEn, market: row.market,
      country: row.country, cur: row.cur, seg: row.seg, desc: row.desc, aliases: row.aliases || [], finExclude: row.finExclude || null,
      url: `https://m.stock.naver.com/worldstock/stock/${row.reuters}/total`,
    })),
  ];
  const ids = new Set();
  for (const stock of stocks) {
    if (ids.has(stock.id)) throw new Error(`universe.json: 중복 id ${stock.id}`);
    ids.add(stock.id);
    if (!raw.segments.some((segment) => segment.id === stock.seg)) throw new Error(`universe.json: ${stock.id}의 분야 ${stock.seg}가 정의에 없음`);
  }
  return { asOf: raw.asOf, segments: raw.segments, countries: raw.countries, indices: raw.indices, stocks };
}
