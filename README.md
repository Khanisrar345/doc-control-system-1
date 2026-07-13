# Enterprise Document Control System (EDMS)

Professional construction document control system — dynamic Excel-driven register, dashboards, reports, branding, and role-based security.

## Features

- Secure login (bcrypt hashed passwords, sessions, roles)
- Roles: Super Admin, Admin, Document Controller, Reviewer, Viewer
- Super Admin user management (create / delete / reset password) without code changes
- Company & project branding (logos + project details)
- Excel import as live data source (auto-detects new types, statuses, disciplines)
- KPI dashboard + Chart.js charts
- Document register with advanced filters
- Transmittals, revision log, reports, weekly meeting summary
- Print / CSV export
- Responsive UI (desktop, tablet, mobile)

## Quick Start

1. Copy `.env.example` to `.env` and set `MONGODB_URI` + `SESSION_SECRET`
2. `npm install`
3. `npm start`
4. Open http://localhost:3000

## First Login

On first start, Super Admin is created automatically.  
**Credentials are printed only in the server console** (never on the login page).  
Change the password immediately under Manage Users.

## Deploy (Render)

1. Push this repo to GitHub
2. Render → New Web Service → connect repo
3. Build: `npm install` | Start: `node server.js`
4. Add env vars: `MONGODB_URI`, `SESSION_SECRET`

## Excel columns (flexible headers)

Doc Number, Type, Title, Rev, Status, Discipline, Area, Package, Contractor, Consultant, Issue Date, Due Date, Response Date, Remarks, etc.

© Document Control System