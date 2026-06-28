"""
UAE Tax RAG service — Supabase pgvector backend.

Uses OpenAI embeddings when OPENAI_API_KEY is set (no local torch/sentence-transformers).
Falls back gracefully when unavailable so VAT classification never fails.
"""

from __future__ import annotations

import logging
import os
from typing import Callable, Optional

logger = logging.getLogger(__name__)

_EMBED_DIM = 384  # legacy RPC dimension; zero-pad/truncate OpenAI vectors if needed


class UAETaxRAG:
    """Retrieval-augmented generation service backed by Supabase pgvector."""

    def __init__(self) -> None:
        self._embed: Callable[[str], list[float]] | None = None
        self._sb = None
        self._ready = False
        import threading

        threading.Thread(target=self._load_safe, daemon=True).start()

    def _load_safe(self) -> None:
        try:
            self._load()
        except Exception as exc:  # noqa: BLE001
            logger.warning("UAETaxRAG init failed (RAG disabled): %s", exc)

    def _load(self) -> None:
        api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
        if not api_key:
            logger.info(
                "UAETaxRAG: OPENAI_API_KEY not set — pgvector RAG disabled "
                "(no sentence-transformers/torch required)"
            )
            return

        from openai import OpenAI  # type: ignore

        client = OpenAI(api_key=api_key)

        def _openai_embed(text: str) -> list[float]:
            resp = client.embeddings.create(
                model=os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
                input=text,
            )
            vec = list(resp.data[0].embedding)
            if len(vec) >= _EMBED_DIM:
                return vec[:_EMBED_DIM]
            return vec + [0.0] * (_EMBED_DIM - len(vec))

        self._embed = _openai_embed

        supabase_url = (
            os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or ""
        ).strip()
        supabase_key = (
            os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or ""
        ).strip()

        if not supabase_url or not supabase_key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for RAG"
            )

        from supabase import create_client  # type: ignore

        self._sb = create_client(supabase_url, supabase_key)
        self._ready = True
        logger.info("UAETaxRAG ready (OpenAI embeddings + Supabase pgvector)")

    @property
    def model(self):
        return self._embed

    def embed(self, text: str) -> list[float]:
        try:
            if self._embed is None:
                self._load()
            if self._embed is None:
                return [0.0] * _EMBED_DIM
            return self._embed(text)
        except Exception as exc:  # noqa: BLE001
            logger.warning("UAETaxRAG.embed failed: %s", exc)
            return [0.0] * _EMBED_DIM

    def retrieve(
        self,
        query: str,
        n_results: int = 8,
        law_type: Optional[str] = None,
    ) -> list[dict]:
        try:
            if not self._ready:
                return []
            embedding = self.embed(query)
            params: dict = {
                "query_embedding": embedding,
                "match_count": n_results,
                "filter_law_type": law_type,
            }
            response = self._sb.rpc("search_uae_tax_kb", params).execute()  # type: ignore[union-attr]
            return response.data or []
        except Exception as exc:  # noqa: BLE001
            logger.warning("UAETaxRAG.retrieve failed: %s", exc)
            return []

    def format_context(self, chunks: list[dict]) -> str:
        if not chunks:
            return ""
        parts: list[str] = []
        for chunk in chunks:
            doc_name = chunk.get("doc_name", "Unknown")
            jurisdiction = chunk.get("jurisdiction", "")
            content = chunk.get("content", "")
            parts.append(f"[SOURCE: {doc_name} | {jurisdiction}]\n{content}\n---")
        return "\n".join(parts)

    def retrieve_and_format(
        self,
        query: str,
        law_type: Optional[str] = None,
    ) -> tuple[str, list[str]]:
        try:
            chunks = self.retrieve(query, law_type=law_type)
            context = self.format_context(chunks)
            sources = list({c.get("doc_name", "") for c in chunks if c.get("doc_name")})
            return context, sources
        except Exception as exc:  # noqa: BLE001
            logger.warning("UAETaxRAG.retrieve_and_format failed: %s", exc)
            return "", []


try:
    uae_tax_rag = UAETaxRAG()
except Exception as _exc:  # noqa: BLE001
    logger.warning("UAETaxRAG singleton creation failed: %s", _exc)

    class _FallbackRAG:  # type: ignore[no-redef]
        @property
        def model(self):
            return None

        def embed(self, text: str) -> list[float]:
            return [0.0] * _EMBED_DIM

        def retrieve(self, query: str, n_results: int = 8, law_type: Optional[str] = None) -> list[dict]:
            return []

        def format_context(self, chunks: list[dict]) -> str:
            return ""

        def retrieve_and_format(self, query: str, law_type: Optional[str] = None) -> tuple[str, list[str]]:
            return "", []

    uae_tax_rag = _FallbackRAG()  # type: ignore[assignment]
