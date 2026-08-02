"""Microsoft Entra ID (Azure AD) sign-in helpers.

This implements the OAuth2 "authorization code" flow used to let internal users
sign in with their Microsoft account:

    1. Redirect the browser to Microsoft's authorize endpoint (see ``authorize_url``).
    2. Microsoft sends the browser back to our callback with a short-lived ``code``.
    3. We exchange that ``code`` for an access token (``exchange_code_for_token``).
    4. We call Microsoft Graph ``/me`` to read the person's stable object ID and profile.
    5. The caller maps that identity to an existing user or provisions a guest.

Only the identity of the user is needed, so we request the minimal Graph scopes.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from app.config import Settings

# Minimal scopes: enough to authenticate the account and read the profile/email.
# (Kept intentionally small — we only use Microsoft to prove identity.)
DEFAULT_SCOPES = ("openid", "profile", "email", "User.Read")

_HTTP_TIMEOUT = httpx.Timeout(20.0)


class MicrosoftAuthError(RuntimeError):
    """Raised when the Microsoft sign-in flow cannot be completed."""


@dataclass(frozen=True)
class MicrosoftAuthConfig:
    tenant_id: str
    client_id: str
    client_secret: str
    redirect_uri: str

    @property
    def is_configured(self) -> bool:
        return bool(self.tenant_id and self.client_id and self.client_secret)

    @property
    def authorize_endpoint(self) -> str:
        return f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/authorize"

    @property
    def token_endpoint(self) -> str:
        return f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"


@dataclass(frozen=True)
class MicrosoftUserProfile:
    object_id: str
    email: str
    display_name: str


def build_config(settings: Settings, *, redirect_uri: str) -> MicrosoftAuthConfig:
    """Assemble the effective config, preferring an explicit configured redirect URI."""
    effective_redirect = settings.microsoft_redirect_uri.strip() or redirect_uri
    return MicrosoftAuthConfig(
        tenant_id=settings.microsoft_tenant_id.strip(),
        client_id=settings.microsoft_client_id.strip(),
        client_secret=settings.microsoft_client_secret.strip(),
        redirect_uri=effective_redirect,
    )


def authorize_url(config: MicrosoftAuthConfig, *, state: str) -> str:
    params = {
        "client_id": config.client_id,
        "response_type": "code",
        "redirect_uri": config.redirect_uri,
        "response_mode": "query",
        "scope": " ".join(DEFAULT_SCOPES),
        "state": state,
        "prompt": "select_account",
        # Keep account discovery on the Entra work/school path. Without this,
        # Microsoft may select a personal (live.com) identity that happens to
        # use the same email address and the tenant will correctly reject it.
        "domain_hint": "organizations",
    }
    return f"{config.authorize_endpoint}?{urlencode(params)}"


async def exchange_code_for_token(config: MicrosoftAuthConfig, *, code: str) -> str:
    """Swap the authorization code for an access token. Returns the access token."""
    data = {
        "client_id": config.client_id,
        "client_secret": config.client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": config.redirect_uri,
    }
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        try:
            response = await client.post(config.token_endpoint, data=data)
        except httpx.HTTPError as exc:  # network/timeout
            raise MicrosoftAuthError("No fue posible conectar con Microsoft.") from exc

    payload = _safe_json(response)
    access_token = payload.get("access_token")
    if response.status_code >= 400 or not access_token:
        detail = payload.get("error_description") or payload.get("error") or "No se pudo obtener el token."
        raise MicrosoftAuthError(f"Fallo la autenticación con Microsoft: {detail}")
    return str(access_token)


async def fetch_user_profile(access_token: str) -> MicrosoftUserProfile:
    """Read the signed-in user's stable ID and basic profile from Microsoft Graph."""
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    url = "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName,id"
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        try:
            response = await client.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise MicrosoftAuthError("No fue posible leer el perfil desde Microsoft.") from exc

    payload = _safe_json(response)
    if response.status_code >= 400:
        detail = payload.get("error", {}).get("message") if isinstance(payload.get("error"), dict) else None
        raise MicrosoftAuthError(f"Fallo la lectura del perfil de Microsoft: {detail or 'respuesta inválida.'}")

    email = str(payload.get("mail") or payload.get("userPrincipalName") or "").strip()
    if not email:
        raise MicrosoftAuthError("Tu cuenta Microsoft no entregó un correo utilizable para el ingreso.")
    object_id = str(payload.get("id") or "").strip()
    if not object_id:
        raise MicrosoftAuthError("Tu cuenta Microsoft no entregó un identificador utilizable para el ingreso.")
    display_name = str(payload.get("displayName") or email).strip()
    return MicrosoftUserProfile(object_id=object_id, email=email, display_name=display_name)


def _safe_json(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}
