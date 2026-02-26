from .base import *  # noqa: F401,F403

DEBUG = True

# Development-only: allow LAN/mobile demo access regardless of host header.
ALLOWED_HOSTS = ["*"]

CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOWED_ORIGINS = []
CORS_ALLOW_CREDENTIALS = True

GRAPH_CACHE_TTL_SECONDS = 30
ANALYTICS_CACHE_TTL_SECONDS = 30

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "smart-navigation-dev-cache",
    }
}
