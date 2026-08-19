#!/usr/bin/env python3
"""
usage-rate.py — Visual Studio Harness token usage rate analyzer.

Answers: "how many tokens per hour do I burn when I'm actually active?"
Reads the production SQLite DB (default: the OS config data dir) READ-ONLY,
buckets every turn by the hour it started, then reports tokens per active
clock-hour, per active day, per span hour, and per hour of turn-runtime.

Data source (production), resolved the same way as _backend/src/paths.ts:
    $XDG_CONFIG_HOME/visual-studio-harness/visual-studio-harness.db
    ~/.config/visual-studio-harness/visual-studio-harness.db   (Linux)
    ~/Library/Application Support/visual-studio-harness/...     (macOS)
    %APPDATA%/visual-studio-harness/...                         (Win)
Overridden by DATA_DIR env var or an explicit path argument.

Token semantics (from _backend/src/db/schema + step-finish-meta):
    gross  = turn.total_tokens (input + output, incl. cached reads) — the
             entire token stream pushed through the provider.
    net    = input - cache_read + output — fresh input + output, i.e. roughly
             what is actually billed (cache reads are discounted to ~zero).

"Active time" definitions:
    active clock-hour : hour bucket containing >= 1 turn
    active day        : calendar day containing >= 1 turn
    span              : first activity -> last activity (total elapsed)
    turn-runtime      : SUM(turns.duration_ms) over non-aborted turns with
                        sane durations (aborted turns left open overnight
                        record bogus multi-hundred-hour duration_ms) — i.e.
                        time the model was actually streaming/generating.

The database is opened mode=ro so production data is never modified or locked.

Examples:
    # Defaults: all turns, UTC buckets, top-8 busiest hours
    python3 scripts/usage-rate.py

    # Your local time for bucketing, successful turns only
    python3 scripts/usage-rate.py --tz America/New_York --status success

    # Filter out hours with only 1 stray turn; show the Top 3; write CSV
    python3 scripts/usage-rate.py --min-turns 2 --top 3 --csv /tmp/usage.csv

    # A different database (e.g. an archived copy)
    python3 scripts/usage-rate.py /path/to/visual-studio-harness.db

    # Machine-readable single-line summary
    python3 scripts/usage-rate.py --quiet
"""

import argparse
import csv
import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo  # Python 3.9+
except ImportError:  # pragma: no cover
    ZoneInfo = None

DB_FILENAME = "visual-studio-harness.db"


# ── path resolution ──────────────────────────────────────────────────────────
def resolve_db_path(explicit: str | None) -> Path:
    """Return the DB path honouring explicit arg, DATA_DIR, then the OS data dir."""
    if explicit:
        p = Path(explicit).expanduser()
        if p.is_dir():
            return p / DB_FILENAME
        return p
    if os.environ.get("DATA_DIR"):
        return Path(os.environ["DATA_DIR"]) / DB_FILENAME
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "visual-studio-harness" / DB_FILENAME


def parse_tz(name: str | None) -> timezone:
    """IANA name or +/-HH:MM offset → tzinfo (default UTC)."""
    if not name:
        return timezone.utc
    name = name.strip()

    # +/-HH[:MM] fixed offset
    if name[0] in "+-" and name[1:].replace(":", "").isdigit():
        digits = name[1:].replace(":", "")
        hours = int(digits[:2])
        minutes = int(digits[2:4] or 0)
        off = timedelta(hours=hours, minutes=minutes)
        return timezone(off if name[0] == "+" else -off)

    if ZoneInfo is not None:
        try:
            return ZoneInfo(name)  # datetime.astimezone accepts zoneinfo
        except Exception:
            pass
    print(f"warning: unknown timezone {name!r}, using UTC", file=sys.stderr)
    return timezone.utc


