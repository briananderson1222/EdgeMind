#!/usr/bin/env python3
"""Ingest PDFs and images from knowledge-base folder into ChromaDB."""
import os
from pathlib import Path
import chromadb

try:
    import pymupdf
except ImportError:
    pymupdf = None

CHROMA_HOST = os.environ.get("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.environ.get("CHROMA_PORT", "8000"))
COLLECTION_NAME = os.environ.get("KB_COLLECTION", "edgemind_sops")
KB_PATH = Path(os.environ.get("KB_PATH", "/app/knowledge-base"))


def extract_pdf_text(path: Path) -> list[tuple[str, dict]]:
    """Extract text chunks from PDF, one per page."""
    if not pymupdf:
        print(f"  [WARN] pymupdf not installed, skipping {path.name}")
        return []
    
    chunks = []
    doc = pymupdf.open(path)
    for i, page in enumerate(doc):
        text = page.get_text().strip()
        if text:
            chunks.append((text, {"source": path.name, "page": i + 1, "type": "pdf"}))
    return chunks


def extract_image_text(path: Path) -> list[tuple[str, dict]]:
    """Use filename as searchable content for images."""
    name_text = path.stem.replace("_", " ").replace("-", " ")
    return [(f"Process diagram: {name_text}", {"source": path.name, "type": "image"})]


def ingest():
    """Ingest all documents from knowledge-base folder."""
    client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    
    try:
        client.delete_collection(COLLECTION_NAME)
        print(f"Deleted existing collection '{COLLECTION_NAME}'")
    except Exception:
        pass
    
    collection = client.create_collection(name=COLLECTION_NAME)
    
    documents, metadatas, ids = [], [], []
    
    for path in KB_PATH.iterdir():
        if path.suffix.lower() == ".pdf":
            print(f"Processing PDF: {path.name}")
            for text, meta in extract_pdf_text(path):
                documents.append(text)
                metadatas.append(meta)
                ids.append(f"{path.stem}_p{meta.get('page', 0)}")
        
        elif path.suffix.lower() in (".png", ".jpg", ".jpeg"):
            print(f"Processing image: {path.name}")
            for text, meta in extract_image_text(path):
                documents.append(text)
                metadatas.append(meta)
                ids.append(path.stem)
    
    if documents:
        collection.add(documents=documents, metadatas=metadatas, ids=ids)
        print(f"\nIngested {len(documents)} chunks into '{COLLECTION_NAME}'")
    else:
        print("No documents found to ingest")


if __name__ == "__main__":
    ingest()
