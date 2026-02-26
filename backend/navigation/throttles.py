import logging

from rest_framework.throttling import UserRateThrottle

logger = logging.getLogger("navigation")


class LoggedUserRateThrottle(UserRateThrottle):
    scope = "user"

    def allow_request(self, request, view):
        self.request = request
        self.view = view
        return super().allow_request(request, view)

    def throttle_failure(self):
        request = getattr(self, "request", None)
        user_id = getattr(getattr(request, "user", None), "id", None)
        path = request.path if request else ""
        scope = getattr(self, "scope", "unknown")

        logger.warning(
            "Throttle hit scope=%s user_id=%s path=%s",
            scope,
            user_id,
            path,
        )
        return super().throttle_failure()


class NavigationSessionThrottle(LoggedUserRateThrottle):
    scope = "navigation_session"


class AnalyticsThrottle(LoggedUserRateThrottle):
    scope = "analytics"


class AnalyticsExportThrottle(LoggedUserRateThrottle):
    scope = "analytics_export"
