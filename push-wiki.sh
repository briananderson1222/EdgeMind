#!/bin/bash
# Push wiki pages to GitHub Wiki
# Run this AFTER enabling wiki in GitHub repo settings

set -e

WIKI_REPO="git@github.com-reply:Concept-Reply-US/EdgeMind.wiki.git"
TEMP_DIR="/tmp/EdgeMind.wiki"

echo "=== EdgeMind Wiki Publisher ==="

# Clean up any previous attempt
rm -rf "$TEMP_DIR"

# Clone or init wiki repo
echo "Cloning wiki repo..."
if ! git clone "$WIKI_REPO" "$TEMP_DIR" 2>/dev/null; then
    echo "Wiki repo empty, initializing..."
    mkdir -p "$TEMP_DIR"
    cd "$TEMP_DIR"
    git init
    git remote add origin "$WIKI_REPO"
else
    cd "$TEMP_DIR"
fi

# Copy wiki files
echo "Copying wiki pages..."
cp -r /Users/stefanbekker/Projects/EdgeMind/wiki/* "$TEMP_DIR/"

# Commit and push
echo "Committing..."
git add -A
git commit -m "Initial wiki: 31 pages covering architecture, modules, API, deployment"

echo "Pushing to GitHub..."
git push -u origin master || git push -u origin main

echo ""
echo "=== Done! ==="
echo "Wiki available at: https://github.com/Concept-Reply-US/EdgeMind/wiki"
