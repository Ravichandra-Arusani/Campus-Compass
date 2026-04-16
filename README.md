# 🧭 Campus Compass

A smart campus navigation system with real-time classroom availability, indoor/outdoor wayfinding, and an analytics dashboard.

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite, MapLibre GL, Recharts |
| Backend | Django 6 + Django REST Framework |
| Database | PostgreSQL 15 |
| Cache | Redis 7 |
| Reverse Proxy | Nginx |
| Containerisation | Docker + Docker Compose |

---

## 🔗 Live Demo

| | URL |
|---|---|
| **Frontend App** | *(add Vercel URL after deploying)* |
| **Backend API** | *(add Render URL after deploying)* |

> ⚠️ Backend is on Render free tier — it sleeps after 15 min of inactivity. First request may take ~30s to wake up.

---

## ☁️ Cloud Deployment Guide

### Backend → [Render.com](https://render.com) (Free Tier)

1. Go to **render.com** → sign in with GitHub → **New → Web Service**
2. Select the `Campus-Compass` repo
3. Set these fields exactly:

   | Field | Value |
   |---|---|
   | **Root Directory** | `backend` |
   | **Runtime** | `Python 3` |
   | **Build Command** | `pip install -r requirements.txt` |
   | **Start Command** | `gunicorn core.wsgi:application --bind 0.0.0.0:$PORT --workers 2 --timeout 60` |

4. In **Environment → Add Environment Variables**:

   | Variable | Value |
   |---|---|
   | `DJANGO_ENV` | `prod` |
   | `DJANGO_SECRET_KEY` | *(generate: `python -c "import secrets; print(secrets.token_hex(50))"`)* |
   | `DJANGO_ALLOWED_HOSTS` | `your-app.onrender.com` |
   | `CORS_ALLOWED_ORIGINS` | `https://your-app.vercel.app` |
   | `DATABASE_URL` | *(from Render Postgres add-on — use the Internal URL)* |
   | `SECURE_SSL_REDIRECT` | `False` *(Render handles TLS)* |
   | `SESSION_COOKIE_SECURE` | `True` |
   | `CSRF_COOKIE_SECURE` | `True` |

5. After first deploy, run migrations via **Render Shell**:
   ```bash
   python manage.py migrate
   python manage.py seed_campus
   python manage.py seed_data
   ```

---

### Frontend → [Vercel](https://vercel.com) (Free Tier)

1. Go to **vercel.com** → sign in with GitHub → **New Project**
2. Import `Campus-Compass` repo
3. Set these fields exactly:

   | Field | Value |
   |---|---|
   | **Root Directory** | `smart-campus-navigation` |
   | **Framework Preset** | `Vite` |
   | **Build Command** | `npm run build` |
   | **Output Directory** | `dist` *(Vite outputs to `dist`, not `build`)* |

4. In **Environment Variables**:

   | Variable | Value |
   |---|---|
   | `VITE_API_BASE` | `https://your-app.onrender.com/api` |

5. Click **Deploy** → get URL like `https://campus-compass.vercel.app`

> 💡 After getting both URLs, update the **Live Demo** section above in this README.

---

## 🚀 Quickstart — No Local Dependencies Required