# ── data loading ────────────────────────────────────────────────────────────
def load_turns(db_path: str, status_filter: set[str] | None) -> list[dict]:
    """Yield turns as dicts, skipping rows with unparseable timestamps."""
    if not Path(db_path).exists():
        raise SystemExit(f"database not found: {db_path}")
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    try:
        cols = [r[1] for r in cur.execute("PRAGMA table_info(turns)")]
    except sqlite3.DatabaseError as e:
        con.close()
        raise SystemExit(f"cannot read database {db_path}: {e}")

    required = {"started_at", "status", "total_tokens", "input_tokens",
                "output_tokens", "cache_read_tokens", "duration_ms"}
    missing = required - set(cols)
    if missing:
        con.close()
        raise SystemExit("turns table missing columns: " + ", ".join(sorted(missing)))

    sql = """SELECT started_at, status,
                    COALESCE(total_tokens, 0)      AS total,
                    COALESCE(input_tokens, 0)      AS inp,
                    COALESCE(output_tokens, 0)     AS out,
                    COALESCE(cache_read_tokens, 0) AS cr,
                    COALESCE(duration_ms, 0)       AS dur,
                    COALESCE(cost_usd, 0)          AS cost
             FROM turns"""
    rows = cur.execute(sql).fetchall()
    con.close()

    recs = []
    for r in rows:
        if status_filter and (r["status"] or "") not in status_filter:
            continue
        recs.append({
            "started": r["started_at"], "status": r["status"],
            "total": r["total"], "inp": r["inp"], "out": r["out"],
            "cr": r["cr"], "dur": r["dur"], "cost": r["cost"],
        })
    return recs


def parse_iso(ts: str) -> datetime:
    """'2026-08-18T19:50:48.975Z' → aware UTC datetime."""
    s = ts.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    if "+" not in s and "Z" not in s:  # no offset → assume UTC
        s += "+00:00"
    return datetime.fromisoformat(s)


# ── analysis ────────────────────────────────────────────────────────────────
def analyze(recs, tz, min_turns: int = 0, date_low=None, date_high=None):
    """Bucket turns by local clock-hour and compute rates. Returns summary dict."""
    parsed = []
    for r in recs:
        try:
            dt = parse_iso(r["started"])
        except ValueError:
            continue
        if date_low and dt.astimezone(tz).date() < date_low:
            continue
        if date_high and dt.astimezone(tz).date() > date_high:
            continue
        parsed.append((dt, r))

    if not parsed:
        return None
    parsed.sort(key=lambda x: x[0])
    first, last = parsed[0][0], parsed[-1][0]

    buckets = defaultdict(lambda: {"turns": 0, "gross": 0.0, "inp": 0.0,
                                   "out": 0.0, "cr": 0.0, "dur": 0.0, "cost": 0.0})
    totals = {"turns": 0, "gross": 0.0, "inp": 0.0, "out": 0.0, "cr": 0.0,
              "dur": 0.0, "cost": 0.0, "success_turns": 0, "runtime_ms": 0.0}

    for dt, r in parsed:
        hour = dt.astimezone(tz).replace(minute=0, second=0, microsecond=0)
        g = buckets[hour]
        g["turns"] += 1
        g["gross"] += r["total"]
        g["inp"] += r["inp"]
        g["out"] += r["out"]
        g["cr"] += r["cr"]
        g["dur"] += r["dur"]
        g["cost"] += r["cost"]

        totals["turns"] += 1
        totals["gross"] += r["total"]
        totals["inp"] += r["inp"]
        totals["out"] += r["out"]
        totals["cr"] += r["cr"]
        totals["dur"] += r["dur"]
        totals["cost"] += r["cost"]
        if r["status"] == "success":
            totals["success_turns"] += 1
        # Streaming/wall-clock time is only trustworthy for non-aborted turns
        # (aborted turns left open overnight record bogus multi-hundred-hour
        # duration_ms) and 1 h is a generous per-turn cap.
        if r["status"] != "aborted" and 0 < r["dur"] <= 3_600_000:
            totals["runtime_ms"] += r["dur"]

    threshold = max(min_turns, 1)
    active_hours = sorted(h for h, g in buckets.items() if g["turns"] >= threshold)
    active_buckets = {h: buckets[h] for h in active_hours}
    active_days = {h.date() for h in active_hours}

    net = totals["inp"] - totals["cr"] + totals["out"]
    active_gross = sum(g["gross"] for g in active_buckets.values())
    active_net = sum(g["inp"] - g["cr"] + g["out"] for g in active_buckets.values())

    span_hours = (last - first).total_seconds() / 3600.0
    runtime_hours = totals["runtime_ms"] / 3_600_000.0

    def rate(num: float, den: float) -> float:
        return num / den if den else 0.0

    return {
        "first": first, "last": last, "span_hours": span_hours,
        "turns": totals["turns"], "success_turns": totals["success_turns"],
        "gross": totals["gross"], "input": totals["inp"], "output": totals["out"],
        "cache_read": totals["cr"], "net": net, "cost_usd": totals["cost"],
        "runtime_hours": runtime_hours,
        "active_hours": len(active_hours), "active_days": len(active_days),
        "tokens_per_hour": {
            "per_active_clock_hour_gross": rate(active_gross, len(active_hours)),
            "per_active_clock_hour_net": rate(active_net, len(active_hours)),
            "per_span_hour_gross": rate(totals["gross"], span_hours),
            "per_span_hour_net": rate(net, span_hours),
            "per_runtime_hour_gross": rate(totals["gross"], runtime_hours),
            "per_runtime_hour_net": rate(net, runtime_hours),
            "per_active_day_gross": rate(totals["gross"], len(active_days)),
            "per_active_day_net": rate(net, len(active_days)),
        },
        "active_hour_list": active_hours,
        "hours": active_buckets,
    }


