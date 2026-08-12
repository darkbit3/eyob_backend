# BidLow Backend API
Node.js + TypeScript REST API backed by **Neon PostgreSQL**.

## Setup

### 1. Get your Neon connection string
1. Go to [neon.tech](https://neon.tech) → Create project → Copy connection string
2. Open `c:\all project\eyob\backend\.env`
3. Replace `DATABASE_URL=postgresql://user:password@ep-xxx...` with your real string

### 2. Install & Run
```bash
cd "c:\all project\eyob\backend"
npm install

# Create all tables in Neon
npm run db:migrate

# Seed with 15 users, 10 auctions, 10 products, sample bids
npm run db:seed

# Start dev server (hot-reload)
npm run dev
```
Server runs on **http://localhost:3000**

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/register` | Public | Register new user |
| POST | `/api/auth/login` | Public | Login, receive JWT |
| GET | `/api/auctions` | Public | List auctions (filter: status, category) |
| GET | `/api/auctions/:id` | Public | Get single auction |
| POST | `/api/auctions` | Admin | Create auction |
| PATCH | `/api/auctions/:id` | Admin | Edit auction |
| PATCH | `/api/auctions/:id/status` | Admin | Pause/resume/cancel |
| GET | `/api/products` | Public | List products |
| POST | `/api/products` | Admin | Create product |
| PATCH | `/api/products/:id` | Admin | Update product |
| DELETE | `/api/products/:id` | Admin | Delete product |
| GET | `/api/users` | Admin | List all users |
| GET | `/api/users/me` | Auth | Own profile |
| PATCH | `/api/users/:id/status` | Admin | Suspend/activate |
| DELETE | `/api/users/:id` | Super Admin | Delete user |
| PATCH | `/api/users/:id/wallet` | Admin | Manual balance adjustment |
| POST | `/api/bids` | Auth | Place a bid (deducts 1 credit) |
| GET | `/api/bids/auction/:id` | Auth | Bid log for an auction |
| GET | `/api/bids/my` | Auth | My bid history |
| POST | `/api/bids/auction/:id/finalize` | Admin | Close & pick winner (auto algorithm) |
| GET | `/api/wallet/queue` | Admin | Payment verification queue |
| POST | `/api/wallet/queue` | Auth | Submit payment receipt |
| PATCH | `/api/wallet/queue/:id/approve` | Admin | Approve & credit user |
| PATCH | `/api/wallet/queue/:id/reject` | Admin | Reject payment |
| GET | `/api/wallet/transactions` | Admin | All transactions |
| GET | `/api/wallet/transactions/my` | Auth | Own transactions |
| GET | `/api/notifications/my` | Auth | Inbox notifications |
| PATCH | `/api/notifications/:id/read` | Auth | Mark read |
| GET | `/api/notifications/announcements` | Public | Announcements feed |
| POST | `/api/notifications/announcements` | Admin | Broadcast announcement |
| GET | `/api/winners` | Admin | All winners |
| GET | `/api/winners/:id/bids` | Auth | Bid transparency log |
| GET | `/api/winners/report/stats` | Admin | Winner stats |
| GET | `/api/reports/dashboard` | Admin | KPI summary |
| GET | `/api/reports/revenue` | Admin | Monthly revenue |
| GET | `/api/reports/users` | Admin | User growth |
| GET | `/api/reports/categories` | Admin | Category performance |
| GET | `/api/reports/payments` | Admin | Payment method breakdown |
| GET | `/api/audit` | Admin | Immutable audit log |
| GET | `/api/settings` | Admin | Platform settings |
| PATCH | `/api/settings` | Admin | Update settings |

---

## Authentication
All protected routes require:
```
Authorization: Bearer <JWT_TOKEN>
```
JWT is returned on `/api/auth/login`.

---

## Winner Algorithm
The lowest unique bid engine runs **automatically** on every bid placed and on auction finalization (`POST /api/bids/auction/:id/finalize`). It:
1. Counts occurrences of every bid amount in the auction
2. Marks bids with duplicates as `is_duplicate = true`
3. The lowest amount that appears **exactly once** wins
4. Updates `winner_id`, `winner_name`, `lowest_unique_bid` on the auction
5. Sends a winner notification
6. Records to audit log

**No admin can manually override the winner** — this is enforced at the API level.

---

## Running all 3 apps together
```bash
# Terminal 1 — Backend API  (port 3000)
cd "c:\all project\eyob\backend" && npm run dev

# Terminal 2 — Customer Frontend  (port 5173)
cd "c:\all project\eyob\frontend" && npm run dev

# Terminal 3 — Admin Panel  (port 5174)
cd "c:\all project\eyob\admin" && npm run dev
```
