from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import F, Q
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from django.utils import timezone


# ---------------------------------------------------------------------------
# Campus-level models used by the new navigate + availability APIs
# ---------------------------------------------------------------------------


class CampusBuilding(models.Model):
    """Building with GPS coordinates — used for seed_campus and availability API."""
    name = models.CharField(max_length=100, unique=True)
    latitude = models.FloatField()
    longitude = models.FloatField()
    short_code = models.CharField(max_length=20, unique=True, blank=True)

    def __str__(self):
        return self.name


class Classroom(models.Model):
    """Classroom / lab within a CampusBuilding, with available/occupied status."""

    class Status(models.TextChoices):
        AVAILABLE = "available", "Available"
        OCCUPIED = "occupied", "Occupied"

    room_id = models.CharField(max_length=32, unique=True)  # e.g. "N302"
    name = models.CharField(max_length=100)
    building = models.ForeignKey(
        CampusBuilding, related_name="classrooms", on_delete=models.CASCADE
    )
    floor = models.IntegerField(default=1)
    capacity = models.IntegerField(default=40)
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.AVAILABLE
    )

    def __str__(self):
        return f"{self.room_id} — {self.name} ({self.status})"


class CampusNode(models.Model):
    """Navigation node in the campus graph (outdoor + indoor)."""

    class NodeType(models.TextChoices):
        OUTDOOR = "outdoor", "Outdoor"
        INDOOR = "indoor", "Indoor"
        ENTRY = "entry", "Entry"
        CORRIDOR = "corridor", "Corridor"
        STAIRCASE = "staircase", "Staircase"

    node_id = models.CharField(max_length=64, unique=True)  # e.g. "MAIN_GATE"
    name = models.CharField(max_length=100)
    node_type = models.CharField(
        max_length=16, choices=NodeType.choices, default=NodeType.OUTDOOR
    )
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    floor = models.IntegerField(null=True, blank=True)
    building = models.ForeignKey(
        CampusBuilding, null=True, blank=True, on_delete=models.SET_NULL
    )

    def __str__(self):
        return f"{self.node_id} ({self.node_type})"


class CampusEdge(models.Model):
    """Directed edge between two CampusNodes."""

    from_node = models.ForeignKey(
        CampusNode, related_name="outgoing_campus_edges", on_delete=models.CASCADE
    )
    to_node = models.ForeignKey(
        CampusNode, related_name="incoming_campus_edges", on_delete=models.CASCADE
    )
    distance = models.FloatField(default=0.0)
    bidirectional = models.BooleanField(default=True)

    class Meta:
        unique_together = ("from_node", "to_node")

    def __str__(self):
        arrow = "<->" if self.bidirectional else "->"
        return f"{self.from_node.node_id} {arrow} {self.to_node.node_id}"


class Building(models.Model):
    name = models.CharField(max_length=100, unique=True)
    x = models.FloatField()
    y = models.FloatField()
    z = models.FloatField()

    def __str__(self):
        return self.name


class Room(models.Model):
    class RoomType(models.TextChoices):
        CLASSROOM = "CLASSROOM", "Classroom"
        LAB = "LAB", "Lab"
        AUDITORIUM = "AUDITORIUM", "Auditorium"

    building = models.ForeignKey(
        Building,
        related_name="rooms",
        on_delete=models.CASCADE,
    )
    name = models.CharField(max_length=50)
    type = models.CharField(
        max_length=16,
        choices=RoomType.choices,
        default=RoomType.CLASSROOM,
    )
    capacity = models.IntegerField()
    current_occupancy = models.IntegerField(default=0)

    def __str__(self):
        return f"{self.building.name} - {self.name}"


class Edge(models.Model):
    from_building = models.ForeignKey(
        Building,
        related_name="outgoing_edges",
        on_delete=models.CASCADE,
    )
    to_building = models.ForeignKey(
        Building,
        related_name="incoming_edges",
        on_delete=models.CASCADE,
    )
    weight = models.FloatField()

    class Meta:
        unique_together = ("from_building", "to_building")

    def __str__(self):
        return f"{self.from_building.name} -> {self.to_building.name}"


class Alert(models.Model):
    title = models.CharField(max_length=200)
    description = models.TextField()
    severity = models.CharField(max_length=50)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title


class Node(models.Model):
    class Kind(models.TextChoices):
        ROOM = "room", "Room"
        CONNECTOR = "connector", "Connector"

    class ConnectorType(models.TextChoices):
        STAIRS = "stairs", "Stairs"
        ELEVATOR = "elevator", "Elevator"

    id = models.CharField(max_length=64, primary_key=True)
    lat = models.FloatField()
    lng = models.FloatField()
    floor = models.IntegerField()
    building = models.CharField(max_length=100)
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=24, choices=Kind.choices)
    connector_type = models.CharField(
        max_length=24,
        choices=ConnectorType.choices,
        blank=True,
    )

    class Meta:
        ordering = ("building", "floor", "name")
        indexes = [
            models.Index(fields=["building"]),
            models.Index(fields=["floor"]),
            models.Index(fields=["building", "floor"]),
        ]

    def __str__(self):
        return f"{self.name} ({self.id})"