def fmt(num: float) -> str:
    n = abs(num)
    if n >= 1e9:
        return f"{num/1e9:.2f}B"
    if n >= 1e6:
        return f"{num/1e6:.2f}M"
    if n >= 1e3:
        return f"{num/1e3:.1f}k"
    return f"{num:,.0f}"


# ── output ──────────────────────────────────────────────────────────────────
def print_report(res, tz, top: int, db_path: str):
    t = res["tokens_per_hour"]
    print(f"Database          : {db_path}")
    print(f"Time zone         : {getattr(tz, 'tzname', lambda x: 'UTC')(res['first'])}")
    print(f"First activity    : {res['first'].astimezone(tz).isoformat()}")
    print(f"Last activity     : {res['last'].astimezone(tz).isoformat()}")
    print(f"Span              : {res['span_hours']:,.1f} h  ({res['active_days']} active days, "
          f"{res['active_hours']} active clock-hours)")
    print(f"Turns             : {res['turns']:,} total ({res['success_turns']:,} success)")
    print()
    print("Lifetime tokens")
    print(f"  gross  (input+output, incl cached reads): {fmt(res['gross']):>9}  {res['gross']:,.0f}")
    print(f"  input                                   : {fmt(res['input']):>9}  {res['input']:,.0f}")
    print(f"  output                                  : {fmt(res['output']):>9}  {res['output']:,.0f}")
    print(f"  cache_read                              : {fmt(res['cache_read']):>9}  {res['cache_read']:,.0f}")
    print(f"  net billed (input-cache_read+output)    : {fmt(res['net']):>9}  {res['net']:,.0f}")
    print(f"  cost                                    : ${res['cost_usd']:,.2f}")
    print()
    print("Tokens PER HOUR — when actually active")
    print(f"  per active clock-hour  gross {fmt(t['per_active_clock_hour_gross']):>8}"
          f"   net {fmt(t['per_active_clock_hour_net']):>8}")
    print(f"  per span hour          gross {fmt(t['per_span_hour_gross']):>8}"
          f"   net {fmt(t['per_span_hour_net']):>8}")
    print(f"  per streaming-runtime  gross {fmt(t['per_runtime_hour_gross']):>8}"
          f"   net {fmt(t['per_runtime_hour_net']):>8}")
    print(f"  per active day         gross {fmt(t['per_active_day_gross']):>8}"
          f"   net {fmt(t['per_active_day_net']):>8}")
    if top and res["hours"]:
        lst = sorted(res["hours"].items(), key=lambda kv: kv[1]["gross"], reverse=True)[:top]
        print()
        print(f"Top {top} busiest clock-hours (by gross token stream):")
        print(f"  {'hour (local)':<21}{'turns':>6}{'gross':>13}{'net':>11}{'cache_read':>13}")
        for h, g in lst:
            net = g["inp"] - g["cr"] + g["out"]
            print(f"  {h.isoformat():<21}{g['turns']:>6}{g['gross']:>13,.0f}{net:>11,.0f}{g['cr']:>13,.0f}")
    print()


