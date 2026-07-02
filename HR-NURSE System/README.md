# HR Nurse System

A self-hosted web application for an occupational-health / HR Nurse unit. It centralises
employee health records and the workflows a company nurse runs day to day: annual physical
exams, pre-employment medical clearance (including the Neurological exam and other
requirements), clinic visits, a small medication inventory, broadcast and individual
follow-up messaging, and a reporting dashboard.

The whole thing is plain Node.js + a single-file frontend (no build step), so it runs on a
modest Ubuntu server and is easy to back up and maintain.

---

## Modules

**Dashboard** — at-a-glance counters (active employees, fit/unfit, APE overdue, pending
clearances, follow-ups due, low-stock meds) plus compliance and fitness charts.

**Employees** — the master registry: demographics, department/position, blood type,
allergies, chronic conditions, emergency contact, and a per-employee health history view
(APE records + clinic visits).

**APE / Physical Exams** — record annual and pre-employment physicals: vitals, BMI
(auto-computed), labs (CBC, urinalysis, fecalysis, drug test, blood chem), chest X-ray, ECG,
vision/hearing, findings, and a fitness verdict (fit / fit-with-restriction / unfit). Next
due-date defaults to one year out and feeds the overdue tracker.

**New-Hire Clearance** — a configurable requirement checklist auto-applied to each applicant.
Defaults include Medical History & Physical Exam, **Neurological Examination (Neuro)**, Chest
X-ray, CBC, Urinalysis, Fecalysis, Drug Test, Hepatitis B screening, Visual Acuity, Audiometry,
ECG, and Psychological/Mental Status Exam. The overall status (pending → in-progress → cleared
/ failed) is computed from the required items. Requirements are editable under "Manage
Requirements".

**Clinic Visits** — log daily encounters (complaint, vitals, assessment, treatment,
disposition, follow-up date) and optionally dispense medication, which decrements stock. A
"follow-ups due" panel surfaces upcoming recheck dates and links straight to messaging.

**Medications** — a simple inventory with stock, reorder level, expiry, restock and low-stock
flags.

**Messages** — broadcast to everyone or a department, or message selected individuals for
follow-ups/reminders, with per-recipient acknowledgement tracking.

**Reports** — APE compliance by department, fitness distribution, clinic visit trend, top
complaints, and an exportable (CSV) due/overdue list.

---

## Accounts & roles

There are three kinds of login:

**HR Nurse / Admin** (`nurse`, `admin`) — full management access to every module above.

**Employee** (`employee`) — a self-service portal showing only their *own* data: profile,
APE history and current fitness status, clinic-visit history, and messages they can read and
acknowledge. They can also keep their own contact details up to date.

**New Hire / Applicant** (`applicant`) — the same portal, plus a read-only **My Clearance**
view that tracks their pre-employment requirement checklist (Neuro, X-ray, drug test, etc.)
and overall progress as the nurse marks each item.

Employees and applicants never have access to other people's records — every portal query is
scoped server-side to the logged-in person. They do not appear automatically: the nurse opens
an employee's profile and clicks **Create Employee login** or **Create New-Hire login**, which
generates a username and a temporary password to hand over. The person is required to change
that password at first login. Accounts can be reset or disabled from the same place. Everyone
signs in at the same page; the app shows the management console or the portal based on role.

### Default logins (created by the seeder)

| Role | Username | Password | Sees |
|------|----------|----------|------|
| Administrator (master controller) | `admin` | `admin123` | Everything + Control Panel |
| HR Nurse | `nurse` | `nurse123` | All health modules |
| Employee (portal) | `employee` | `employee123` | Own records only |
| New Hire / Applicant (portal) | `newhire` | `newhire123` | Own clearance + records |

The employee/applicant demo logins are only created when demo data is seeded (`SEED_DEMO=1`).
**Change every password after first login.** All defaults are configurable via env vars
(`ADMIN_USER`, `ADMIN_PASS`, `NURSE_USER`, `NURSE_PASS`).

### Administrator Control Panel

The `admin` account is the master controller and gets an extra **⚙️ Control Panel** with three
tabs that the nurse role does not see:

