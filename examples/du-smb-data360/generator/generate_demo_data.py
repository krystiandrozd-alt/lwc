#!/usr/bin/env python3
"""
du SMB Mobile demo - synthetic telco data for Data 360 (no migration).

Generates one CSV per Ingestion API object (see ../ingestion/du_smb_telco.yaml):
MobileLine, UsageDaily, NetworkKpiDaily, LineSlo, BillSummary, PartyId,
TroubleTicket, DigitalEngagement, AccountRiskSnapshot.

Design rules
- Anchored to real CRM Account IDs (export from the org) so Data 360 joins to the CRM data stream.
- Deterministic: same --seed and inputs -> same rows and IDs. Re-loading with upsert never duplicates.
- Coherent signals: each account gets an archetype (healthy / watch / at_risk / hero) and every
  signal (usage, network, tickets, bills, app events, churn score) is generated from it, so the
  churn drivers shown in the demo are backed by the underlying data.
- Prospects (Type contains 'Prospect') get no lines or usage.

Usage
  sf data query --query "SELECT Id, Name, Type, BillingState FROM Account" \
      --result-format csv --target-org du-demo > accounts.csv
  python3 generate_demo_data.py --accounts accounts.csv --out ./out --as-of 2026-11-11
  # without an org export (fictional accounts, for a dry run):
  python3 generate_demo_data.py --fake-accounts 53 --out ./out

Standard library only.
"""
import argparse
import csv
import hashlib
import os
import random
from datetime import date, datetime, timedelta, timezone

PLANS = [  # names from the du-demo catalog; MRC and allowance are DEMO ASSUMPTIONS
    ("BMP100", "Business Mobile Plan 100", 100, 12),
    ("BMP325", "Business Mobile Plan 325", 325, 60),
    ("BMP600", "Business Mobile Plan 600", 600, 150),
    ("BMP900", "Business Mobile Plan 900", 900, 400),
]
DEVICES = [("Apple iPhone 18 Pro", True), ("Samsung Galaxy S26 Ultra", True), ("Apple iPhone 13", False), ("Samsung Galaxy A35", True), ("Customer-owned 4G device", False)]
EMIRATES = ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah", "Fujairah", "Umm Al Quwain"]
ISSUERS = {"Dubai": "Dubai DET", "Abu Dhabi": "Abu Dhabi DED", "Sharjah": "Sharjah SEDD"}
SITES = {"Dubai": ["Business Bay", "JLT", "Al Quoz", "Deira", "Dubai Marina"], "Abu Dhabi": ["Mussafah", "Al Reem", "Khalifa City"], "Sharjah": ["Al Nahda", "Industrial Area 6"]}
FIRST = ["Ahmed", "Fatima", "Omar", "Aisha", "Rashid", "Mariam", "Yousef", "Noura", "Khalid", "Sara", "Ravi", "Priya", "John", "Elena"]
CATEGORIES = ["No data service", "Slow data", "Call drops", "Billing query", "SIM / eSIM", "Number porting", "Roaming"]
ARCHETYPES = {  # share of customer accounts
    "healthy": 0.5,
    "watch": 0.3,
    "at_risk": 0.2,
}
DRIVER_LABELS = {
    "usage": "Data usage down vs previous 60 days",
    "contract": "Contract ends within 60 days",
    "network": "Network experience below target",
    "tickets": "Repeated tickets / SLA breaches",
    "payment": "Late payments",
    "compare": "Viewed compare-plans / port-out pages",
    "tenure": "Tenure under 6 months",
}
DRIVER_POINTS = {"usage": 20, "contract": 15, "network": 15, "tickets": 15, "payment": 10, "compare": 15, "tenure": 10}
NBO = {
    "contract": ("RECON24", "Re-contract 24 months, 20% off + 10 GB per line", 34),
    "usage": ("BOOST5", "National Data Booster 5 GB, 3 months free", 31),
    "network": ("NETFIX", "Network check + AED 100 credit", 52),
    "tickets": ("CALLBACK", "Senior agent callback + bill credit", 48),
    "payment": ("PAYPLAN", "Flexible payment plan", 38),
    "compare": ("LOYAL", "Loyalty price match on Plan 325", 28),
    "tenure": ("ONBOARD", "Onboarding call + welcome bundle", 45),
    "upsell": ("UPG600", "Upgrade to Business Mobile Plan 600", 22),
}