# ── cli ─────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(
        description="Visual Studio Harness token-usage rate analyzer (read-only)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument("path", nargs="?", default=None,
                    help="DB file or data dir (default: OS data dir)")
    ap.add_argument("--tz", default=None, help="IANA tz or +/-HH:MM offset (default UTC)")
    ap.add_argument("--status", default=None,
                    help="comma-separated statuses to include (success,error,aborted,streaming)")
    ap.add_argument("--min-turns", type=int, default=0, metavar="N",
                    help="ignore clock-hours with fewer than N turns")
    ap.add_argument("--since", default=None, metavar="DATE",
                    help="ignore turns before this date")
    ap.add_argument("--until", default=None, metavar="DATE",
                    help="ignore turns after this date (inclusive)")
    ap.add_argument("--top", type=int, default=8, metavar="N",
                    help="busiest clock-hours to show (0 = none)")
    ap.add_argument("--csv", default=None, metavar="PATH",
                    help="also write per-clock-hour CSV")
    ap.add_argument("--quiet", action="store_true",
                    help="single-line summary only")
    ap.add_argument("--json", action="store_true", help="JSON summary output")
    args = ap.parse_args()

    db_path = resolve_db_path(args.path)
    if not Path(db_path).exists():
        raise SystemExit(f"database not found: {db_path}")

    statuses = None
    if args.status:
        statuses = {s.strip() for s in args.status.split(",") if s.strip()}

    tz = parse_tz(args.tz)
    since = datetime.fromisoformat(args.since).date() if args.since else None
    until = datetime.fromisoformat(args.until).date() if args.until else None

    res = analyze(load_turns(str(db_path), statuses), tz,
                  min_turns=args.min_turns, date_low=since, date_high=until)
    if res is None:
        raise SystemExit("no turns matched the filter")

    if args.csv:
        with open(args.csv, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["hour", "turns", "gross", "net", "input", "output",
                        "cache_read", "cost_usd"])
            for h in res["active_hour_list"]:
                g = res["hours"][h]
                w.writerow([h.isoformat(), g["turns"], f"{g['gross']:.0f}",
                            f"{g['inp']-g['cr']+g['out']:.0f}", f"{g['inp']:.0f}",
                            f"{g['out']:.0f}", f"{g['cr']:.0f}", f"{g['cost']:.4f}"])
        print(f"wrote CSV -> {args.csv}")

    if args.json:
        body = {
            "db": str(db_path),
            "first": res["first"].isoformat(),
            "last": res["last"].isoformat(),
            "span_hours": res["span_hours"],
            "active_days": res["active_days"],
            "active_hours": res["active_hours"],
            "turns": res["turns"],
            "success_turns": res["success_turns"],
            "gross": res["gross"],
            "input": res["input"],
            "output": res["output"],
            "cache_read": res["cache_read"],
            "net": res["net"],
            "cost_usd": res["cost_usd"],
            "runtime_hours": res["runtime_hours"],
            "tokens_per_hour": res["tokens_per_hour"],
        }
        print(json.dumps(body, indent=2, default=str))
        return

    if args.quiet:
        t = res["tokens_per_hour"]
        print(f"db={db_path} active_hours={res['active_hours']} "
              f"active_days={res['active_days']} turns={res['turns']} "
              f"gross={res['gross']:.0f} net={res['net']:.0f} "
              f"cost_usd={res['cost_usd']:.2f} "
              f"gross_per_active_hr={t['per_active_clock_hour_gross']:.0f} "
              f"net_per_active_hr={t['per_active_clock_hour_net']:.0f}")
        return

    print_report(res, tz, args.top, str(db_path))


if __name__ == "__main__":
    main()
