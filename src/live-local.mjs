// 로컬 실시간 시세. 이 PC에서만 쓴다.
// 국내: 홍대현 Universe 로컬 서버(127.0.0.1:8848)가 키움 실시간 체결을 중계하는 소켓을 받아 쓴다.
//       키움에 직접 또 접속하지 않으므로 키를 따로 둘 필요가 없고 Universe의 실시간 연결을 건드리지 않는다.
// 해외와 기준값: 네이버 일괄 시세를 서버에서 주기적으로 받는다(브라우저 직접 호출은 막혀 있다).
// Universe 서버가 꺼져 있으면 국내도 네이버 주기 조회 값으로 떨어진다.
import { fetchRealtime, fetchIndexRealtime } from "./naver.mjs";
import { round } from "../public/lib/calc.js";
import { krxDate } from "../public/lib/sector-index.js";
import { isNxtPremarket, quoteMarket } from "../public/lib/quote-status.js";

// 네이버 기준 시세(base)에 키움 체결(tick)을 덧씌운다. 체결이 더 새로울 때만 쓰고,
// 등락률은 네이버 값에서 되짚은 전일 종가 대비로 다시 계산한다. 거래대금과 장 상태는 네이버 값을 유지한다.
export function composeQuote(base, tick) {
  if (!base) return null;
  const newer = tick && tick.p > 0 && Date.parse(tick.at) > Date.parse(base.at);
  if (!newer) return { ...base, src: "naver" };
  const previousClose = base.previousClose ?? (base.chg != null && base.p > 0 ? base.p / (1 + base.chg / 100) : null);
  const cap = tick.cap > 0 ? tick.cap : base.cap != null ? round((base.cap * tick.p) / base.p, 1) : null;
  return {
    p: tick.p,
    chg: previousClose ? round((tick.p / previousClose - 1) * 100, 2) : base.chg,
    cap, capKrw: cap, tv: base.tv, at: tick.at, st: base.st, src: "kiwoom",
    ...(base.previousClose > 0 ? { previousClose } : {}),
  };
}

export class LocalLive {
  constructor({ universe, sectorCodes = [], feedUrl = "ws://127.0.0.1:8848/ws/quotes", pollMs = 10000, log = () => {} }) {
    this.stocks = universe.stocks;
    this.domestic = this.stocks.filter((stock) => stock.kind === "KR");
    this.overseas = this.stocks.filter((stock) => stock.kind === "GL");
    this.domesticCodes = new Set(this.domestic.map((stock) => stock.code));
    this.sectorCodes = sectorCodes.filter((code) => !this.domesticCodes.has(code));
    this.sectorBase = null;
    this.sectorUpdatedAt = 0;
    this.sectorPollAt = 0;
    this.sectorPolling = false;
    this.feedUrl = feedUrl;
    this.pollMs = pollMs;
    this.log = log;
    this.base = {};       // id -> 네이버 정규화 시세
    this.nxtPre = {};
    this.ticks = {};      // 국내 종목코드 -> { p, cap, at } (키움, KRX)
    this.idx = {};
    this.rev = 0;
    this.naver = { at: null, error: null };
    this.marketSuccessAt = {};
    this.feed = { status: "disconnected", connectedAt: null, lastAt: null, count: 0 };
  }

