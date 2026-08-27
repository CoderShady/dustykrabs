"""
WebSocket connection manager for real-time events.
Broadcasts queue updates, token calls, bed status changes, and patient turn notifications.
"""

from __future__ import annotations

import json
from typing import Any
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, event_type: str, data: dict[str, Any]) -> None:
        payload = json.dumps({"event": event_type, "data": data}, default=str)
        dead_connections: list[WebSocket] = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                dead_connections.append(connection)
        for conn in dead_connections:
            self.disconnect(conn)


manager = ConnectionManager()