*Users & Credentials* — create, reset, disable, or delete any account (admins and nurses),
see who still owes a password change, with safeguards so the last admin can't be removed or
locked out.

*Branding & Theme* — set the system name, tagline, logo character, and the primary/accent/
sidebar colors with a live preview. Saved branding applies to everyone, including the login
screen.

*System Status* — health checks (API, database connectivity, active-admin presence), server
info (Node version, platform, uptime, memory, CPU/load), live database record counts, and a
**Server Configuration** panel to change the application **port** (with an availability check)
when 3000 clashes with another system on the machine. Saving writes `PORT` to `backend/.env`;
restart the app to apply.

*Troubleshooting* — the system captures server errors, crashes, port conflicts, and reported
client-side errors into an error log shown here (with severity counts, full stack detail on
click, and a clear-log button), plus a built-in "common issues & quick fixes" guide covering
port-in-use, login problems, startup failures, database locks, and stale caches.

## Data management & workflow enhancements

**Bulk employee upload** — Employees screen → *Template* downloads a CSV with the correct
headers; *Bulk upload* reads a filled CSV, previews it, and imports (existing IDs and
non-numeric IDs are skipped and reported). **Employee IDs are numbers only** — enforced on add,
edit, and import; existing non-numeric IDs are kept until edited.

**Managed dropdowns** — Departments and Positions are admin-managed lists (Control Panel →
Lists & Notes). The employee form offers them as type-ahead dropdowns while still allowing a
new value.

**Searchable people pickers** — APE and New-Hire forms now pick an employee via a live search
box (by name *or* ID number) instead of one giant list — built for 1,000+ employees. Message
compose and SMS blast have a recipient search filter too.

**Editable form notes** — the helper text under *Record Annual Physical Exam*, *New-Hire
Clearance*, and *Clinic Visit* is editable by the admin (Control Panel → Lists & Notes). New
required checklist items for new hires are still managed under New-Hire → *Manage Requirements*.

**Full export / import** — Control Panel → Data. One-click **JSON backup** of every table
(employees → APE → clinic visits → clearances → messages → SMS log, all linked), **per-module
CSV** exports for Excel, and **restore** from a JSON backup (merge or replace mode).

**New-hire → employee transfer** — when a clearance reaches *cleared*, its detail view shows
**Convert to regular employee**, which sets the person's status to active, stamps a hire date,
and upgrades their portal login from applicant to employee. The clearance is then marked
*hired*. That is where a completed new hire "moves" — the same record is promoted in place, so
all their pre-employment results stay attached to their employee history.

**Medications** — a search box to find a medicine quickly, and a smarter restock dialog that
previews the resulting stock and warns/asks for confirmation when the amount added exceeds the
reorder level.

**Branding logo upload** — Branding & Theme accepts an uploaded image (PNG/JPG/SVG) that
replaces the character logo across the app and login screen (with the character kept as a
fallback).

**Troubleshooting follow-through** — each logged error can be **marked resolved** (with a note)
or reopened, there's a "hide resolved" filter, and the panel flags entries that **need manual
correction** (e.g. a port conflict) with the suggested fix.

## Document & record attachments

APE exams and each new-hire requirement can hold **uploaded documents** — lab results, chest
X-ray, ECG, drug test, Neuro report, etc. On an APE exam (after saving it) there's an
*Attached records* panel; on a new-hire clearance each requirement row has a 📎 button that
opens an upload panel scoped to that requirement. You can attach a PDF/image or **capture a
photo/scan** directly from a device camera (the "Scan / photo" button uses the camera on phones
and tablets).

Files are stored **on the local server**, not in the database, under a directory tree:

```
<UPLOAD_DIR>/<entity_type>/<entity_id>/<file>     e.g. .../newhire_item/42/neuro.pdf
```

`UPLOAD_DIR` defaults to `backend/data/uploads`. To move storage to a **NAS / iSCSI volume**
later, mount it and set `UPLOAD_DIR=/mnt/nas/hrnurse` in `backend/.env` — the app and the folder
layout are unchanged, so it's a drop-in relocation. The database keeps only metadata (filename,
type, size, relative path), which is included in the JSON backup.

> Note on true scanners: a browser can upload scanned files and capture from a camera, but
> driving a TWAIN/WIA desktop scanner directly needs a small companion agent on the workstation.
> That can be added later; document upload + camera capture covers the workflow today.

