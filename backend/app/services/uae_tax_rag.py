"""UAE Tax RAG — ChromaDB vector store for VAT / CT law snippets."""
from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_persist = os.getenv("CHROMADB_PERSIST_DIR", "./chromadb_data")
_instance: "UAETaxRAG | None" = None


class UAETaxRAG:
    """ChromaDB-backed UAE tax knowledge base (ported from uaetax rag/uae_tax_rag.py)."""

    def __init__(self, persist_directory: str | None = None) -> None:
        import chromadb
        from chromadb.config import Settings

        path = persist_directory or _persist
        os.makedirs(path, exist_ok=True)
        self.client = chromadb.PersistentClient(
            path=path,
            settings=Settings(anonymized_telemetry=False, allow_reset=True),
        )
        self.collections = {
            "uae_vat_law": self.client.get_or_create_collection(
                name="uae_vat_law",
                metadata={"description": "UAE VAT Decree-Law No. 8 of 2017"},
            ),
            "uae_corporate_tax_law": self.client.get_or_create_collection(
                name="uae_corporate_tax_law",
                metadata={"description": "UAE Corporate Tax Law"},
            ),
            "fta_public_clarifications": self.client.get_or_create_collection(
                name="fta_public_clarifications",
                metadata={"description": "FTA clarifications"},
            ),
            "free_zone_regulations": self.client.get_or_create_collection(
                name="free_zone_regulations",
                metadata={"description": "Free zone regulations"},
            ),
        }
        self._seed_if_empty()

    def _seed_if_empty(self) -> None:
        if self.collections["uae_vat_law"].count() > 0:
            return
        docs = [
            ("vat_001", "Standard rate 5% applies to most goods and services in UAE mainland.", {"category": "standard_rate"}),
            ("vat_002", "Zero rate applies to exports and international transport.", {"category": "zero_rate"}),
            ("vat_003", "Exempt supplies include bare land and certain financial services.", {"category": "exempt"}),
            ("vat_004", "Reverse charge applies to imported services where recipient accounts for VAT.", {"category": "reverse_charge"}),
            ("vat_005", "Art. 53 blocks input VAT recovery on entertainment and hospitality.", {"category": "blocked_input"}),
            ("ct_001", "Mainland entities: 0% CT on first AED 375,000; 9% above.", {"category": "mainland_ct"}),
            ("ct_002", "QFZP may qualify for 0% on qualifying free zone income.", {"category": "qfzp"}),
            ("fz_001", "Designated zone supplies may be outside UAE VAT scope.", {"category": "free_zone"}),
        ]
        for coll, items in [
            ("uae_vat_law", docs[:5]),
            ("uae_corporate_tax_law", docs[5:7]),
            ("free_zone_regulations", docs[7:]),
        ]:
            ids, texts, metas = zip(*[(i[0], i[1], i[2]) for i in items])
            self.collections[coll].add(documents=list(texts), metadatas=list(metas), ids=list(ids))
        logger.info("UAETaxRAG: seeded default UAE tax documents")

    def query(self, question: str, collection_name: str = "uae_vat_law", n_results: int = 3) -> list[dict[str, Any]]:
        coll = self.collections.get(collection_name)
        if not coll:
            return []
        try:
            results = coll.query(query_texts=[question], n_results=n_results)
            out: list[dict[str, Any]] = []
            docs = results.get("documents") or [[]]
            if docs and docs[0]:
                for i, text in enumerate(docs[0]):
                    out.append({
                        "text": text,
                        "metadata": (results.get("metadatas") or [[]])[0][i] if results.get("metadatas") else {},
                        "id": (results.get("ids") or [[]])[0][i] if results.get("ids") else None,
                    })
            return out
        except Exception as exc:
            logger.warning("ChromaDB query failed: %s", exc)
            return []

    def retrieve_and_format(self, query: str, law_type: str = "VAT") -> tuple[str, list[str]]:
        """Used by embedded classifier — returns (context_text, source_ids)."""
        coll = "uae_vat_law"
        if law_type.upper() in ("CT", "CORPORATE"):
            coll = "uae_corporate_tax_law"
        elif law_type.upper() in ("FZ", "FREE_ZONE"):
            coll = "free_zone_regulations"
        hits = self.query(query, collection_name=coll, n_results=3)
        if law_type.upper() == "VAT":
            hits += self.query(query, collection_name="fta_public_clarifications", n_results=2)
        if not hits:
            return "", []
        lines = []
        sources: list[str] = []
        for i, h in enumerate(hits[:5], 1):
            lines.append(f"{i}. {h['text']}")
            if h.get("id"):
                sources.append(str(h["id"]))
        return "\n".join(lines), sources


def get_rag_instance() -> UAETaxRAG | None:
    global _instance
    if _instance is not None:
        return _instance
    try:
        _instance = UAETaxRAG()
        return _instance
    except Exception as exc:
        logger.warning("UAETaxRAG unavailable: %s", exc)
        return None
