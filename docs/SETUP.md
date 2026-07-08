# Setup Guide

Three supported installations, smallest to largest. All of them serve the same
PWA — teachers and parents just open the address in a phone browser and tap
**Add to Home screen**.

**Requirements:** Node.js ≥ 22.5 (or Docker). 512MB RAM is enough for a single
school; the database is a single SQLite file.

---

## A. Single-school offline install (no internet at all)

For schools with no connectivity. The "server" is any always-on(ish) machine in
the office — a laptop, mini-PC, or Raspberry Pi — and staff phones connect over
the school's local Wi-Fi hotspot (a cheap router, no internet needed).

1. On a machine that *does* have internet once (e.g. in town), download:
   - Node.js installer for the school machine's OS,
   - this repository as a ZIP,
   - run `npm install` inside it, then copy the whole folder (including
     `node_modules/`) to a USB stick.
2. On the school machine: install Node, copy the folder, then:
   ```bash
   cp .env.example .env      # edit: set a strong AUTH_SECRET
   npm run migrate
   npm start
   ```
3. Connect the office router (no WAN needed). Find the machine's LAN address
   (e.g. `192.168.1.50`) and have staff open `http://192.168.1.50:3000`.
4. First sign-in: run `npm run seed` for demo data, **or** create the real
   school with the bootstrap admin (see "First real school" below).
5. **Backups:** the app snapshots the database daily to `data/backups/`.
   Copy the newest `.db` file to a USB stick weekly and keep it off-site.
   Settings → Backup now creates one on demand.
6. **Updates:** replace the folder with a newer release (keep `data/` and
   `.env`), run `npm run migrate`, restart.

> Power tip: a Raspberry Pi + power bank runs the suite all day on ~5W.

## B. School local server with occasional internet

Same as A, but the machine has an internet connection sometimes:

- Set `SMS_PROVIDER` + `SMS_API_URL` + `SMS_API_KEY` in `.env` — queued SMS
  are delivered automatically whenever the link is up.
- Optionally run a nightly `rsync`/rclone of `data/backups/` to cloud storage.

## C. Cloud deployment (multi-school ready)

Any $5 VPS (or African hosts: Wanaport, Web4Africa, or AWS Cape Town region).

### With Docker (recommended)

```bash
git clone <this repo> && cd <repo>
echo "AUTH_SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')" > .env
docker compose up -d --build
```

Put a TLS reverse proxy in front (Caddy is the least work):

```
# Caddyfile
school.example.lr {
    reverse_proxy localhost:3000
}
```

`caddy run` gives you automatic HTTPS. **Never expose the app over plain HTTP
on the public internet** — the PWA service worker also requires HTTPS (or
localhost) to install.

### Without Docker

```bash
npm install --omit=dev
cp .env.example .env   # set AUTH_SECRET, PORT, SMS settings
npm run migrate
# keep it alive with systemd:
sudo tee /etc/systemd/system/school.service << 'EOF'
[Unit]
Description=Ma Weade School Suite
After=network.target
[Service]
WorkingDirectory=/opt/school
ExecStart=/usr/bin/node server/index.js
Restart=always
User=school
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now school
```

---

## First real school (no demo data)

1. Start with an empty database (`npm run migrate`, no seed).
2. Create the bootstrap admin directly:
   ```bash
   node -e "
   const {run}=require('./server/db/connection');
   const {uuid,hashSecret}=require('./server/utils/crypto');
   run(\"INSERT INTO schools (uuid,name,county,currency) VALUES (?,?,?,?)\", uuid(),'My School','Montserrado','LRD');
   run(\"INSERT INTO users (uuid,school_id,role,full_name,username,password_hash) VALUES (?,?,?,?,?,?)\",
       uuid(),1,'school_admin','Principal','principal',hashSecret('ChangeMe#Now1'));
   console.log('Admin created: principal / ChangeMe#Now1');"
   ```
3. Sign in → Settings → School profile (name, EMIS code, county).
4. Settings → add staff accounts; Academics → create the year, semesters,
   classes and subjects; Fees → fee structure; then enroll students (or CSV
   import).

## Configuration reference (.env)

| Variable | Default | Notes |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | |
| `DB_PATH` | `./data/school.db` | single SQLite file |
| `AUTH_SECRET` | change-me-please | **must** be changed; signs all sessions |
| `SESSION_MINUTES` | 480 | auto logout |
| `SMS_PROVIDER` | `outbox` | `outbox` (offline queue), `twilio`, `orange`, `mtn`, `custom` |
| `SMS_API_URL` / `SMS_API_KEY` / `SMS_SENDER_ID` | — | from your gateway contract |
| `MOMO_MTN_API_KEY` / `MOMO_ORANGE_API_KEY` | — | leave empty for manual mobile-money recording |
| `BACKUP_HOURS` | 24 | automatic snapshot interval; 0 disables |

## SMS gateway notes (Liberia)

- **Orange Liberia / Lonestar Cell MTN** sell bulk-SMS through local
  aggregators; ask for a simple HTTP POST API and set `SMS_PROVIDER=custom`
  with your endpoint + bearer key. The payload sent is
  `{to, from, message}` JSON.
- **Twilio** works immediately with `SMS_PROVIDER=twilio`,
  `SMS_API_URL=https://api.twilio.com/2010-04-01/Accounts/<SID>/Messages.json`,
  `SMS_API_KEY=<SID>:<AuthToken>` — but per-SMS cost is higher.
- **No gateway?** Leave `outbox` mode: Communication → export queued SMS as
  CSV and send them from a staff phone (or read them to parents at pickup).
