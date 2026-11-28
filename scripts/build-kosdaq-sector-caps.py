"""Aggregate screened biotech and robotics stocks' KRX closing caps within KOSDAQ."""
import argparse
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from shutil import copyfileobj
from urllib.request import urlopen

import duckdb

from kosdaq_closing import SOURCE, closing_caps

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = "https://raw.githubusercontent.com/FinanceData/marcap/master/data"


def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def baskets(additions):
    configured = read_json(ROOT / "data/sector-membership.json", {})
    bio = next(group for group in configured["groups"] if group["id"] == "bio")
    robot = read_json(ROOT / "data/kosdaq-robot-membership.json", {})
    return {
        group["id"]: {
            **group,
            "stocks": group["stocks"] + additions["groups"][group["id"]],
        }
        for group in (bio, robot)
    }


def aggregate(path, expected, codes):
    with duckdb.connect() as db:
        rows = db.execute("""
            SELECT Date::DATE::VARCHAR, SUM(Marcap)::BIGINT, COUNT(*),
                   COUNT(DISTINCT Code), COUNT(Marcap), MIN(Marcap),
                   SUM(Marcap) FILTER (WHERE list_contains(?, Code))::BIGINT,
                   COUNT(*) FILTER (WHERE list_contains(?, Code)),
                   SUM(Marcap) FILTER (WHERE list_contains(?, Code))::BIGINT,
                   COUNT(*) FILTER (WHERE list_contains(?, Code))
            FROM read_parquet(?)
            WHERE MarketId = 'KSQ' AND list_contains(?, Date::DATE::VARCHAR)
            GROUP BY Date::DATE
        """, [codes["bio"], codes["bio"], codes["robot"], codes["robot"],
              str(path), list(expected)]).fetchall()
    results = {}
    for day, market, count, distinct, present, minimum, bio, n_bio, robot, n_robot in rows:
        if market != expected[day] or not count == distinct == present or minimum < 0:
            continue
        caps = {
            key: {"cap": cap, "count": size}
            for key, cap, size in (("bio", bio, n_bio), ("robot", robot, n_robot))
            if cap is not None and 0 < cap <= market and 0 < size <= len(codes[key])
        }
        if caps:
            results[day] = {"date": day, "marketCap": market, "caps": caps}
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--archive-dir", type=Path, help="Read a local copy of the annual KRX parquet files.")
    args = parser.parse_args()
    additions = json.loads((ROOT / "data/kosdaq-sector-additions.json").read_text(encoding="utf-8"))
    groups = baskets(additions)
    codes = {key: sorted({stock["code"] for stock in group["stocks"]}) for key, group in groups.items()}
    metadata = {key: {field: group[field] for field in ("name", "reference", "asOf", "source")}
                for key, group in groups.items()}
    membership = hashlib.sha256(json.dumps(codes, sort_keys=True).encode()).hexdigest()
    market = read_json(args.market, {})
    cached = read_json(args.out, {})
    days = {}
    if market.get("market") == "KOSDAQ" and market.get("unit") == "억원" and market.get("bars"):
        start = date.fromisoformat(market["asOf"]) - timedelta(days=370)
        days = {bar["date"]: round(bar["cap"] * 100_000_000)
                for bar in market["bars"] if bar["date"] >= start.isoformat()}

    prior = {}
    if cached.get("membership") == membership:
        if not days:
            print("KOSDAQ index data unavailable; retained the previous sector caps")
            return
        prior = {row["date"]: row for row in cached["bars"]
                 if days.get(row["date"]) == row["marketCap"] and set(row["caps"]) == set(groups)}
    pending = {}
    # Revisit same-day observations until the dated annual archive confirms or replaces them.
    for day in days:
        if day in prior and prior[day].get("source") != SOURCE:
            continue
        pending.setdefault(day[:4], {})[day] = days[day]
    with TemporaryDirectory() as tmp:
        for year, expected in sorted(pending.items()):
            name = f"marcap-{year}.parquet"
            path = (args.archive_dir or Path(tmp)) / name
            try:
                if not args.archive_dir:
                    with urlopen(f"{ARCHIVE}/{name}", timeout=30) as source, path.open("wb") as out:
                        copyfileobj(source, out)
                prior.update(aggregate(path, expected, codes))
            except (OSError, duckdb.Error) as exc:
                print(f"KOSDAQ sector cap {year}: {exc}")

    latest = max(days, default=None)
    if latest and latest not in prior and not args.archive_dir:
        try:
            stocks = closing_caps(latest, days[latest])
            if stocks:
                caps = {}
                for key, members in codes.items():
                    included = [stocks[code] for code in members if code in stocks]
                    if not included:
                        raise ValueError(f"No closing stocks for {key}")
                    caps[key] = {"cap": sum(included), "count": len(included)}
                prior[latest] = {"date": latest, "marketCap": days[latest], "caps": caps, "source": SOURCE}
        except (OSError, ValueError, KeyError, TypeError) as exc:
            print(f"KOSDAQ same-day close {latest}: {exc}")

    rows = [prior[day] for day in sorted(prior)]
    result = {"market": "KOSDAQ", "unit": "원", "membership": membership, "revision": additions["revision"],
              "baskets": metadata, "asOf": rows[-1]["date"] if rows else None, "bars": rows}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    staged = args.out.with_suffix(".tmp")
    staged.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    staged.replace(args.out)
    print(f"KOSDAQ sector caps: {len(rows)}/{len(days)} sessions, through {result['asOf']}")


if __name__ == "__main__":
    main()
