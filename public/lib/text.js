// 제목 비교용 순수 함수. 수집기(Node)와 화면이 함께 쓴다.

export const titleKey = (title) => String(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function bigrams(text) {
  const key = titleKey(text);
  const set = new Set();
  for (let index = 0; index < key.length - 1; index += 1) set.add(key.slice(index, index + 2));
  return set;
}

// 문자 2-gram 자카드 유사도. 한글 제목에서도 어순이 조금 달라진 같은 기사를 잡는다.
export function similarity(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}
