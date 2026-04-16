#!/bin/sh
set -e

export DJANGO_ENV="${DJANGO_ENV:-prod}"

echo "Waiting for database migrations to succeed..."
until python manage.py migrate --noinput; do
  echo "Database unavailable, retrying in 2s..."
  sleep 2
done

echo "Collecting static files..."
python manage.py collectstatic --noinput

WORKERS="${GUNICORN_WORKERS:-4}"
TIMEOUT="${GUNICORN_TIMEOUT:-60}"
PORT="${PORT:-8000}"

echo "Starting Gunicorn with ${WORKERS} workers on port ${PORT}..."
exec gunicorn core.wsgi:application \
  --bind "0.0.0.0:${PORT}" \
  --workers "${WORKERS}" \
  --timeout "${TIMEOUT}" \
  --access-logfile - \
  --error-logfile -