class NodeEdge(models.Model):
    class Mode(models.TextChoices):
        WALK = "walk", "Walk"
        STAIRS = "stairs", "Stairs"
        ELEVATOR = "elevator", "Elevator"

    from_node = models.ForeignKey(
        Node,
        related_name="outgoing_node_edges",
        on_delete=models.CASCADE,
    )
    to_node = models.ForeignKey(
        Node,
        related_name="incoming_node_edges",
        on_delete=models.CASCADE,
    )
    distance = models.FloatField()
    mode = models.CharField(max_length=24, choices=Mode.choices, default=Mode.WALK)

    class Meta:
        unique_together = ("from_node", "to_node")
        ordering = ("from_node_id", "to_node_id")
        indexes = [
            models.Index(fields=["from_node"]),
            models.Index(fields=["to_node"]),
            models.Index(fields=["mode"]),
        ]
        constraints = [
            models.CheckConstraint(
                check=~Q(from_node=F("to_node")),
                name="nodeedge_no_self_loop",
            ),
        ]

    def __str__(self):
        return f"{self.from_node_id} -> {self.to_node_id} ({self.mode})"

    def clean(self):
        if self.from_node_id and self.to_node_id and self.from_node_id == self.to_node_id:
            raise ValidationError("Self-loop edges not allowed.")

    def save(self, *args, **kwargs):
        ensure_reverse = kwargs.pop("ensure_reverse", True)
        self.full_clean()
        super().save(*args, **kwargs)

        if not ensure_reverse:
            return

        reverse_qs = NodeEdge.objects.filter(
            from_node=self.to_node,
            to_node=self.from_node,
        )
        if reverse_qs.exists():
            reverse_qs.update(distance=self.distance, mode=self.mode)
            return

        reverse_edge = NodeEdge(
            from_node=self.to_node,
            to_node=self.from_node,
            distance=self.distance,
            mode=self.mode,
        )
        reverse_edge.save(ensure_reverse=False)


class GraphVersion(models.Model):
    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at",)

    def __str__(self):
        return f"Graph v{self.version}"

    @classmethod
    def get_current(cls):
        instance, _ = cls.objects.get_or_create(pk=1, defaults={"version": 1})
        return instance

    @classmethod
    def bump(cls):
        with transaction.atomic():
            instance = cls.get_current()
            cls.objects.filter(pk=instance.pk).update(
                version=F("version") + 1,
                updated_at=timezone.now(),
            )
            instance.refresh_from_db(fields=["version", "updated_at"])
        return instance


class NavigationSession(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="navigation_sessions",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    start_node = models.ForeignKey(
        Node,
        related_name="started_sessions",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    end_node = models.ForeignKey(
        Node,
        related_name="ended_sessions",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    preference_mode = models.CharField(max_length=32, default="default")
    route_node_count = models.PositiveIntegerField(default=0)
    route_distance = models.FloatField(default=0)
    duration_seconds = models.FloatField(default=0)
    completed = models.BooleanField(default=False)
    route_node_ids = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["created_at"]),
            models.Index(fields=["preference_mode"]),
            models.Index(fields=["user", "created_at"]),
        ]

    def __str__(self):
        return (
            f"Session {self.id} {self.start_node_id}->{self.end_node_id} "
            f"({self.preference_mode})"
        )


class NavigationSessionNodeUsage(models.Model):
    session = models.ForeignKey(
        NavigationSession,
        related_name="node_usage_rows",
        on_delete=models.CASCADE,
    )
    node = models.ForeignKey(
        Node,
        related_name="session_usage_rows",
        on_delete=models.CASCADE,
    )
    floor = models.IntegerField()
    is_connector = models.BooleanField(default=False)
    hits = models.PositiveIntegerField(default=1)

    class Meta:
        unique_together = ("session", "node")
        indexes = [
            models.Index(fields=["session"]),
            models.Index(fields=["node"]),
            models.Index(fields=["floor"]),
            models.Index(fields=["is_connector"]),
            models.Index(fields=["session", "is_connector"]),
        ]

    def __str__(self):
        return f"Session {self.session_id} -> {self.node_id} ({self.hits})"


@receiver(post_save, sender=Node)
@receiver(post_delete, sender=Node)
@receiver(post_save, sender=NodeEdge)
@receiver(post_delete, sender=NodeEdge)
def bump_graph_version_on_graph_change(sender, **kwargs):
    GraphVersion.bump()
