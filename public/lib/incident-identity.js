// 금융기관, EU 기관처럼 한국어와 영어권 기사에서 서로 다른 이름으로 불리는 경우.
const aliases = [
  ["jpmorgan", /(?:\bJ\.?\s?P\.?\s?Morgan\b|\bChase(?: Bank)?\b|(?:JP|제이피)모[건간]|체이스)/i],
  ["eu-commission", /EU\s*(?:집행위|집행위원회)|유럽\s?연합\s?집행위|(?:European|EU) (?:Commission|executive(?: branch)?)\b/i],
  ["kpmg", /\bKPMG\b/i], ["binance", /\bBinance\b|바이낸스/i],
  ["gyeonggi-education", /경기(?:도)?\s*교육청/],
  ["fbi", /(?:\bFBI\b|연방수사국)(?=.{0,22}(?:해킹|범죄|침입|공격|데이터베이스|cyber[ -]?attack|hack|breach|database))|(?:breach|hack|cyber[ -]?attack)(?: of| on| at| targeting) (?:the )?FBI\b/i],
  ["fsi", /금융보안원|금보원/],
  ["chainflip", /\bChainflip\b|체인플립/i],
  ["kurly", /컬리|\bKurly\b/i],
  ["caring", /케어링/],
  ["rakuten-securities", /라쿠텐\s*증권|Rakuten Securities/i],
  ["coindcx", /\bCoinDCX\b|코인DCX/i],
  ["tfl", /Transport for London|\bTfL\b/i],
  ["uber", /\bUber\b|우버/i],
  ["jeonju-university", /전주대/],
  ["savings-bank-training", /KG\s?에듀원|저축(?:은행|銀).{0,20}(?:직원|교육사이트)/i],
  ["busan-research", /부산.{0,22}(?:산학협력단|연구비\s?시스템)/],
];
const incidentDetails = {
  kpmg: /client (?:tax )?(?:documents|files|data)|고객.{0,12}(?:세금|문서|자료)|^회계법인 KPMG 해킹 피해$/i,
  uber: /drivers?|운전자|운전면허|fireworks|파이어웍스|\b(?:149,346|150,000)\b|15만/i,
  tfl: /oyster|오이스터/i,
  jpmorgan: /vendors?|third[ -]party|협력업체|외부\s?업체|서비스\s?업체/i,
  "gyeonggi-education": /교원\s*158|158\s*명.{0,8}교원|사교육업체.{0,15}(?:계약|비위)/,
  fbi: /NCIC|criminal (?:justice|information)|(?:crime|criminal|FBI.{0,12}) database|범죄(?:자|정보|망)|트럼프|부정선거|Trump|second cyber[ -]?attack/i,
  fsi: /금융사.{0,14}(?:보안평가|직원.{0,5}정보|정보\s*유출)|850여\s*건/,
  chainflip: /(?:vault|볼트|4\.86\s*(?:m|million)|486만)/i,
  kurly: /큐레이터|주민(?:등록)?번호|계좌번호|1만.{0,6}(?:명|건)|1만여|1만명|1만건/,
  caring: /돌봄|건강정보|어르신/,
  "rakuten-securities": /accounts?|test server|테스트|계좌/i,
  coindcx: /Plotline|협력사.{0,16}(?:무단 접근|이메일)/i,
  binance: /192 (?:types|cryptocurrencies)|freez(?:ing|e) order|frozen (?:funds|tokens)|abu dhabi|launder|coinjoin|\b(?:hacker|stolen funds) (?:mixes|moves)|동결|자금세탁|\$6\.(?:3|43) ?(?:billion|b\b)|6[34]억.{0,10}달러/i,
  "eu-commission": /AI|인공지능/i,
  "jeonju-university": /18만|온라인\s?교육|학습\s?관리/,
  "savings-bank-training": /교육\s?사이트|교육\s?업체|에듀원|직원.{0,10}(?:정보|실명)/,
  "busan-research": /산학협력단|연구비\s?시스템/,
};
// 제목에 기관이 여럿이면 피해 기관과 중계 경로가 한 사건을 잇는 것을 피한다.
export function incidentIdentity(title) {
  const matches = aliases.filter(([, pattern]) => pattern.test(title));
  if (matches.length !== 1) return null;
  const name = matches[0][0];
  const detail = incidentDetails[name]?.test(title) || false;
  const brief = !detail && /^(?:["'‘“][^"'’”]{1,12}["'’”]\s*)?(?:금융보안원|금보원)(?:까지|도)?\s*(?:해킹당했다|뚫렸다|털렸다)[.!…\s]*$/.test(title);
  return { name, detail, brief };
}
