#!/usr/bin/env bash
# ABOUTME: Reset script for idempotent Ralph-TUI manual testing.
# Resets all state to allow re-running the same test from scratch.
# Re-copies test-prd.json from source to ensure clean state.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Read workspace path from saved file, or use default
if [ -f "$SCRIPT_DIR/.test-workspace-path" ]; then
    SAVED_WORKSPACE="$(cat "$SCRIPT_DIR/.test-workspace-path")"
else
    SAVED_WORKSPACE="${XDG_CACHE_HOME:-$HOME/.cache}/ralph-tui/test-workspace"
fi

TEST_WORKSPACE="${1:-$SAVED_WORKSPACE}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Ralph-TUI Test Reset ===${NC}"
echo ""

# Check if workspace exists
if [ ! -d "$TEST_WORKSPACE" ]; then
    echo -e "${RED}Test workspace not found at: $TEST_WORKSPACE${NC}"
    echo -e "Run ${BLUE}./testing/setup-test-workspace.sh${NC} first."
    exit 1
fi

echo -e "Workspace: ${BLUE}$TEST_WORKSPACE${NC}"
echo ""

# 1. Re-copy the PRD from source (always clean)
echo -e "${YELLOW}[1/5] Resetting test-prd.json...${NC}"
if [ -f "$SCRIPT_DIR/test-prd.json" ]; then
    cp "$SCRIPT_DIR/test-prd.json" "$TEST_WORKSPACE/test-prd.json"
    echo -e "${GREEN}  Re-copied test-prd.json from source (all tasks reset)${NC}"
else
    echo -e "${RED}  Warning: source test-prd.json not found at $SCRIPT_DIR/test-prd.json${NC}"
fi

# 2. Clean up test workspace outputs
echo -e "${YELLOW}[2/5] Cleaning test workspace outputs...${NC}"
rm -f "$TEST_WORKSPACE"/output-*.txt
rm -f "$TEST_WORKSPACE"/merged-*.txt
rm -f "$TEST_WORKSPACE"/summary.txt
echo -e "${GREEN}  Removed generated output files${NC}"

# 3. Clean up .ralph-tui session state
echo -e "${YELLOW}[3/5] Cleaning Ralph-TUI session state...${NC}"
RALPH_DIR="$TEST_WORKSPACE/.ralph-tui"
if [ -d "$RALPH_DIR" ]; then
    rm -f "$RALPH_DIR/session.json"
    rm -f "$RALPH_DIR/lock.json"
    rm -f "$RALPH_DIR/progress.md"
    rm -rf "$RALPH_DIR/iterations"
    mkdir -p "$RALPH_DIR/iterations"
    echo -e "${GREEN}  Removed session.json, lock.json, progress.md, and iterations/${NC}"
else
    mkdir -p "$RALPH_DIR/iterations"
    echo -e "${BLUE}  Created fresh .ralph-tui directory${NC}"
fi

# 4. Optional: Reset git state in test workspace
echo -e "${YELLOW}[4/5] Checking git state...${NC}"
if [ -d "$TEST_WORKSPACE/.git" ]; then
    echo -e "${BLUE}  Git repo found. To fully reset git state, run:${NC}"
    echo -e "    cd $TEST_WORKSPACE && git reset --hard test-start && git clean -fd"
    echo -e "${BLUE}  (Not done automatically to preserve any work you want to keep)${NC}"
else
    echo -e "${BLUE}  No git repo in test workspace${NC}"
fi

# 5. Summary
echo ""
echo -e "${YELLOW}[5/5] Summary...${NC}"
echo -e "${GREEN}Test environment reset complete!${NC}"
echo ""
echo -e "To run the test:"
echo -e "  ${BLUE}bun run dev -- run --prd $TEST_WORKSPACE/test-prd.json --cwd $TEST_WORKSPACE${NC}"
