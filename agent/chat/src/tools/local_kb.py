"""Local ChromaDB-backed retrieve tool matching strands_tools.retrieve interface."""
import os
import chromadb
from strands import tool

CHROMA_HOST = os.environ.get("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.environ.get("CHROMA_PORT", "8000"))
COLLECTION_NAME = os.environ.get("KB_COLLECTION", "edgemind_sops")


def _get_collection():
    client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    return client.get_or_create_collection(name=COLLECTION_NAME)


@tool
def retrieve(query: str, max_results: int = 5, min_score: float = 0.0) -> list[dict]:
    """Retrieve relevant documents from the knowledge base.
    
    Args:
        query: Search query to find relevant documents
        max_results: Maximum number of results to return
        min_score: Minimum relevance score (0-1) to include results
    
    Returns:
        List of matching documents with content and metadata
    """
    collection = _get_collection()
    
    results = collection.query(
        query_texts=[query],
        n_results=max_results,
        include=["documents", "metadatas", "distances"]
    )
    
    docs = []
    for i, doc in enumerate(results["documents"][0] if results["documents"] else []):
        # ChromaDB returns L2 distance, convert to similarity score (0-1)
        distance = results["distances"][0][i] if results["distances"] else 0
        score = 1 / (1 + distance)
        
        if score >= min_score:
            docs.append({
                "content": doc,
                "score": score,
                "metadata": results["metadatas"][0][i] if results["metadatas"] else {}
            })
    
    return docs