## SMS sending & blasting

A dedicated **SMS Blast** screen (staff) sends to all active employees, a department, selected
people, or manual numbers, with a live character/segment counter and a delivery log. It uses a
pluggable provider read from `backend/.env`:

- `SMS_PROVIDER=semaphore` — Semaphore (PH): `SMS_API_KEY`, `SMS_SENDER`.
- `SMS_PROVIDER=twilio` — Twilio: `SMS_API_KEY="ACCOUNTSID:AUTHTOKEN"`, `SMS_SENDER=<from number>`.
- `SMS_PROVIDER=generic` — POST to `SMS_API_URL` with `{to, message, from}` and a Bearer key.
- unset — **simulate mode**: nothing is sent, but every attempt is logged, so the whole flow
  works end-to-end until you add real credentials.

Configure it interactively with `dashboard.sh` → *API integrations* → *SMS gateway*. So the
answer to "can we build SMS, and if not prepare the API?" is **both** — the module is built and
already wired to the integration config; drop in a provider key to go live.

### Changing the port

Three ways, depending on the situation:

- **During setup** — `setup.sh` asks which port to use and auto-detects a free one if the
  chosen port is busy (`bash setup.sh --port=8080` to set it non-interactively).
- **In the app** — admin → Control Panel → System → Server Configuration.
- **By hand** — edit `PORT=` in `backend/.env` (or run `PORT=8080 npm start`), then restart.

If the port is taken at startup, the server now prints a clear message explaining how to fix it
instead of a raw stack trace, and logs it to the Troubleshooting panel.

---

## Control Dashboard (one menu for everything)

For day-to-day operation there is a single interactive menu:

```bash
bash dashboard.sh
```

It wraps every admin task so you don't have to remember individual commands:

1. **Install / Setup** — runs `setup.sh` (dependencies, database, and port choice).
2. **Service control** — start / stop / restart / status (systemd or manual/background).
3. **Network & firewall check** — diagnoses and fixes remote-access problems (see below).
4. **HTTPS / certificates** — turn on a self-signed cert, run Let's Encrypt, or disable TLS.
5. **API integrations** — store email (SMTP), SMS gateway, and webhook credentials, and test them.
6. **Logs & diagnostics** — recent service/app logs and current config.
7. **Change port** — set a new port (with free-port check and optional firewall opening).
8. **Full uninstall** — workstation cleanup or full server teardown.

### "It loads forever from another PC" — the fix

If `http://<server-ip>:3000` hangs from another workstation but works on the server itself, the
app is running fine — a **firewall is dropping the port**. A hang (timeout) rather than an
instant "connection refused" is the tell-tale sign. Run `bash dashboard.sh` → option **3**, which
checks whether the app is listening, probes it locally, and offers to open the port:

```bash
# Linux (UFW) — what option 3 runs for you
sudo ufw allow 3000/tcp && sudo ufw reload

# Windows server (run PowerShell/CMD as Administrator)
netsh advfirewall firewall add rule name="HR Nurse 3000" dir=in action=allow protocol=TCP localport=3000
```

Note: the full server installer (`deploy/install.sh`) puts nginx on port **80**, so there you'd
browse to `http://<server-ip>/` (no port). Opening 3000 only matters when you reach the Node app
directly (workstation/`setup.sh` mode).

## Quick start (workstation — one command)

Requires Node.js 18+. From the project root:

```bash
bash setup.sh            # installs deps, configures .env, creates+seeds DB, offers to start
```

`setup.sh` needs no root and no database server (it uses SQLite). It also asks which **port**
to run on and picks a free one automatically if your choice is busy. Flags: `--start` to launch
immediately, `--no-demo` to skip the sample employees and demo portal logins, `--port=8080` to
set the port non-interactively. To tear a workstation back down: `bash deploy/uninstall.sh --local`.

Prefer to do it by hand?

```bash
cd backend
cp .env.example .env          # defaults to SQLite — no DB server needed
npm install
npm run init-db               # create tables
npm run seed                  # default logins + requirements + meds (+ demo data)
npm start                     # http://localhost:3000
```

