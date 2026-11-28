"""Weekly coverage of reported attacks in two fixed publisher archives."""
import argparse
import concurrent.futures
import datetime as dt
import html
import json
import re
import sys
import time
from tempfile import NamedTemporaryFile
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

UTC = dt.timezone.utc
KST = dt.timezone(dt.timedelta(hours=9))
DAY = dt.timedelta(days=1)
WEEK = 7 * DAY
ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "data" / "breach-coverage-seed.json"
DAILY = "https://www.dailysecu.com/news/articleList.html"
THN = "https://thehackernews.com/feeds/posts/summary"
UA = "Mozilla/5.0 (compatible; CybersecurityMonitor/1.0; news archive)"
def iso(value):
    return value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
def stamp(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
def read_url(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": UA}), timeout=20) as response:
                return response.read().decode("utf-8")
        except OSError:
            if attempt == 2:
                raise
            time.sleep(1 + attempt)
def thn_window(bounds):
    lo, hi = bounds
    articles = {}
    offset = 1
    while True:
        query = urlencode({"alt":"json","published-min":iso(lo),"published-max":iso(hi),
                           "max-results":150,"start-index":offset,"orderby":"published"})
        feed = json.loads(read_url(THN + "?" + query))["feed"]
        total = int(feed["openSearch$totalResults"]["$t"])
        entries = feed.get("entry", [])
        for entry in entries:
            url = next(a["href"] for a in entry["link"] if a["rel"] == "alternate")
            url = re.sub(r"^http:", "https:", url)
            articles[url] = [iso(stamp(entry["published"]["$t"])), "THN", html.unescape(entry["title"]["$t"]), url]
        if len(articles) >= total:
            return list(articles.values())
        if not entries or offset > total:
            raise ValueError("The Hacker News archive pagination incomplete")
        offset += len(entries)
def hacker_news(start, end):
    windows = []
    lo = start - DAY
    while lo < end:
        hi = min(lo + 9 * DAY, end)
        windows.append((lo, hi))
        lo = hi
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        return [row for rows in pool.map(thn_window, windows) for row in rows]
def dailysecu(start, end):
    rows = {}
    page = 1
    while True:
        query = urlencode({"page":page, "sc_section_code":"S1N2", "view_type":"sm"})
        body = read_url(DAILY + "?" + query)
        parsed = []
        for item in re.findall(r'<li class="altlist-webzine-item"[^>]*>(.*?)</li>', body, re.S):
            heading = re.search(r'<h2 class="altlist-subject">\s*<a[^>]+href="([^"]*idxno=\d+)"[^>]*>(.*?)</a>', item, re.S | re.I)
            if not heading:
                if re.search(r"idxno=\d+", item):
                    raise ValueError("Unrecognized Dailysecu article")
                continue
            dates = re.findall(r'<div class="altlist-info-item">\s*(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s*</div>', item)
            if not dates:
                raise ValueError("Unrecognized Dailysecu publication date")
            month, day, hour, minute = map(int, dates[-1])
            year = end.astimezone(KST).year
            pub = dt.datetime(year,month,day,hour,minute,tzinfo=KST)
            if pub > end + 2 * DAY:
                pub = pub.replace(year=year-1)
            url, title = heading.groups()
            parsed.append([iso(pub), "DS", html.unescape(re.sub(r"<[^>]*>", "", title)).strip(), html.unescape(url)])
        if not parsed or all(r[3] in rows for r in parsed):
            raise ValueError("Dailysecu archive pagination incomplete")
        rows.update((r[3], r) for r in parsed)
        if max(stamp(r[0]) for r in parsed) < start:
            return list(rows.values())
        page += 1
        if page > 200:
            raise ValueError("Dailysecu archive range incomplete")

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        json.dump(value,stream,ensure_ascii=False,separators=(",",":"))
    Path(stream.name).replace(path)
def refresh(previous, end):
    start = end - 125 * DAY
    old_end = stamp(previous["end"]) if previous else start
    resume = max(start, old_end - 2 * DAY)
    if previous and stamp(previous["start"]) > start:
        start = stamp(previous["start"])
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        thn = pool.submit(hacker_news, resume, end)
        daily = pool.submit(dailysecu, resume, end)
        new = thn.result() + daily.result()
    retained = [r for r in (previous or {}).get("articles",[]) if start <= stamp(r[0]) < resume]
    rows = {r[3]:r for r in retained + new if start <= stamp(r[0]) < end}
    return {"start":iso(start), "end":iso(end), "articles":sorted(rows.values())}


BACKGROUND = re.compile(r"최우수상|조찬|weekly recap|ThreatsDay|해킹\s?시도.{0,20}(?:올해|지난해|돌파)|해킹도구 사용.{0,20}탐지|국정감사|과태료|질타|징계 권고|업무정지.{0,16}종료|대응체계 개선|자료 미파기|내부 통제였다|보안성 평가|urges.{0,30}shut down|악성코드 분석 교육|과징금|손해배상|모의\s?(?:해킹|훈련)|가상\s?훈련|참가자 모집|취약점.{0,12}(?:시연|패치 권고)|컨퍼런스|세미나|긴급점검|해킹\s?대회|해킹\s?방어대회|보안\s?해법|예방\s?교육|악용될 수|취약점.{0,9}공개.{0,15}가능|\bcould (?:let|allow|enable|expose)|\bdemonstrate[s]?\b|researchers show|how to (?:prevent|protect|defend)|\bfined?\b.{0,40}(?:breach|leak)", re.I)
ATTACK = re.compile(r"해킹|랜섬웨어.{0,26}(?:피해|공격|감염|강타)|(?:공급망|디도스|피싱|사이버|정부망)\s?공격|사이버\s?사고|침해\s?(?:사고|정황|당해)|무단\s?(?:접근|조회|침입)|정보.{0,10}(?:탈취|유출|털려)|유출.{0,8}(?:확인|발생|신고|판매|확대)|\d[\d,]*(?:만|억)?\s*건\s*유출|(?:계정|인증정보|자료|코드|데이터|저장소).{0,13}(?:탈취|유출|탈취당)|(?:해커|공격자).{0,40}(?:탈취|침투|배포|악용|공격|감염)|\b(?:hacked|breached|compromised|(?:remain(?:s)?|still) offline after (?:a |the )?security incident|(?:steals?|stole) (?:over )?\$[\d.,]+(?:[MB]\b| (?:million|billion))|cyber intrusion|cyber incident|cyberattack|cyberattacks|cyber attack|breach|data breach|ransomware attack|supply.chain attack|data theft|cryptocurrency theft|bitcoin theft|crypto heist|crypto theft|breaches)\b|\b(?:hackers?|attackers?)\b.{0,22}\baccessed\b|\$[\d.,]+ (?:million|billion).{0,25}theft|\b(?:hackers?|attackers?|espionage group)\b.{0,42}\b(?:target|steal|stole|exploit|compromise|breach|infiltrate|deploy|used?|hit|infect|hijack|abuse)s?\b|\b(?:leaked|stolen|exposed)\b.{0,27}\b(?:files|data|records|credentials|accounts|keys|tokens)\b|\b(?:attack|campaign)s?\b.{0,22}\b(?:targets?|infects?|deliver[s]?|steals?|hits?|hijacks?)\b", re.I)
DISCLOSURE = re.compile(r"유출|탈취|정보 노출|노출 가능|하루치|breach|accessed|expos|leak|stole|compromis", re.I)
OUTAGE = re.compile(r"(?:업무|전산망|서비스|가동|운영|생산|진료|결제|시스템)(?:까지|마저|도|이|가|을|를|의|\s)*(?:(?:일부|접속|긴급|전면|일시|장시간)\s*)?(?:중단|마비|먹통)|(?:중단|마비)된\s*(?:업무|서비스|생산)|(?:shuts? down|shut down|halts?|disrupts?|cripples?|suspends?)\s+(?:(?:its|hospital|factory|online|key|IT|network|business|manufacturing)\s+){0,3}(?:services|operations|production|systems)|(?:service|production|network|system)s?\s+(?:outage|halted|disrupted|offline)|shutdown of (?:key |IT )?(?:services|systems)|suspends? cloud backup|takes? (?:some |its )?systems offline|(?:backup|service|network|system)s? (?:remains?|still) offline", re.I)
COMPLEX_SIZE = re.compile(r"(\d[\d,.]*)\s*만\s*(?:(\d+)천)?\s*(?:[\d,]+)?\s*(?:여|개)?\s*(?:명|건|계정)")
KO_SIZE = re.compile(r"(\d[\d,.]*)\s*(억|천만|백만|십만|만|천)?\s*(?:여|여\s*개|개|여\s*건)?\s*(명|건|계정)",re.I)
EN_SIZE = re.compile(r"(\d[\d,.]*)\s*(billion|million|thousand|[bmk])?\s+((?:(?:user|customer|patient|personal|login|stolen|leaked)\s+){0,2}(?:records|accounts|customers|users|people|patients|individuals|credentials|logins|profiles))\b",re.I)
MULT = {"억":1e8,"천만":1e7,"백만":1e6,"십만":1e5,"만":1e4,"천":1e3,
        "billion":1e9,"b":1e9,"million":1e6,"m":1e6,"thousand":1e3,"k":1e3}
def signals(title):
    if BACKGROUND.search(title) or not ATTACK.search(title):
        return None
    severe = []
    theft = re.search(r"\$[\d,.]+ (?:million|billion).{0,35}theft|(?:암호화폐|가상자산|코인|cryptocurrency|crypto|bitcoin|ether).{0,32}(?:탈취|도난|theft|stolen|stole)|(?:stole|stolen|steal|theft|탈취|도난).{0,40}(?:crypto|bitcoin|ether|달러|억원)",title,re.I)
    if (theft or re.search(r"(?:hackers?|attackers?) (?:stole|steal)|(?:steals?|stole) (?:over )?\$[\d.,]+|crypto heist|사이버.{0,12}탈취",title,re.I)) and not re.search(r"동결|압류|몰수|seized?|freez|frozen|recover",title,re.I):
        dollars = re.search(r"(?:US)?\$\s*(\d[\d,.]*)\s*(million|billion|m|b)\b|(\d[\d,.]*)\s*(억|만)\s*달러",title,re.I)
        won = re.search(r"(\d[\d,.]*)\s*억\s*원",title)
        if (dollars and float((dollars[1] or dollars[3]).replace(",","")) * MULT[(dollars[2] or dollars[4]).lower()] >= 1e7) or (won and float(won[1].replace(",","")) >= 100):
            severe.append("거액 탈취")
    if OUTAGE.search(title) and not re.search(r"중단\s?(?:우려|가능성|대비)|could disrupt|(?:botnet|malware|hackers?') operations",title,re.I):
        severe.append("운영 중단")
    for pattern in [COMPLEX_SIZE,KO_SIZE,EN_SIZE]:
        for match in pattern.finditer(title):
            nearby = title[max(0,match.start()-48):match.end()+48]
            if not DISCLOSURE.search(nearby) or re.match(r"\s*(?:넘는|보유|규모의|이용하는)",title[match.end():]):
                continue
            scale = 10000 if pattern is COMPLEX_SIZE else MULT.get((match[2] or "").lower(),1)
            if float(match[1].replace(",","")) * scale >= 100000:
                severe.append("대규모 유출")
                break
    return list(dict.fromkeys(severe))

def summarize(archive):
    end = stamp(archive["end"])
    first = end - 17 * WEEK
    if stamp(archive["start"]) > first:
        raise ValueError("Insufficient coverage for 17 complete weeks")
    weeks = [{"start":iso(first + i * WEEK),"end":iso(first + (i+1)*WEEK),"count":0,"severe":[],"sources":{"THN":0,"DS":0}} for i in range(17)]
    for published, source, title, url in archive["articles"]:
        i = (stamp(published)-first)//WEEK
        if not 0 <= i < len(weeks):
            continue
        flags = signals(title)
        if flags is None:
            continue
        week = weeks[i]
        week["count"] += 1
        week["sources"][source] += 1
        if flags:
            week["severe"].append({"title":title,"url":url,"source":source,"signals":flags})
    return {"asOf":archive["end"],"weeks":weeks}
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--state", type=Path, default=ROOT/"state"/"breach-coverage.json")
    args = parser.parse_args()
    candidates = [json.loads(p.read_text("utf-8")) for p in [SEED,args.state] if p.is_file()]
    base = max(candidates, key=lambda x:x["end"]) if candidates else None
    end = dt.datetime.now(UTC).replace(microsecond=0)
    if not base or end - stamp(base["end"]) >= dt.timedelta(hours=2):
        try:
            base = refresh(base,end)
            write(args.state,base)
        except (OSError,ValueError,KeyError,StopIteration) as err:
            if not base:
                raise
            print("Using last complete archive through",base["end"],str(err),file=sys.stderr)
    write(args.out,summarize(base))
if __name__ == "__main__":
    main()
