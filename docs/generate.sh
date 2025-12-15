#!/bin/bash
# EdgeMind Architecture Diagram Generator
#
# Automatically activates the virtual environment and generates the diagram

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

cd "$SCRIPT_DIR"

# Check if venv exists
if [ ! -d ".venv" ]; then
    echo "Virtual environment not found. Creating..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install diagrams
else
    source .venv/bin/activate
fi

# Generate diagram
echo "Generating architecture diagram..."
python generate_architecture_diagram.py

echo ""
echo "Done! Diagram saved to: $SCRIPT_DIR/edgemind_architecture.png"
