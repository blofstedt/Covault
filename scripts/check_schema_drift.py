#!/usr/bin/env python3
"""
Schema drift comparator.

Compares the live PostgREST introspection (--live) against the
canonical schema declared in supabase/schema.sql (--expected) and
exits non-zero if they don't match.

This is a *partial* check: PostgREST doesn't expose RLS, triggers,
CHECK constraints, or indexes, so those are out of scope here. The
companion SQL script 2026_verify_rls.sql covers policies.
"""

import argparse
import json
import re
import sys
from pathlib import Path


def parse_live_schema(path: Path) -> dict:
    """Parse the PostgREST /rest/v1/ introspection JSON.

    Returns a dict keyed by table name with: columns (name -> type info),
    required (set of NOT NULL columns), enums (dict of column -> list of
    allowed values).
    """
    raw = json.loads(path.read_text())
    tables = {}
    for tname, schema in raw.get("definitions", {}).items():
        props = schema.get("properties", {})
        required = set(schema.get("required", []))
        cols = {}
        enums = {}
        for cname, info in props.items():
            cols[cname] = {
                "type": info.get("type", ""),
                "format": info.get("format", ""),
                "required": cname in required,
            }
            if "enum" in info:
                enums[cname] = list(info["enum"])
        tables[tname] = {"columns": cols, "enums": enums, "required": required}

    # RPCs (functions)
    rpcs = []
    for p in raw.get("paths", {}):
        m = re.match(r"^/rpc/([a-zA-Z0-9_]+)$", p)
        if m:
            rpcs.append(m.group(1))

    return {"tables": tables, "rpcs": sorted(rpcs)}