def stable_id(*parts):
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def iso(d):
    return d.isoformat()


def dt(d, hour=0):
    return datetime(d.year, d.month, d.day, hour, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def read_accounts(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    out = []
    for r in rows:
        acc_id = r.get("Id") or r.get("ID") or r.get("id")
        if not acc_id:
            continue
        out.append({"id": acc_id, "name": r.get("Name", ""), "type": r.get("Type", "") or "", "state": r.get("BillingState", "") or ""})
    return out


def fake_accounts(n, rnd):
    words = ["Falcon", "Oasis", "Pearl", "Dune", "Marina", "Gulf", "Palm", "Creek", "Souk", "Horizon", "Saffron", "Jumeirah"]
    kinds = ["Logistics", "Trading", "Contracting", "Clinic", "Cafe", "Properties", "Tech", "Retail", "Events", "Auto"]
    out = []
    for i in range(n):
        out.append({"id": "001DEMO%011d" % i, "name": f"{rnd.choice(words)} {rnd.choice(kinds)} LLC (DEMO)", "type": "Prospect" if rnd.random() < 0.38 else "Customer - Direct", "state": rnd.choice(EMIRATES[:3])})
    return out


class Writer:
    def __init__(self, out_dir):
        self.out_dir = out_dir
        self.files = {}

    def write(self, obj, row):
        if obj not in self.files:
            f = open(os.path.join(self.out_dir, f"{obj}.csv"), "w", newline="", encoding="utf-8")
            w = csv.DictWriter(f, fieldnames=list(row.keys()))
            w.writeheader()
            self.files[obj] = (f, w, 0)
        f, w, n = self.files[obj]
        w.writerow({k: ("true" if v is True else "false" if v is False else v) for k, v in row.items()})
        self.files[obj] = (f, w, n + 1)

    def close(self):
        counts = {}
        for obj, (f, _, n) in self.files.items():
            f.close()
            counts[obj] = n
        return counts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--accounts", help="CSV export of Account (Id, Name, Type, BillingState)")
    src.add_argument("--fake-accounts", type=int, help="generate N fictional accounts instead")
    ap.add_argument("--out", default="out")
    ap.add_argument("--as-of", default=date.today().isoformat(), help="last day of generated history (YYYY-MM-DD)")
    ap.add_argument("--days", type=int, default=90, help="days of daily usage / network history")
    ap.add_argument("--seed", default="du-smb-demo-v1")
    ap.add_argument("--hero", action="append", default=[], help="Account ID to force into the at-risk demo storyline (repeatable)")
    args = ap.parse_args()

    as_of = date.fromisoformat(args.as_of)
    stamp = dt(as_of, 6)
    base_rnd = random.Random(args.seed)
    accounts = read_accounts(args.accounts) if args.accounts else fake_accounts(args.fake_accounts, base_rnd)
    os.makedirs(args.out, exist_ok=True)
    w = Writer(args.out)
    summary = {"healthy": 0, "watch": 0, "at_risk": 0, "hero": 0, "prospect": 0}

    for acc in accounts:
        rnd = random.Random(f"{args.seed}|{acc['id']}")
        is_prospect = "prospect" in acc["type"].lower()
        emirate = acc["state"] if acc["state"] in EMIRATES else rnd.choice(EMIRATES[:3])

        # Party identification exists for prospects too (KYC from lead conversion)
        for id_type, num in (("TRADE_LICENSE", f"{rnd.randint(100000, 999999)}"), ("TRN", f"100{rnd.randint(10**11, 10**12 - 1)}")):
            issued = as_of - timedelta(days=rnd.randint(200, 2500))
            w.write("PartyId", {"party_id_key": stable_id(acc["id"], id_type), "account_id": acc["id"], "id_type": id_type, "id_number": num,
                                "issued_by": ISSUERS.get(emirate, "Federal Tax Authority") if id_type == "TRADE_LICENSE" else "Federal Tax Authority",
                                "issued_date": iso(issued), "expiry_date": iso(issued + timedelta(days=365 * (1 if id_type == "TRADE_LICENSE" else 10))), "last_modified": stamp})
        if is_prospect:
            summary["prospect"] += 1
            continue

        if acc["id"] in args.hero:
            arche = "hero"
        else:
            r = rnd.random()
            arche = "healthy" if r < ARCHETYPES["healthy"] else "watch" if r < ARCHETYPES["healthy"] + ARCHETYPES["watch"] else "at_risk"
        summary[arche] += 1
        risky = arche in ("at_risk", "hero")

        # Active drivers decide every downstream signal
        pool = list(DRIVER_POINTS)
        n_drivers = {"healthy": rnd.choice([0, 0, 1]), "watch": rnd.choice([2, 3]), "at_risk": rnd.choice([4, 5]), "hero": 5}[arche]
        drivers = set(rnd.sample(pool, n_drivers))
        if arche == "hero":
            drivers = {"usage", "contract", "network", "tickets", "compare"}

        # ---- lines
        n_lines = max(1, int(rnd.lognormvariate(2.4, 0.7)))  # median ~11 lines
        n_lines = min(n_lines, 120)
        main_plan = rnd.choices(PLANS, weights=[2, 5, 3, 1])[0]
        tenure_days = rnd.randint(60, 170) if "tenure" in drivers else rnd.randint(400, 3200)
        contract_end = as_of + timedelta(days=rnd.randint(10, 58) if "contract" in drivers else rnd.randint(120, 700))
        lines = []
        for i in range(n_lines):
            plan = main_plan if rnd.random() < 0.7 else rnd.choice(PLANS)
            device, is5g = rnd.choice(DEVICES)
            line_id = stable_id(acc["id"], "line", i)
            status = "Suspended" if ("payment" in drivers and i == 0 and rnd.random() < 0.5) else "Active"
            activation = as_of - timedelta(days=max(30, tenure_days - rnd.randint(0, 200)))
            line = {"line_id": line_id, "account_id": acc["id"], "msisdn": f"+97150{rnd.randint(1000000, 9999999)}",
                    "iccid": f"8997102{rnd.randint(10**12, 10**13 - 1)}", "plan_code": plan[0], "plan_name": plan[1], "product_family": "Business Mobile Plans",
                    "line_status": status, "activation_date": iso(activation), "contract_end_date": iso(contract_end), "mrc_aed": plan[2],
                    "data_allowance_gb": plan[3], "device_model": device, "is_5g_device": is5g, "user_name": f"{rnd.choice(FIRST)} (line {i + 1})",
                    "emirate": emirate, "last_modified": stamp}
            w.write("MobileLine", line)
            lines.append(line)
            # one SLO per line for the top plans only (business SLA)
            if plan[0] in ("BMP600", "BMP900"):
                w.write("LineSlo", {"slo_id": stable_id(line_id, "slo"), "line_id": line_id, "account_id": acc["id"], "slo_name": "Call setup success",
                                    "measure": "CALL_SETUP_SUCCESS_PCT", "comparator": ">=", "threshold_target": 99.0, "period_days": 30,
                                    "slo_status": "Breached" if "network" in drivers and rnd.random() < 0.6 else "Met",
                                    "valid_from": iso(activation), "valid_to": iso(contract_end), "last_modified": stamp})

        sites = SITES.get(emirate, ["City centre"])
        # ---- daily usage + network, per line
        for line in lines:
            if line["line_status"] != "Active":
                continue
            base_gb_day = line["data_allowance_gb"] * rnd.uniform(0.35, 0.95) / 30
            base_min = rnd.uniform(4, 25)
            site = rnd.choice(sites)
            for d in range(args.days):
                day = as_of - timedelta(days=args.days - 1 - d)
                decline = 1.0
                if "usage" in drivers and d >= args.days - 30:
                    decline = 0.55  # -45% in the last 30 days
                weekend = 0.75 if day.weekday() in (4, 5) else 1.0  # Fri/Sat weekend in the UAE
                gb = max(0.0, rnd.gauss(base_gb_day, base_gb_day * 0.25)) * decline * weekend
                mins = max(0.0, rnd.gauss(base_min, base_min * 0.3)) * weekend * (0.8 if decline < 1 else 1)
                for svc, vol, dur, cnt, amt in (("DATA", round(gb * 1024, 1), 0, rnd.randint(20, 200), 0),
                                                ("VOICE", 0, round(mins, 1), max(1, int(mins / 3)), 0),
                                                ("SMS", 0, 0, rnd.randint(0, 6), 0)):
                    w.write("UsageDaily", {"usage_id": stable_id(line["line_id"], day, svc), "line_id": line["line_id"], "account_id": acc["id"], "usage_date": iso(day),
                                           "service_type": svc, "volume_mb": vol, "duration_min": dur, "event_count": cnt, "rated_amount_aed": amt, "in_bundle": True, "last_modified": stamp})
                if rnd.random() < 0.01:
                    w.write("UsageDaily", {"usage_id": stable_id(line["line_id"], day, "ROAM_DATA"), "line_id": line["line_id"], "account_id": acc["id"], "usage_date": iso(day),
                                           "service_type": "ROAM_DATA", "volume_mb": round(rnd.uniform(200, 1500), 1), "duration_min": 0, "event_count": rnd.randint(5, 40),
                                           "rated_amount_aed": round(rnd.uniform(35, 210), 2), "in_bundle": False, "last_modified": stamp})
                bad = "network" in drivers and d >= args.days - 45
                drop = max(0.1, rnd.gauss(1.9 if bad else 0.6, 0.35))
                w.write("NetworkKpiDaily", {"kpi_id": stable_id(line["line_id"], day, "kpi"), "line_id": line["line_id"], "account_id": acc["id"],
                                            "period_start": dt(day, 0), "period_end": dt(day + timedelta(days=1), 0),
                                            "call_drop_rate_pct": round(drop, 2), "call_setup_success_pct": round(min(99.99, rnd.gauss(97.8 if bad else 99.4, 0.3)), 2),
                                            "latency_ms": round(rnd.gauss(68 if bad else 32, 6), 1), "jitter_ms": round(rnd.gauss(12 if bad else 5, 2), 1),
                                            "packet_loss_pct": round(max(0, rnd.gauss(1.4 if bad else 0.3, 0.2)), 2),
                                            "dl_throughput_mbps": round(max(1, rnd.gauss(14 if bad else 95, 12)), 1), "ul_throughput_mbps": round(max(1, rnd.gauss(4 if bad else 22, 3)), 1),
                                            "availability_pct": round(min(100, rnd.gauss(98.6 if bad else 99.9, 0.2)), 2), "mos_score": round(min(4.5, rnd.gauss(3.3 if bad else 4.2, 0.15)), 2),
                                            "data_volume_mb": round(gb * 1024, 1), "site_name": site, "activity_type": "DATA_AND_VOICE", "last_modified": stamp})

        # ---- bills (12 months)
        mrc_total = sum(l["mrc_aed"] for l in lines if l["line_status"] == "Active")
        for m in range(12):
            y, mo = as_of.year, as_of.month - m
            while mo <= 0:
                mo += 12
                y -= 1
            month = date(y, mo, 1)
            usage_aed = round(rnd.uniform(0, 0.08) * mrc_total + (rnd.uniform(80, 400) if rnd.random() < 0.15 else 0), 2)
            one_time = round(rnd.choice([0, 0, 0, 99, 4999]) if m in (2, 7) else 0, 2)
            net = round(mrc_total * (0.97 if "usage" in drivers and m < 2 else 1.0) + usage_aed + one_time, 2)
            late = rnd.randint(8, 35) if "payment" in drivers and rnd.random() < 0.6 else (rnd.randint(1, 5) if rnd.random() < 0.1 else 0)
            due = date(y, mo, 15) + timedelta(days=30)
            paid = due + timedelta(days=late) if due + timedelta(days=late) <= as_of else ""
            w.write("BillSummary", {"bill_id": stable_id(acc["id"], month), "account_id": acc["id"], "billing_account_no": f"BA-{stable_id(acc['id'])[:8].upper()}",
                                    "bill_month": iso(month), "recurring_aed": round(mrc_total, 2), "usage_aed": usage_aed, "one_time_aed": one_time, "net_amount_aed": net,
                                    "vat_aed": round(net * 0.05, 2), "total_aed": round(net * 1.05, 2), "due_date": iso(due), "paid_date": iso(paid) if paid else "",
                                    "days_late": late if paid else 0, "bill_status": "Paid" if paid else "Open", "is_disputed": ("tickets" in drivers and m == 1), "last_modified": stamp})

        # ---- trouble tickets (180 days)
        n_tk = rnd.randint(5, 11) if "tickets" in drivers else rnd.randint(0, 3)
        for k in range(n_tk):
            opened = as_of - timedelta(days=rnd.randint(0, 90) if "tickets" in drivers else rnd.randint(0, 180), hours=0)
            pr = rnd.choices(["P1", "P2", "P3", "P4"], weights=[1, 3, 6, 4])[0]
            ok = rnd.random() > (0.45 if "tickets" in drivers else 0.08)
            hours = {"P1": 4, "P2": 24, "P3": 72, "P4": 120}[pr] * (rnd.uniform(0.2, 0.9) if ok else rnd.uniform(1.2, 3))
            resolved = datetime(opened.year, opened.month, opened.day, 9, tzinfo=timezone.utc) + timedelta(hours=hours)
            cat = rnd.choice(CATEGORIES[:3]) if "network" in drivers else rnd.choice(CATEGORIES)
            w.write("TroubleTicket", {"ticket_id": stable_id(acc["id"], "tt", k), "account_id": acc["id"], "line_id": rnd.choice(lines)["line_id"],
                                      "opened_at": dt(opened, 9), "resolved_at": resolved.isoformat().replace("+00:00", "Z") if resolved.date() <= as_of else "",
                                      "priority": pr, "category": cat, "within_sla": ok, "root_cause": "Cell congestion" if cat in ("Slow data", "Call drops") and "network" in drivers else "",
                                      "last_modified": stamp})

        # ---- digital engagement (60 days)
        events = ["login", "view_usage", "view_bill", "buy_addon"]
        if "compare" in drivers:
            events += ["compare_plans", "compare_plans", "port_out_faq"]
        for k in range(rnd.randint(8, 40)):
            ev_day = as_of - timedelta(days=rnd.randint(0, 60))
            ev = rnd.choice(events)
            w.write("DigitalEngagement", {"event_id": stable_id(acc["id"], "ev", k), "account_id": acc["id"], "line_id": rnd.choice(lines)["line_id"],
                                          "event_time": dt(ev_day, rnd.randint(7, 22)), "channel": rnd.choice(["du Business app", "Self-service portal"]),
                                          "event_type": ev, "page_name": {"compare_plans": "Compare business plans", "port_out_faq": "How to move my number"}.get(ev, ev.replace("_", " ").title()),
                                          "last_modified": stamp})

        # ---- churn score snapshot (last 6 months, rising for risky accounts)
        score_now = min(98, sum(DRIVER_POINTS[d] for d in drivers) + rnd.randint(0, 8))
        top = sorted(drivers, key=lambda d: (-DRIVER_POINTS[d], d))[:3] + ["", "", ""]
        nbo_key = top[0] if top[0] else "upsell"
        clv = round(mrc_total * 36 * (1 - score_now / 140))
        for m in range(6):
            snap = as_of - timedelta(days=30 * (5 - m))
            s = score_now if m == 5 else max(5, int(score_now - (5 - m) * (score_now / 8 if risky else 1) + rnd.randint(-3, 3)))
            w.write("AccountRiskSnapshot", {"snapshot_id": stable_id(acc["id"], "risk", m), "account_id": acc["id"], "snapshot_date": iso(snap), "churn_score": s,
                                            "churn_band": "High" if s >= 65 else "Medium" if s >= 40 else "Low",
                                            "top_driver_1": DRIVER_LABELS.get(top[0], ""), "top_driver_2": DRIVER_LABELS.get(top[1], ""), "top_driver_3": DRIVER_LABELS.get(top[2], ""),
                                            "nbo_code": NBO[nbo_key][0], "nbo_name": NBO[nbo_key][1], "nbo_propensity_pct": NBO[nbo_key][2], "clv_aed": clv, "last_modified": stamp})

    counts = w.close()
    print("accounts:", len(accounts), summary)
    for obj in sorted(counts):
        print(f"  {obj}: {counts[obj]:,} rows")


if __name__ == "__main__":
    main()
