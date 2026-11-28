"""Reconstruct a KOSDAQ close from the dated KRX listing and regular-session quotes."""
import csv
from datetime import datetime, timedelta, timezone
import io
import json
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen

LISTING = "https://raw.githubusercontent.com/FinanceData/fdr_krx_data_cache/master/data/listing/kosdaq"
QUOTES = "https://finance.daum.net/api/quotes"
SOURCE = "krx-listing-daum-close"
KST = timezone(timedelta(hours=9))


def fetch(url):
    headers = {"User-Agent": "Mozilla/5.0"}
    if url.startswith(QUOTES + "?"):
        headers["Referer"] = "https://finance.daum.net/"
    with urlopen(Request(url, headers=headers), timeout=15) as response:
        return response.read()


def integer(value):
    if isinstance(value, str) and value.isascii() and value.isdigit():
        return int(value)
    if type(value) is int or (type(value) is float and value.is_integer()):
        return int(value)
    raise ValueError("Missing or non-integer quote field")


def closing_caps(day, market_cap, *, request=fetch, now=None):
    """Return exact KRW amounts only after the whole dated market reconciles."""
    local = (now or datetime.now(KST)).astimezone(KST)
    if day > local.date().isoformat() or (day == local.date().isoformat() and local.hour < 16):
        return {}
    listing = {}
    payload = request(f"{LISTING}/{day}.csv").decode("utf-8-sig")
    for row in csv.DictReader(io.StringIO(payload)):
        code = row["Code"]
        shares, price = integer(row["Stocks"]), integer(row["Close"])
        if (row["MarketId"] != "KSQ" or not re.fullmatch("[A-Z0-9]{6}", code)
                or code in listing or min(shares, price) <= 0
                or integer(row["Marcap"]) != shares * price):
            raise ValueError("Invalid KOSDAQ listing")
        listing[code] = (shares, price, integer(row["Volume"]))
    if not listing:
        raise ValueError("Empty KOSDAQ listing")

    caps = {}
    codes = list(listing)
    for start in range(0, len(codes), 80):
        batch = codes[start:start + 80]
        symbols = ",".join("A" + code for code in batch)
        quotes = json.loads(request(QUOTES + "?" + urlencode({"symbolCodes": symbols})))
        if not isinstance(quotes, list) or len(quotes) != len(batch):
            raise ValueError("Incomplete KOSDAQ close batch")
        for quote in quotes:
            symbol = quote["symbolCode"]
            code = symbol[1:]
            if (not symbol.startswith("A") or code not in batch or code in caps
                    or quote["market"] != "KOSDAQ" or quote["date"] != day
                    or quote["marketStatus"] != "CLOSING"):
                raise ValueError("Unexpected security, session or date in closing quotes")
            shares, listing_price, volume = listing[code]
            if integer(quote["listedShareCount"]) != shares:
                raise ValueError("Listed share counts disagree")
            price = quote.get("regularTradePrice")
            if price is None:
                # A suspended stock can have no trade and no regular-session print.
                if volume != 0 or integer(quote["accTradeVolume"]) != 0 or integer(quote["tradePrice"]) != listing_price:
                    raise ValueError("Unconfirmed regular-session closing price")
                price = listing_price
            price = integer(price)
            if price <= 0:
                raise ValueError("Invalid closing price")
            caps[code] = shares * price
    if caps.keys() != listing.keys() or sum(caps.values()) != market_cap:
        raise ValueError("Stock caps do not reconcile with the closing KOSDAQ market cap")
    return caps
