"""Knowledge base retrieval tool - swappable backend via KB_BACKEND env var."""
import os

KB_BACKEND = os.environ.get("KB_BACKEND", "local")

if KB_BACKEND == "bedrock":
    from strands_tools import retrieve
else:
    from tools.local_kb import retrieve

__all__ = ["retrieve"]
