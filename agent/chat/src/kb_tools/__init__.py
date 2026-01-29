"""Knowledge base retrieval tool - swappable backend via KB_BACKEND env var."""
import os

KB_BACKEND = os.environ.get("KB_BACKEND", "bedrock")

if KB_BACKEND == "local":
    from src.kb_tools.local_kb import retrieve  # requires chromadb
else:
    from strands_tools import retrieve

__all__ = ["retrieve"]
