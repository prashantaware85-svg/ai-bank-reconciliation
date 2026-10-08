# Tally Agent (local, Windows-compatible)

Local Node.js/TypeScript service that **reads** from TallyPrime over the
official HTTP/XML interface and pushes normalized transactions **outbound**
to the backend. Read-only with respect to Tally — no write-back, no voucher
creation, no Tally modification.

```
TallyPrime → Local Tally Agent → HTTPS → Backend API → PostgreSQL → TallyTransaction
```

The backend never needs inbound access to this PC.

## Prerequisites (official TallyPrime integration mechanism)

Sources: TallyHelp “Integration With TallyPrime” and the TallyPrime Data
Exchange docs (developer.tallysolutions.com):

1. TallyPrime running on this machine.
2. HTTP/XML enabled: F1 → Settings → Connectivity → act as Both/Server,
   port `9000` (or set `TALLY_BASE_URL`).
3. At least one company loaded (Company → Select).

The agent POSTs `text/xml` envelopes (`TALLYREQUEST` Export,
`SVEXPORTFORMAT $$SysName:XML`) to `http://127.0.0.1:9000/`:
collections (`List of Companies`, `List of Ledgers`) and `DayBook` data
exports (`SVFROMDATE`/`SVTODATE` as `YYYYMMDD`).

## Setup

```powershell
cd tally-agent
cp .env.example .env   # set BACKEND_JWT from the app login
npm install
npm run build
```

## Commands

```powershell
node dist/cli.js check                                            # Tally reachable?
node dist/cli.js companies                                        # list Tally companies
node dist/cli.js ledgers [--bank-only=true]                       # list ledgers
node dist/cli.js vouchers --from=2026-09-01 --to=2026-09-30 --bank-ledger="HDFC Bank"
$env:BACKEND_JWT="<jwt>"; node dist/cli.js sync --sync-id=<id>    # run a backend sync
node dist/cli.js fail --sync-id=<id> --message="<reason>"         # report failure
```

`sync` reads the sync params from the backend, fetches Day Book vouchers
from Tally, keeps entries for the requested bank ledger, normalizes them,
and ingests them (`done=true`). Tally outages are reported back to the
sync as FAILED with a plain message.

Direction convention is bank-statement style: money OUT of the bank pedigrees
`DEBIT`. A bank-ledger debit entry in Tally (inflow) maps to `CREDIT`.

## Scope notes

- Development executable only. No Windows installer and no Windows-service
  registration are implemented in this step.
- No live-Tally claims: run `check` on a machine with TallyPrime to verify.
