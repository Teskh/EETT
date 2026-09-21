from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class PrivateResponseMiddleware:
    """Keep user-specific responses and session cookies out of HTTP caches."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_private(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                # Static files may be cached only when no session cookie is sent.
                if not scope["path"].startswith("/static/") or "set-cookie" in headers:
                    headers["Cache-Control"] = "private, no-store"
                    headers["Pragma"] = "no-cache"
                    headers["Expires"] = "0"
                    headers.add_vary_header("Cookie")
            await send(message)

        await self.app(scope, receive, send_private)
