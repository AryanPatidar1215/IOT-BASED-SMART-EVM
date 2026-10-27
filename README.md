- npm run create-admin
- npm start

# Smart EVM

An RFID voting booth (ESP32) with a Node.js and MongoDB backend, an admin panel, and a public results page.

- Voters tap a card at the booth and press one of four buttons.
- Only the admin, signed in with their own credentials, can register voters.
- Ballots are stored with no card number attached, so a vote can't be traced to a person.
- Results stay sealed until the admin closes the election.
- Every admin and booth event goes into a hash-chained audit log that detects edits.

## Run it

You need Node.js 18+ and MongoDB running locally.

```bash
npm install
cp .env.example .env          # then set JWT_SECRET (see the comment in the file)
npm run create-admin          # asks for the admin username and password
npm start
```

- Public page: http://localhost:3000/
- Admin panel: http://localhost:3000/admin

Instead of `create-admin`, you can fill `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` and the first admin is created on startup. Remove the password from `.env` afterwards.

## First election, step by step

1. **Sign in** at `/admin`.
2. **Booths > Add booth.** Copy the `DEVICE_ID` and `DEVICE_KEY` shown once.
3. **Flash the ESP32** with `firmware/smart_evm.ino`: set Wi-Fi, `SERVER` (your computer's IPv4 address), and paste the two booth values. The booth appears online in the panel within 10 seconds.
4. **Election > Ballot:** set the title and 2 to 4 candidates. Each row matches a button: 1 white, 2 red, 3 yellow, 4 green.
5. **Voters > Add voter.** Enter the name and voter ID, choose **Scan at booth**, enter your admin password, then tap the voter's card on a booth. The card is registered. You can also type the card UID, or paste a list with **Import list**.
6. **Election > Open voting.** Booths now accept cards.
7. Watch **Overview** for turnout, booth activity and alerts. Results stay hidden.
8. **Close voting.** Results unseal on the Overview and public pages.
9. **Audit log > Verify the whole chain** to confirm nothing was edited.

## Who can do what

| Action | Needs |
|---|---|
| Add, import or enroll voters | Admin session **and** the admin password, every time |
| Block, unblock or remove a voter | Admin session |
| Open or close voting | Admin session |
| Reset an election | Admin session and password |
| Check a card, cast a vote | A booth with a valid device key |
| See turnout and results | Turnout: admin. Results: public, after close |

Booths can't create voters on their own. Enrollment only works inside a 60 second window that the admin arms with their password.

## How privacy works

- `voters` stores who is registered and whether they have voted. It never stores their choice.
- `votes` stores the choice, booth and a 5 minute time block. It never stores a card number or name.
- Voting claims the voter record with one atomic update (`hasVoted: false` to `true`), then inserts the ballot. If the insert fails, the claim is rolled back.
- Each vote request carries a random `reqId`. A retry after a network drop returns the same receipt instead of counting twice.
- The Overview page compares ballots stored with voters who voted, and warns if they differ.

## Project layout

```
server/
  server.js            app setup, security headers, admin bootstrap
  routes/              auth.js, admin.js, device.js, public.js
  middleware/auth.js   admin session, password re-check, booth key check
  services/            audit.js (hash chain), events.js (live updates), enroll.js
  scripts/createAdmin.js
public/
  index.html           public page (status, ballot, results, receipt check)
  admin.html           admin app (overview, voters, election, booths, audit, account)
  css/app.css  js/common.js  js/public.js  js/admin.js
firmware/smart_evm.ino ESP32 booth
```

## Booth API

All booth requests send `X-Device-Id` and `X-Device-Key` headers.

| Endpoint | Body | Reply `code` |
|---|---|---|
| `POST /api/device/heartbeat` | `{rssi, fw}` | n/a |
| `POST /api/device/check-voter` | `{uid}` | `OK`, `ALREADY_VOTED`, `NOT_REGISTERED`, `BLOCKED`, `NOT_OPEN`, `ENROLLED`, `DUPLICATE_CARD` |
| `POST /api/device/vote` | `{uid, option, reqId}` | `OK` (with `receipt`), `ALREADY_VOTED`, `NOT_OPEN`, `INVALID` |

## Before a real election

This is a strong teaching and demo build, not a certified voting system.

- **Use HTTPS.** Booth keys and admin sessions cross the network. Put the server behind a reverse proxy with TLS, then set `COOKIE_SECURE=true`, and change `SERVER` in the firmware to `https://`.
- **RFID UIDs can be cloned.** Add a second factor, such as a fingerprint sensor or a PIN, if card cloning is a real threat.
- **Back up MongoDB** and keep it off the public network.
- Keep `JWT_SECRET` long and private, and use a strong admin password.
