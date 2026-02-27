# STORY-009: ONNX Embedding Module + ace setup

**Epic:** EPIC-002 (Knowledge Recall)
**Priority:** Should Have
**Points:** 5
**Sprint:** 2
**Status:** In Progress

## User Story
As a developer,
I want local ONNX embedding for semantic search,
So that knowledge retrieval can match meaning, not just keywords.

## Acceptance Criteria
- [ ] engine/embedding.ts: ONNX Runtime Session wrapper
- [ ] Model loading from ~/.ace-claude/models/all-MiniLM-L6-v2/
- [ ] Text → 384-dim vector inference, single <50ms
- [ ] Batch embedding interface
- [ ] Cosine similarity computation function
- [ ] scripts/setup.ts: Download ONNX model from HuggingFace (~80MB)
- [ ] Download progress display
- [ ] Clear error when model missing: `[ACE] ONNX model not found. Run "ace setup" to download.`
- [ ] Daemon loads ONNX Session at startup (one-time, resident in memory)
- [ ] Support Chinese and English text embedding
- [ ] Unit tests: embedding dimension correct, cosine similarity correct

## Technical Notes
- onnxruntime-node provides prebuilt binaries (Win/Mac/Linux)
- Model files: model.onnx + tokenizer.json
- Architecture reference: "3g: Embedding" and FR-007
- all-MiniLM-L6-v2: 384 dimensions, ~80MB, <50ms inference

## Dependencies
- STORY-001 (completed)
