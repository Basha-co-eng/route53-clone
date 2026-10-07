# Route 53 Clone

A functional clone of the AWS Route 53 console (UI and workflows only, no real DNS).
Hosted zones and DNS records are stored in SQLite and served by a FastAPI backend.

> **Note:** the frontend is plain HTML/CSS/JavaScript. The original assignment asks for
> Next.js + TypeScript; see "Possible improvements".

## Features
- Mock login, logout and session persistence (token kept in `localStorage`, sessions stored in SQLite)
- Hosted zones: view, search, create, edit (description), delete, pagination
- DNS records: view, search, filter by type, create, edit, delete, pagination
- Record types: A, AAAA, CNAME, TXT, MX, NS, PTR, SRV, CAA (SOA is created automatically)
- New zones get default NS and SOA records, which are protected from edit/delete (as in Route 53)
- Validation on both client and server (IPv4/IPv6, MX, SRV, CAA formats, CNAME rules, duplicates)
- Route 53-style layout: navy top bar, sidebar, orange buttons, modals, toast notifications
- "Coming soon" pages for Dashboard, Health checks, Traffic policies, Resolver, Profiles

## Project structure
```
route53-clone/
├── frontend/
│   ├── index.html        # page shell: login, top bar, sidebar, modal/toast roots
│   ├── styles.css        # Route 53 look and feel
│   └── app.js            # router, API client, zones + records views, modals
├── backend/
│   ├── main.py           # FastAPI app, CORS, startup (create tables, seed admin)
│   ├── database.py       # SQLAlchemy engine and session
│   ├── models.py         # ORM tables
│   ├── schemas.py        # Pydantic request/response models
│   ├── auth.py           # password hashing, login/logout/me, auth dependency
│   ├── routers/
│   │   ├── zones.py      # hosted zone endpoints
│   │   └── records.py    # DNS record endpoints + validation
│   └── requirements.txt
├── .gitignore
└── README.md
```

## Setup

### Prerequisites
Python 3.11+, Git, and any modern browser. (SQLite is built into Python.)

### 1. Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```
The API runs at http://localhost:8000. Interactive docs: http://localhost:8000/docs.
The database file `route53.db` is created automatically on first start.

### 2. Frontend
Serve the `frontend/` folder with any static server, for example:
```bash
cd frontend
python -m http.server 5500
```
Open http://localhost:5500 (or use the VS Code "Live Server" extension).

### 3. Sign in
Username `admin`, password `admin123` (created automatically on first start).

To point the frontend at a different backend, change `API` at the top of `frontend/app.js`.

## Architecture
```
Browser (HTML/CSS/JS)  --JSON over HTTP, Bearer token-->  FastAPI  --SQLAlchemy-->  SQLite
```
- **Frontend:** a single-page app using hash routing (`#/hostedzones`, `#/zone/<id>`). `app.js`
  wraps `fetch` in one `api()` helper that adds the token and surfaces errors as toasts.
- **Backend:** routers handle HTTP, Pydantic schemas validate input, SQLAlchemy models persist data.
  Every `/zones` route requires a valid session token.
- **Auth:** login checks a PBKDF2-hashed password and stores a random token in the `sessions`
  table. Logging out deletes the row. This is deliberately simple (mock auth).

## Database schema
| Table | Columns |
|---|---|
| `users` | `id` PK, `username` UNIQUE, `password_hash` |
| `sessions` | `token` PK, `user_id` FK → users, `created_at` |
| `hosted_zones` | `id` PK, `name` UNIQUE, `type` (Public/Private), `description`, `created_at` |
| `records` | `id` PK, `zone_id` FK → hosted_zones (cascade delete), `name`, `type`, `value`, `ttl`, `routing_policy`, `created_at`; UNIQUE(`zone_id`, `name`, `type`) |

Records with several values (for example NS) store one value per line in `value`.

## API overview
All routes except `/auth/login` need the header `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | `{username, password}` → `{token}` |
| POST | `/auth/logout` | End the session |
| GET | `/auth/me` | Current user |
| GET | `/zones?search=&page=&page_size=` | List zones → `{items, total}` |
| POST | `/zones` | Create zone (adds default NS + SOA) |
| GET | `/zones/{id}` | Get one zone |
| PUT | `/zones/{id}` | Update description |
| DELETE | `/zones/{id}` | Delete zone and its records |
| GET | `/zones/{id}/records?search=&type=&page=&page_size=` | List records → `{items, total}` |
| POST | `/zones/{id}/records` | Create record |
| PUT | `/zones/{id}/records/{rid}` | Update record |
| DELETE | `/zones/{id}/records/{rid}` | Delete record |

Errors use standard HTTP codes: 400 invalid value, 401 not signed in, 404 not found, 409 duplicate/conflict.

## Deployment notes
- **Frontend:** any static host (Vercel, Netlify, GitHub Pages). Set `API` in `app.js` to the backend URL.
- **Backend:** Render or Railway. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`.
- Free tiers often use temporary disks, so the SQLite file can reset on redeploy. Fine for a demo.

## Possible improvements
- Port the frontend to Next.js + TypeScript (required by the original assignment)
- Dark mode, BIND import, JSON/BIND export, bulk operations, keyboard shortcuts