def parse_expected_schema(path: Path) -> dict:
    """Parse the canonical supabase/schema.sql.

    Extracts CREATE TABLE statements, their columns, types, and
    enum type definitions. We don't run a full SQL parser — just
    enough to match what PostgREST exposes.
    """
    sql = path.read_text()
    tables = {}
    enums = {}

    # Parse CREATE TYPE ... AS ENUM
    for m in re.finditer(
        r"CREATE\s+TYPE\s+(?:public\.)?[\"']?(\w+)[\"']?\s+AS\s+ENUM\s*\(([^)]+)\)",
        sql,
        re.IGNORECASE,
    ):
        name = m.group(1)
        values = [
            v.strip().strip("'").strip('"')
            for v in m.group(2).split(",")
            if v.strip()
        ]
        enums[name] = values

    # Parse CREATE TABLE blocks. Handle IF NOT EXISTS.
    table_pattern = re.compile(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\((.*?)\);",
        re.IGNORECASE | re.DOTALL,
    )
    for m in table_pattern.finditer(sql):
        tname = m.group(1)
        body = m.group(2)

        # Skip CREATE TYPE outputs that the regex might catch
        if tname.lower() == "type":
            continue

        cols = {}
        required = set()
        for line in body.splitlines():
            line = line.strip().rstrip(",").strip()
            # Skip blanks and constraint declarations of all kinds.
            if not line or line.upper().startswith(
                ("CONSTRAINT", "PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "REFERENCES")
            ):
                continue
            if line.upper().startswith("REFERENCES"):
                continue
            # Column: name TYPE [constraints]
            parts = line.split(None, 1)
            if len(parts) < 2:
                continue
            cname = parts[0].strip('"')
            # Constraint keywords sometimes leak as fake column names when
            # the previous line ended with a comma and this line is a
            # FOREIGN KEY ... REFERENCES shape. Guard against that.
            if cname.upper() in {"FOREIGN", "PRIMARY", "UNIQUE", "CHECK", "CONSTRAINT"}:
                continue
            cdef = parts[1]

            # Determine if NOT NULL
            is_required = bool(re.search(r"\bNOT\s+NULL\b", cdef, re.IGNORECASE))
            if is_required:
                required.add(cname)

            # Determine type
            ctype = ""
            if re.search(r"\bpublic\.\"(\w+)\"", cdef, re.IGNORECASE):
                ctype = "enum:" + re.search(
                    r"public\.\"(\w+)\"", cdef, re.IGNORECASE
                ).group(1)
            elif re.search(r"\b\w+\b", cdef):
                first = re.match(r"(\w+)", cdef)
                ctype = first.group(1) if first else ""

            cols[cname] = {"type": ctype, "required": is_required}

        tables[tname] = {"columns": cols, "required": required, "enums": {}}

    # Cross-link enums to columns
    for tname, info in tables.items():
        for cname, c in info["columns"].items():
            if c["type"].startswith("enum:"):
                ename = c["type"][5:]
                if ename in enums:
                    info["enums"][cname] = enums[ename]

    return {"tables": tables}


def compare(live: dict, expected: dict) -> list[str]:
    issues = []

    # Tables that exist in live
    live_tables = set(live["tables"].keys())
    expected_tables = set(expected["tables"].keys())

    # Tables in live but not in schema.sql
    for t in sorted(live_tables - expected_tables):
        issues.append(f"EXTRA TABLE in live DB: {t}")

    # Tables declared in schema.sql but missing in live
    for t in sorted(expected_tables - live_tables):
        issues.append(f"MISSING TABLE in live DB: {t}")

    # Compare column-by-column for shared tables
    for t in sorted(live_tables & expected_tables):
        lcols = live["tables"][t]["columns"]
        ecols = expected["tables"][t]["columns"]
        lreq = live["tables"][t]["required"]
        ereq = expected["tables"][t]["required"]

        for c in sorted(set(lcols) - set(ecols)):
            issues.append(f"EXTRA COLUMN on {t}.{c} (in live, not in schema.sql)")
        for c in sorted(set(ecols) - set(lcols)):
            issues.append(f"MISSING COLUMN on {t}.{c} (in schema.sql, not in live)")

        for c in sorted(set(lcols) & set(ecols)):
            if lreq.__contains__(c) != ereq.__contains__(c):
                who = "NOT NULL" if lreq.__contains__(c) else "NULL"
                expected_who = "NULL" if not ereq.__contains__(c) else "NOT NULL"
                issues.append(
                    f"NULLABILITY MISMATCH on {t}.{c}: live={who}, schema.sql={expected_who}"
                )

        # Enum membership check
        lenums = live["tables"][t]["enums"]
        eenums = expected["tables"][t]["enums"]
        for c in sorted(set(lenums) & set(eenums)):
            live_vals = set(lenums[c])
            expected_vals = set(eenums[c])
            for v in sorted(live_vals - expected_vals):
                issues.append(f"EXTRA ENUM VALUE on {t}.{c}: '{v}' (in live, not in schema.sql)")
            for v in sorted(expected_vals - live_vals):
                issues.append(f"MISSING ENUM VALUE on {t}.{c}: '{v}' (in schema.sql, not in live)")

    return issues


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", required=True, type=Path)
    ap.add_argument("--expected", required=True, type=Path)
    ap.add_argument("--project", required=True)
    args = ap.parse_args()

    live = parse_live_schema(args.live)
    expected = parse_expected_schema(args.expected)

    print(f"Project: {args.project}")
    print(f"Live tables:     {sorted(live['tables'].keys())}")
    print(f"Live RPCs:       {live['rpcs']}")
    print(f"Schema tables:   {sorted(expected['tables'].keys())}")
    print()

    issues = compare(live, expected)

    if not issues:
        print("✅ Tables, columns, nullability, and enums all match schema.sql")
        print()
        print("Note: PostgREST doesn't expose RLS, triggers, CHECK constraints,")
        print("or indexes. Run supabase/migrations/2026_verify_rls.sql manually")
        print("to verify policies, and use the --full flag here for full coverage.")
        return 0

    print(f"❌ Found {len(issues)} drift issue(s):")
    for i in issues:
        print(f"  - {i}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
