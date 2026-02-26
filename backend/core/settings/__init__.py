import os


DJANGO_ENV = os.getenv("DJANGO_ENV", "dev").strip().lower()

if DJANGO_ENV == "prod":
    from .prod import *  # noqa: F401,F403
elif DJANGO_ENV == "base":
    from .base import *  # noqa: F401,F403
else:
    from .dev import *  # noqa: F401,F403
