#!/usr/bin/env python3
"""
Load the generated CSVs into Data 360 with the Ingestion API (bulk pattern).

Flow (as documented in the Data 360 Ingestion API reference):
  1. exchange the Salesforce access token for a Data 360 token: POST {instance}/services/a360/token
  2. per object: POST /api/v1/ingest/jobs  {object, sourceName, operation: "upsert"}
  3. PUT  /api/v1/ingest/jobs/{id}/batches  (text/csv, max 150 MB per file, max 100 files per job)
  4. PATCH /api/v1/ingest/jobs/{id}  {"state": "UploadComplete"}
  5. poll GET /api/v1/ingest/jobs/{id} until JobComplete or Failed

Prerequisites (UI, once): Ingestion API connector named like --source with ../ingestion/du_smb_telco.yaml
uploaded, and one data stream per object. The running user needs Data 360 ingestion permissions.

Usage
  export SF_INSTANCE_URL=$(sf org display --target-org du-demo --json | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['instanceUrl'])")
  export SF_ACCESS_TOKEN=$(sf org display --target-org du-demo --json | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['accessToken'])")
  python3 load_to_data360.py --dir ../generator/out --source du_smb_telco
  python3 load_to_data360.py --dir ../generator/out --source du_smb_telco --dry-run

Standard library only. Upsert on the primary key, so re-running does not duplicate.
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

OBJECTS = ["MobileLine", "UsageDaily", "NetworkKpiDaily", "LineSlo", "BillSummary", "PartyId", "TroubleTicket", "DigitalEngagement", "AccountRiskSnapshot"]
MAX_BYTES = 140 * 1024 * 1024  # stay under the 150 MB per-file limit


def http(method, url, token=None, body=None, ctype="application/json"):
    data = None
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        headers["Content-Type"] = ctype
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw and r.headers.get_content_type() == "application/json" else raw)
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {url} failed: {e.code} {e.read().decode(errors='replace')[:500]}")


def dc_token(instance, sf_token):
    form = urllib.parse.urlencode({
        "grant_type": "urn:salesforce:grant-type:external:cdp",
        "subject_token": sf_token,
        "subject_token_type": "urn:ietf:params:oauth:token-type:access_token",
    }).encode()
    _, res = http("POST", f"{instance}/services/a360/token", body=form, ctype="application/x-www-form-urlencoded")
    tenant = res["instance_url"]
    if not tenant.startswith("http"):
        tenant = "https://" + tenant
    return tenant.rstrip("/"), res["access_token"]


def chunks(path):
    """Split a CSV into <=MAX_BYTES parts, repeating the header."""
    with open(path, "rb") as f:
        header = f.readline()
        buf = [header]
        size = len(header)
        for line in f:
            if size + len(line) > MAX_BYTES and len(buf) > 1:
                yield b"".join(buf)
                buf, size = [header], len(header)
            buf.append(line)
            size += len(line)
        if len(buf) > 1:
            yield b"".join(buf)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", required=True)
    ap.add_argument("--source", required=True, help="Ingestion API connector (source) name")
    ap.add_argument("--only", action="append", help="load only these objects (repeatable)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    objs = [o for o in OBJECTS if not args.only or o in args.only]
    files = {o: os.path.join(args.dir, f"{o}.csv") for o in objs if os.path.exists(os.path.join(args.dir, f"{o}.csv"))}
    if args.dry_run:
        for o, p in files.items():
            print(f"{o}: {os.path.getsize(p) / 1e6:.1f} MB, {sum(1 for _ in chunks(p))} part(s)")
        return

    instance, sf_token = os.environ.get("SF_INSTANCE_URL"), os.environ.get("SF_ACCESS_TOKEN")
    if not instance or not sf_token:
        sys.exit("Set SF_INSTANCE_URL and SF_ACCESS_TOKEN (see the usage notes at the top of this file).")
    tenant, token = dc_token(instance.rstrip("/"), sf_token)
    print("Data 360 tenant:", tenant)

    for obj, path in files.items():
        _, job = http("POST", f"{tenant}/api/v1/ingest/jobs", token, {"object": obj, "sourceName": args.source, "operation": "upsert"})
        jid = job["id"]
        for part in chunks(path):
            http("PUT", f"{tenant}/api/v1/ingest/jobs/{jid}/batches", token, part, ctype="text/csv")
        http("PATCH", f"{tenant}/api/v1/ingest/jobs/{jid}", token, {"state": "UploadComplete"})
        print(f"{obj}: job {jid} uploaded, waiting...", flush=True)
        for _ in range(120):
            _, info = http("GET", f"{tenant}/api/v1/ingest/jobs/{jid}", token)
            if info.get("state") in ("JobComplete", "Failed", "Aborted"):
                print(f"  -> {info['state']}")
                break
            time.sleep(10)
        else:
            print("  -> still processing; check Data Streams in Data 360")


if __name__ == "__main__":
    main()