  start() {
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.pollMs);
    this.connectFeed();
  }

  stop() {
    clearInterval(this.pollTimer);
    clearTimeout(this.retryTimer);
    this.stopped = true;
    try { this.socket?.close(); } catch { /* 이미 닫힘 */ }
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    const absorb = (stocks, quotes) => {
      const collectedAt = new Date().toISOString();
      for (const stock of stocks) {
        const quote = quotes[stock.code];
        if (!quote || !(quote.p > 0) || !Number.isFinite(Date.parse(quote.at))) continue;
        const { nxtPre, ...base } = quote;
        this.base[stock.id] = base;
        if (nxtPre) this.nxtPre[stock.id] = nxtPre;
        else delete this.nxtPre[stock.id];
        this.marketSuccessAt[quoteMarket(stock)] = collectedAt;
      }
      this.rev += 1;
    };
    const jobs = [
      fetchRealtime("KR", this.domestic.map((stock) => stock.code), { includeNxtPreMarket: true })
        .then((quotes) => absorb(this.domestic, quotes)),
      fetchRealtime("GL", this.overseas.map((stock) => stock.code)).then((quotes) => absorb(this.overseas, quotes)),
      fetchIndexRealtime("KR", ["KOSPI", "KOSDAQ"]).then((quotes) => { Object.assign(this.idx, quotes); }),
      fetchIndexRealtime("GL", [".IXIC"]).then((quotes) => { if (quotes[".IXIC"]) this.idx.IXIC = quotes[".IXIC"]; }),
    ];
    const results = await Promise.allSettled(jobs);
    this.polling = false;
    const failed = results.filter((result) => result.status === "rejected");
    this.naver.error = failed.length ? failed[0].reason.message : null;
    if (failed.length === 0) {
      this.naver.at = new Date().toISOString();
      this.rev += 1;
    }
  }

  connectFeed() {
    if (this.stopped) return;
    const retry = () => {
      this.feed.status = "disconnected";
      clearTimeout(this.retryTimer);
      if (!this.stopped) this.retryTimer = setTimeout(() => this.connectFeed(), 15000);
    };
    let socket;
    try {
      socket = new WebSocket(this.feedUrl);
    } catch {
      retry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.feed.status = "connected";
      this.feed.connectedAt = new Date().toISOString();
      this.log("키움 중계(Universe) 연결");
    };
    socket.onmessage = (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      const quote = payload?.type === "quote" ? payload.quote : null;
      if (!quote || !this.domesticCodes.has(quote.code)) return;
      const krx = quote.venues?.KRX;   // 가격 기준은 KRX. 넥스트레이드 체결은 쓰지 않는다.
      if (!(krx?.price > 0)) return;
      const previous = this.ticks[quote.code];
      // Universe가 중계하는 값: price는 원, marketCap은 억원(키움 실시간 항목 311), observedAt은 ISO 시각.
      this.ticks[quote.code] = { p: krx.price, cap: krx.marketCap ?? null, at: krx.observedAt };
      this.feed.lastAt = new Date().toISOString();
      this.feed.count += 1;
      if (!previous || previous.p !== krx.price) this.rev += 1;
    };
    socket.onerror = () => { try { socket.close(); } catch { /* 닫는 중 */ } };
    socket.onclose = () => {
      if (this.feed.status === "connected") this.log("키움 중계 끊김, 15초 뒤 재연결");
      retry();
    };
  }

  feedActive(now = Date.now()) {
    return this.feed.status === "connected" && this.feed.lastAt != null && now - Date.parse(this.feed.lastAt) < 120000;
  }

  domesticQuote(id, now) {
    const base = this.base[id], tick = this.ticks[id];
    const useTick = this.feedActive(now) && now - Date.parse(tick?.at) < 120000
      && krxDate(tick.at) === krxDate(base?.at);
    return composeQuote(base, useTick ? tick : null);
  }

  // 비교 종목은 1D를 보고 있을 때만 요청하고, 여러 탭에서 열어도 수집 주기는 공유한다.
  sectorSnapshot(now = Date.now()) {
    if (!this.sectorPolling && now - this.sectorPollAt >= this.pollMs) {
      this.sectorPollAt = now;
      this.sectorPolling = true;
      fetchRealtime("KR", this.sectorCodes, { attempts: 1 })
        .then((quotes) => {
          this.sectorBase = quotes;
          this.sectorUpdatedAt = Date.now();
        })
        .catch((error) => this.log(`비교 섹터 시세 수집 실패: ${error.message}`))
        .finally(() => { this.sectorPolling = false; });
    }
    if (!this.sectorBase || now - this.sectorUpdatedAt > 60000) return null;
    const quotes = { ...this.sectorBase };
    for (const stock of this.domestic) {
      const quote = this.domesticQuote(stock.id, now);
      if (quote) quotes[stock.code] = quote;
    }
    const indices = { KOSPI: this.idx.KOSPI, KOSDAQ: this.idx.KOSDAQ };
    return { quotes, indices };
  }

  // 화면이 읽는 live.json. 배포본의 live 브랜치 파일과 같은 모양이다.
  snapshot() {
    const q = {};
    const nxtPre = {};
    const marketSuccessAt = { ...this.marketSuccessAt };
    const now = Date.now();
    const showNxt = isNxtPremarket(now);
    let fromKiwoom = 0;
    for (const stock of this.stocks) {
      const quote = stock.kind === "KR" ? this.domesticQuote(stock.id, now) : this.base[stock.id];
      if (!quote) continue;
      if (quote.src === "kiwoom") {
        fromKiwoom += 1;
        if (!marketSuccessAt.KR || Date.parse(quote.at) > Date.parse(marketSuccessAt.KR)) marketSuccessAt.KR = quote.at;
      }
      q[stock.id] = [quote.p, quote.chg, quote.cap, quote.capKrw, quote.tv, quote.at, quote.st, quote.src || "naver"];
      const pre = showNxt && quote.st !== "OPEN" ? this.nxtPre[stock.id] : null;
      const at = Date.parse(pre?.at);
      if (isNxtPremarket(at) && at > now - 50 * 60000 && at <= now + 5000) {
        nxtPre[stock.id] = pre;
      }
    }
    const seconds = Math.round(this.pollMs / 1000);
    return {
      asOf: new Date().toISOString(),
      marketSuccessAt,
      rev: this.rev,
      source: this.feedActive() && fromKiwoom > 0 ? `국내 키움 실시간, 해외 네이버 ${seconds}초` : `네이버 금융 ${seconds}초 갱신`,
      feed: { ...this.feed, active: this.feedActive(), stocks: fromKiwoom },
      naver: this.naver,
      q, idx: this.idx,
      ...(Object.keys(nxtPre).length ? { nxtPre } : {}),
    };
  }
}