The seeder prints all default logins (see the table above). To start clean without demo
employees, set `SEED_DEMO=0` in `.env` before seeding.

---

## Production install (Ubuntu server, automated)

One command provisions everything — Node, the app, the database, a systemd service, an nginx
reverse proxy, optional firewall, and optional LAN DNS:

```bash
sudo bash deploy/install.sh
```

The installer is interactive and asks for: server IP, domain/hostname, app port, install
directory, database engine (**SQLite** or **PostgreSQL**), admin credentials, a TLS option
(HTTP only / self-signed / Let's Encrypt), whether to set up local DNS (dnsmasq), and whether
to configure the UFW firewall. It is safe to re-run to redeploy after updating the code.

After it finishes it prints copy-paste **router notes for MikroTik (RouterOS) and Peplink**
(port-forwarding + local DNS records) and **Cloudflare guidance** for future public access,
including a `cloudflared` Tunnel option that needs no open ports.

Remove everything with:

```bash
sudo bash deploy/uninstall.sh           # server: removes service/nginx/DNS, keeps DB unless confirmed
bash deploy/uninstall.sh --local        # workstation: removes node_modules, .env, (optionally) the DB
```

---

## Architecture

```
backend/                 Node.js + Express API (port 3000)
  server.js              app entry, static frontend, security middleware
  db/index.js            DB abstraction — SQLite (default) or PostgreSQL
  db/init.js             schema (idempotent)         ->  npm run init-db
  db/seed.js             admin + templates + meds     ->  npm run seed
  middleware/auth.js     JWT auth + role guards (staff / portal / admin)
  lib/logger.js          persists errors to the Troubleshooting log
  routes/                auth, employees, ape, newhire, clinic, reports,
                         messages, portal, settings, admin, diag
frontend/                Single-page app, no build step
  index.html, css/, js/  vanilla JS + Chart.js (CDN); app.js (staff+admin), portal.js
dashboard.sh             interactive control menu (setup, service, network, TLS, integrations)
setup.sh                 one-command workstation installer (no root)
deploy/                  install.sh (server), uninstall.sh (server + --local)
```

The Node app serves plain HTTP by default and switches to **HTTPS automatically** when
`SSL_CERT` and `SSL_KEY` point to a certificate/key in `backend/.env` (set for you by
`dashboard.sh` → HTTPS → self-signed).

The same codebase runs on either database. SQLite is the default and is recommended for a
single clinic; choose PostgreSQL in the installer for heavier or multi-process use. All
queries use portable `?` placeholders translated per engine, so no application change is
needed to switch.

Security: passwords hashed with bcrypt, JWT in an httpOnly cookie, Helmet headers, rate-limited
login. Put it behind HTTPS for anything beyond an isolated LAN.

---

## Backups

```bash
# SQLite
cp /opt/hr-nurse/backend/data/hrnurse.db  /backup/hrnurse-$(date +%F).db

# PostgreSQL
pg_dump -U hrnurse hrnurse > hrnurse-$(date +%F).sql
```

---

## API overview

All endpoints are under `/api` and require auth except `POST /api/auth/login`.

| Area        | Examples |
|-------------|----------|
| Auth        | `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password` |
| Employees   | `GET/POST /employees`, `GET /employees/:id` (full health history) |
| APE         | `GET/POST /ape`, `GET /ape/due?days=60` |
| New-hire    | `GET/POST /newhire`, `PUT /newhire/:id/items/:itemId`, `GET/POST /newhire/templates` |
| Clinic      | `GET/POST /clinic/visits`, `GET /clinic/followups`, `*/clinic/medications` |
| Messages    | `GET/POST /messages`, `POST /messages/:id/recipients/:empId/ack` |
| Reports     | `/reports/dashboard`, `/reports/ape-compliance`, `/reports/fitness-distribution` |

---

## Extending it

Tell the nurse unit what else they need and it slots in cleanly: the requirement checklist is
already user-editable, and new modules follow the existing pattern (a table in `db/init.js`, a
router in `routes/`, and a view in `frontend/js/app.js`). Likely future additions: email/SMS
delivery for messages, document/lab-result file attachments, vaccination & incident logs, and
role-based accounts for multiple nurses.
