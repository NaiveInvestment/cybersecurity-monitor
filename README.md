# 사이버보안 모니터

국내외 사이버보안 상장사의 시세, 시가총액, 분기 실적을 한 표로 보고, 해킹 사례와 정책, 기업의 보안 지출을 따라가는 정적 사이트.

- 종목 페이지: 국내 35종목, 해외 36종목. 현재가, 시가총액, 기간 수익률, 최근 분기 매출과 직전 4개 분기 합계, PSR, PER
- 뉴스 페이지: 1차 출처를 확인해 정리한 카드(`data/curated/cards.json`)와 자동 수집 헤드라인

## 구조

| 경로 | 역할 |
|---|---|
| `universe.json` | 종목 정본. 국내는 종목코드, 해외는 네이버 코드(`reuters`), 분야 태그 |
| `public/` | 화면. 빌드 도구 없는 HTML, CSS, ES 모듈 |
| `public/lib/calc.js` | 화면과 수집기가 함께 쓰는 계산(수익률 기준가, TTM, PSR, PER) |
| `src/naver.mjs` | 네이버 금융 수집기(일괄 시세, 일봉, 분기 재무). 키 불필요 |
| `src/news.mjs` | RSS 파싱, 키워드 분류, 중복 제거, 종목명 매칭 |
| `scripts/build-data.mjs` | `data/snapshot.json` 생성 |
| `scripts/fetch-news.mjs` | `data/news.json` 생성(이전 보관분과 병합, 180일 보존) |
| `scripts/build-site.mjs` | `_site/` 조립 |
| `scripts/live-poller.mjs` | 장중 60초 시세를 `live` 브랜치 `live.json`으로 푸시 |
| `scripts/verify-site.mjs` | 조립된 사이트의 채움률, 정합성, 금지 문자 검사 |

## 실행

```
npm run build     # 스냅샷 + 헤드라인 + 사이트 조립 (_site/)
npm run serve     # http://127.0.0.1:8895/
npm test          # 단위 테스트
node scripts/verify-site.mjs _site
```

로컬 빌드는 실시간 폴링을 끈 스냅샷 화면이다. `node scripts/build-site.mjs --live owner/repo`로 켤 수 있다.

## 배포와 갱신

- `deploy.yml`: main 푸시와 3시간 간격으로 스냅샷, 헤드라인을 다시 받아 GitHub Pages에 배포. 헤드라인 보관분과 직전 스냅샷은 `data` 브랜치에 둔다
- `live-poller.yml`: 아시아장 08:55~15:40 KST, 미국장 22:25~06:10 KST에 60초 간격으로 `live` 브랜치를 갱신. 화면은 75초마다 이를 읽어 시세를 덧씌운다
- 수집이 실패하거나 채움률이 직전의 절반 아래로 떨어지면 빌드가 실패해 직전 배포가 유지된다

## 데이터 기준

- 출처는 네이버 금융. 수익률은 수정주가 종가 대비, 52주 고점은 종가 기준
- 실적은 확정 분기만 사용. 4개 분기가 이어지지 않으면 TTM을 만들지 않는다. 결측은 `-`로 두고 채우지 않는다
- 해외 영업이익은 EBIT, 순이익은 당기순이익. PER은 직전 4개 분기 순이익 기준이며 0 이하이면 `N/M`
- 원화 환산은 네이버의 원화 환산 시가총액에서 얻은 현재 환율을 쓴다

## 카드 갱신

`data/curated/cards.json`에 카드를 추가하고 main에 푸시한다. 숫자와 날짜는 1차 출처를 직접 열어 확인하고, 계획과 확정과 집행을 `status`로 구분한다. 분모가 다른 숫자는 합치지 않는다.
