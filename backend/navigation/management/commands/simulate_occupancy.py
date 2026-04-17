import time
import random
from django.core.management.base import BaseCommand
from navigation.models import Classroom
from navigation.consumers import RoomStatusConsumer
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

class Command(BaseCommand):
    help = 'Simulates live room occupancy changes for WebSocket demo'

    def handle(self, *args, **kwargs):
        self.stdout.write("Starting live occupancy simulator... Press Ctrl+C to exit")
        channel_layer = get_channel_layer()
        
        while True:
            time.sleep(15)
            rooms = list(Classroom.objects.all())
            if not rooms:
                continue
            
            num_flips = random.randint(1, 3)
            flipped = random.sample(rooms, min(num_flips, len(rooms)))
            
            for room in flipped:
                room.status = "available" if room.status == "occupied" else "occupied"
                room.save(update_fields=['status'])
                self.stdout.write(self.style.SUCCESS(f"Flipped {room.name} ({room.room_id}) to {room.status}"))
                
            all_rooms = [
                {
                    'room_id': c.room_id,
                    'name': c.name,
                    'building': c.building.name if c.building else "Unknown",
                    'floor': c.floor,
                    'capacity': c.capacity,
                    'status': c.status
                }
                for c in Classroom.objects.select_related('building').all()
            ]
            async_to_sync(RoomStatusConsumer.broadcast)(channel_layer, all_rooms)
