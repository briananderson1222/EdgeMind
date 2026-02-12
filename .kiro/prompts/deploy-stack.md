# Deploy Full Stack

Deploy the complete EdgeMind stack in the correct order.

## Phase 1: Infrastructure
Execute `.kiro/prompts/deploy-cdk.md`

## Phase 2: Backend
Execute `.kiro/prompts/deploy-backend.md`

## Phase 3: Parallel Deployments
After backend is stable, run concurrently:
- Execute `.kiro/prompts/deploy-frontend.md`
- Execute `.kiro/prompts/sync-kb.md`
- Execute `.kiro/prompts/deploy-agents.md`
