import json
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from .models import Classroom

class RoomStatusConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.channel_layer.group_add("room_updates", self.channel_name)
        await self.accept()
        
        # Send full snapshot immediately upon connect
        rooms_data = await self.get_all_rooms()
        await self.send(text_data=json.dumps({
            "type": "room_update",
            "rooms": rooms_data
        }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard("room_updates", self.channel_name)

    @classmethod
    async def broadcast(cls, channel_layer, rooms_data):
        await channel_layer.group_send(
            "room_updates",
            {
                "type": "push_room_update",
                "rooms": rooms_data
            }
        )
        
    async def push_room_update(self, event):
        rooms = event["rooms"]
        await self.send(text_data=json.dumps({
            "type": "room_update",
            "rooms": rooms
        }))

    @sync_to_async
    def get_all_rooms(self):
        return [
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
