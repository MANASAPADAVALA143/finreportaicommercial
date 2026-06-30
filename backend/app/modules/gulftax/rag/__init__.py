"""GulfTax RAG package — classifier imports UAETaxRAG from here."""
from app.services.uae_tax_rag import UAETaxRAG, get_rag_instance

__all__ = ["UAETaxRAG", "get_rag_instance"]
