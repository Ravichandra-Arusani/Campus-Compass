# Docker Deployment

## Services
- `db`: PostgreSQL 15 with persistent volume
- `redis`: Redis 7 for cache backend
- `backend`: Django + Gunicorn
- `frontend`: Vite build served by Nginx
- `nginx`: reverse proxy and static/media serving

## First Run
1. Copy `backend/.env.docker` and replace secrets/hosts for your environment.
2. Start stack:
   - `docker compose up --build -d`
3. Check health:
   - `docker compose ps`
4. Open:
   - `http://localhost/`

## Routing
- `/api/` -> backend service
- `/admin/` -> backend admin
- `/` -> frontend app
- `/static/` -> Django collected static files
- `/media/` -> backend media volume

## Notes
- Backend entrypoint runs:
  - `python manage.py migrate --noinput`
  - `python manage.py collectstatic --noinput`
  - Gunicorn startup
- For HTTPS production, set strict security values in backend env and terminate TLS at Nginx/LB.
