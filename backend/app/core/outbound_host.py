"""Hosts the server may connect to on a user's behalf (TallyPrime and other on-prem ERPs)."""
from __future__ import annotations

import ipaddress
import os
import socket

from fastapi import HTTPException


def private_hosts_allowed() -> bool:
    """On Render, loopback/private addresses reach our own infrastructure; ALLOW_PRIVATE_ERP_HOSTS=true overrides."""
    default = "false" if os.getenv("RENDER") else "true"
    return os.getenv("ALLOW_PRIVATE_ERP_HOSTS", default).strip().lower() in ("1", "true", "yes")


def require_public_host(host: str | None) -> None:
    """Raise 400 unless every address `host` resolves to is a public internet address."""
    if private_hosts_allowed():
        return
    name = (host or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tally host is required")
    try:
        infos = socket.getaddrinfo(name, None)
    except (socket.gaierror, UnicodeError) as exc:
        raise HTTPException(status_code=400, detail=f"Cannot resolve host {name!r}") from exc
    for info in infos:
        ip = ipaddress.ip_address(str(info[4][0]).split("%", 1)[0])
        if not ip.is_global:
            raise HTTPException(
                status_code=400,
                detail="Tally host must be a public address reachable from the cloud (not localhost or a private network)",
            )