> **You only need [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed.** No Node.js, Python, or database setup needed.

### 1. Clone the repository

```bash
git clone https://github.com/Ravichandra-Arusani/Campus-Compass.git
cd Campus-Compass
```

### 2. Set up environment for Docker

```bash
# Windows (PowerShell):
copy backend\.env.docker.example backend\.env.docker

# macOS / Linux:
cp backend/.env.docker.example backend/.env.docker
```

> The defaults in `.env.docker.example` work out of the box for local use. No edits needed.

### 3. Start the full stack

```bash
docker compose up --build
```

Docker will automatically:
- Build the React frontend and serve it via Nginx
- Build and run the Django backend with Gunicorn
- Start PostgreSQL and Redis
- Run database migrations
- Collect static files

### 3. Open the app

```
http://localhost/
```

> **First build takes a few minutes** as Docker pulls images and installs dependencies. Subsequent starts are much faster.

---

## 🗂️ Project Structure

```
Campus-Compass/
├── backend/                    # Django REST API
│   ├── core/                   # Django project settings
│   │   └── settings/
│   │       ├── base.py         # Shared settings
│   │       ├── dev.py          # Development overrides
│   │       └── prod.py         # Production overrides
│   ├── navigation/             # Main app
│   │   ├── models.py           # DB models (Buildings, Nodes, Rooms, etc.)
│   │   ├── views.py            # API endpoints
│   │   ├── serializers.py      # DRF serializers
│   │   ├── pathfinding.py      # Route computation logic
│   │   ├── urls.py             # API URL routing
│   │   └── management/
│   │       └── commands/
│   │           ├── seed_campus.py      # Seed campus data
│   │           └── seed_data.py        # Seed general data
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── entrypoint.sh           # Migrate → collectstatic → Gunicorn
│   ├── .env.example            # Production env template
│   └── .env.docker.example     # Docker Compose env template (copy → .env.docker to run)
│
├── smart-campus-navigation/    # React + Vite frontend
│   ├── src/
│   │   ├── components/         # UI components
│   │   │   ├── CampusMap.jsx
│   │   │   ├── IndoorNavigation.jsx
│   │   │   ├── RoomAvailability.jsx
│   │   │   ├── DestinationSearch.jsx
│   │   │   ├── AdminPanel.jsx
│   │   │   └── ...
│   │   ├── navigation/         # Routing algorithms
│   │   │   ├── dijkstra.js
│   │   │   └── generateInstructions.js
│   │   ├── outdoor/            # Outdoor graph & A* pathfinding
│   │   ├── indoor/             # Indoor graph & A* pathfinding
│   │   ├── services/           # API client & auth
│   │   ├── tabs/               # MapView, Analytics, HelpPanel
│   │   └── data/               # Static campus blueprint & entrances
│   ├── public/
│   │   └── data/
│   │       ├── Campus map.geojson
│   │       └── Roads.geojson
│   ├── Dockerfile
│   ├── vite.config.js
│   └── package.json
│
├── deployment/
│   ├── nginx.conf              # Nginx reverse proxy config
│   └── README.md               # Deployment notes
│
├── docker-compose.yml          # Full stack orchestration
└── .gitignore
```

---

## ⚙️ Configuration

### Docker (default — works out of the box)

The file `backend/.env.docker` is pre-configured for local Docker Compose use. **No changes needed to run locally.**

### Production deployment

Copy `.env.example` and fill in your values:

```bash
cp backend/.env.example backend/.env.prod
```

Key variables to set:

| Variable | Description |
|---|---|
| `DJANGO_SECRET_KEY` | Strong random secret key |
| `DJANGO_ALLOWED_HOSTS` | Your domain(s), comma-separated |
| `CORS_ALLOWED_ORIGINS` | Frontend origin URL |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `SENTRY_DSN` | (Optional) Sentry error tracking |

---

## 🐳 Docker Commands

```bash
# Start everything (builds on first run)
docker compose up --build

# Start in background
docker compose up -d

# Check service health
docker compose ps

# View logs
docker compose logs -f

# Stop all services
docker compose down

# Stop and delete volumes (resets database)
docker compose down -v
```

---

## 🌱 Seeding Data

After the stack is running, seed campus data:

```bash
# Seed campus buildings, nodes and rooms
docker compose exec backend python manage.py seed_campus

# Seed general navigation data
docker compose exec backend python manage.py seed_data
```

---

## 🔌 API Routing (via Nginx)

| Path | Destination |
|---|---|
| `/` | React frontend |
| `/api/` | Django REST API |
| `/admin/` | Django admin panel |
| `/static/` | Django collected static files |
| `/media/` | Backend media uploads |

---

## 🛠️ Local Development (without Docker)

Only needed if you want to modify code with hot reload.

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Copy and configure environment
cp .env.example .env
# Edit .env: set DATABASE_URL, REDIS_URL, DJANGO_SECRET_KEY

python manage.py migrate
python manage.py runserver
```

### Frontend

```bash
cd smart-campus-navigation
npm install
cp .env.example .env            # Set VITE_API_BASE if needed
npm run dev
```

Frontend runs at `http://localhost:5173`, backend at `http://localhost:8000`.

---

## 📍 Features

- **Outdoor navigation** — Map-based routing between campus buildings using road graph + A*
- **Indoor navigation** — Floor-level wayfinding with step-by-step instructions
- **Room availability** — Live classroom status
- **Destination search** — Fuzzy search powered by Fuse.js
- **Analytics dashboard** — Navigation usage stats with charts
- **Admin panel** — Manage buildings, rooms, and graph nodes
- **Staff access panel** — Role-based access for staff users
- **PWA ready** — Service worker included (`public/sw.js`)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

This project is open source. See the repository for details.
