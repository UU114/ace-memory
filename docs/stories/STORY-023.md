# STORY-023: LLM 评估增强

**Epic:** EPIC-007 (Advanced Intelligence)
**Priority:** Could Have
**Story Points:** 3
**Status:** Not Started
**Assigned To:** Unassigned
**Created:** 2026-02-27
**Sprint:** 4

---

## User Story

As a developer,
I want optional LLM evaluation of knowledge candidates,
So that only truly valuable insights enter the Playbook.

---

## Description

### Background

当前 `engine/classifier.ts` 的评估完全基于正则/启发式规则：通过关键词计数（specificity、actionability、uniqueness）计算 `instructivity_score`，再乘以内容密度系数。这种方式快速但粗糙——无法理解语义，对中文内容尤其不准确（关键词列表偏向英文）。

本 Story 新增可选的 LLM 评估路径：当 `reflector.llm_evaluate: true` 时，使用 Claude Haiku 对知识候选进行语义评估，输出 `should_record`（是否值得记录）、`category`（知识类型修正）、`score`（精确评分）。LLM 评估结果覆盖启发式结果。

此功能与 STORY-020（LLM distilled_rule 生成）共享 `anthropic_api_key` 和 `llm_evaluate` 配置开关。

### Scope

**In scope:**
- `engine/llm-evaluator.ts`：LLM 评估器，调用 Claude API 评估候选质量
- `engine/classifier.ts`：集成 LLM 评估路径（可选替代）
- `engine/reflector.ts`：在分类步骤中使用 LLM 评估器
- 超时降级到规则评估

**Out of scope:**
- LLM 评估已入库的历史 Bullet（仅评估新候选）
- 自定义评估 prompt（使用内置 prompt）
- 评估结果缓存

---

## User Flow

1. 用户在 `~/.ace-claude/config.json` 中配置：
   ```json
   {
     "reflector": {
       "llm_evaluate": true,
       "llm_model": "haiku"
     },
     "anthropic_api_key": "sk-ant-..."
   }
   ```
2. PostToolUse 捕获模式 → Stop Hook 触发蒸馏
3. Reflector 调用 Classifier 时，Classifier 检测到 LLM 评估可用
4. 调用 LLM 评估器，返回结构化评估结果
5. LLM 结果覆盖启发式的 `knowledge_type` 和 `instructivity_score`
6. 如果 LLM 判定 `should_record: false`，候选被拒绝（不入库）
7. 如果 LLM 超时（>5s），降级到启发式结果

---

## Acceptance Criteria

- [ ] `engine/llm-evaluator.ts`：LLMEvaluator 类实现
- [ ] 使用 Anthropic SDK 调用 Claude API（与 STORY-020 共享 SDK 依赖）
- [ ] Prompt 产出结构化 JSON：`{ should_record, category, score, reason }`
- [ ] `should_record: false` → 候选被拒绝，`reason` 写入日志
- [ ] `category` 映射到 `KnowledgeType`（Method/Trick/Pitfall/Preference/Knowledge）
- [ ] `score` 范围 0-100，覆盖启发式 `instructivity_score`
- [ ] `llm_evaluate: false`（默认）时完全跳过 LLM 评估
- [ ] 缺少 `anthropic_api_key` 时跳过并 log warning
- [ ] 单次 LLM 调用超时 5 秒，超时降级到启发式结果（不影响入库流程）
- [ ] LLM API 错误降级到启发式结果
- [ ] LLM 返回非法 JSON 时降级到启发式结果
- [ ] 单元测试：mock API 响应，验证正常路径 + 所有降级路径
- [ ] 单元测试：JSON 解析异常处理

---

## Technical Notes

### Components

- **New:** `engine/llm-evaluator.ts` — LLMEvaluator class
- **Modify:** `engine/reflector.ts` — 在分类步骤中集成 LLM 评估
- **Shares:** `@anthropic-ai/sdk` 依赖（与 STORY-020 共用）

### LLMEvaluator 设计

```typescript
interface LLMEvaluation {
  should_record: boolean;
  category: KnowledgeType;
  score: number; // 0-100
  reason: string;
}

class LLMEvaluator {
  private client: Anthropic | null;
  private model: string;
  private timeoutMs: number;

  constructor(config: { apiKey?: string; model?: 'haiku' | 'sonnet'; timeoutMs?: number })

  async evaluate(content: string, context: {
    pattern_type: string;
    tool_name?: string;
    file_path?: string;
  }): Promise<LLMEvaluation | null>  // null = unavailable/error

  isAvailable(): boolean
}
```

### Evaluation Prompt

```
You are a developer knowledge quality evaluator. Assess whether this developer interaction contains knowledge worth remembering.

Content: {content}
Pattern type: {pattern_type}
{tool_name ? `Tool: ${tool_name}` : ''}
{file_path ? `File: ${file_path}` : ''}

Respond with ONLY valid JSON:
{
  "should_record": true/false,
  "category": "Method|Trick|Pitfall|Preference|Knowledge",
  "score": 0-100,
  "reason": "brief explanation"
}

Scoring guidelines:
- 80-100: Highly specific, actionable insight that would save time
- 60-79: Useful knowledge with some specificity
- 40-59: Generic but potentially helpful
- 20-39: Too vague or common knowledge
- 0-19: Not worth recording (boilerplate, trivial)

Reject (should_record: false) if:
- Content is trivial (e.g., "ran ls", "read a file")
- Content is too generic (e.g., "use git")
- Content is temporary/session-specific
```

### Reflector 集成点

```typescript
// reflector.ts distill() 流程中，替代或增强 classifier.classify()

// Step 3: Classify
let classifyResult = this.classifier.classify(cleanContent, false);

// Step 3.5: Optional LLM evaluation override
if (this.llmEvaluator?.isAvailable()) {
  const llmResult = await this.llmEvaluator.evaluate(cleanContent, {
    pattern_type: entry.pattern_type,
    tool_name: entry.tool_name,
    file_path: entry.file_path,
  });
  if (llmResult) {
    classifyResult = {
      knowledge_type: llmResult.category,
      instructivity_score: llmResult.score,
      rejected: !llmResult.should_record,
      reason: llmResult.should_record ? undefined : llmResult.reason,
    };
  }
  // If llmResult is null (error/timeout), keep heuristic result
}
```

### 与 STORY-020 的关系

| 维度 | STORY-020 (LLM Rule) | STORY-023 (LLM Eval) |
|------|----------------------|----------------------|
| 触发时机 | 分类之后，入库之前 | 分类步骤中 |
| 输入 | 已蒸馏的 content | 原始候选 content |
| 输出 | distilled_rule 文本 | should_record + score + category |
| 条件 | score > 70 | 所有候选（当 llm_evaluate=true） |
| 共享 | API key, SDK, model config | API key, SDK, model config |

两个 Story 可以独立实现，但应共享 Anthropic client 实例以避免重复初始化。建议在 Reflector 构造时创建共享 client。

### Edge Cases

- LLM 返回 score 超出范围 → clamp 到 0-100
- LLM 返回未知 category → 降级到启发式 category
- 连续多条候选 → 串行调用（避免 rate limit）
- API key 有效但余额不足 → 首次调用后检测错误，后续直接跳过（设置 available=false）

---

## Dependencies

**Prerequisite Stories:**
- STORY-013: Reflector 蒸馏器（集成点）

**Optional Co-dependency:**
- STORY-020: 共享 Anthropic SDK 依赖和 API key 配置

**Blocked Stories:**
- None

**External Dependencies:**
- `@anthropic-ai/sdk` npm package（与 STORY-020 共享）
- 用户需要 Anthropic API key

---

## Definition of Done

- [ ] `engine/llm-evaluator.ts` 实现并通过测试
- [ ] `engine/reflector.ts` 集成 LLM 评估路径
- [ ] 默认关闭状态下不影响现有功能
- [ ] 单元测试覆盖正常路径 + 所有降级路径 + JSON 解析异常
- [ ] 与 STORY-020 共享 API client 设计（如同 Sprint 实现）
- [ ] 所有现有测试仍通过（364 tests regression）

---

## Story Points Breakdown

- **LLMEvaluator engine:** 1.5 points
- **Reflector 集成:** 0.5 points
- **Testing:** 1 point
- **Total:** 3 points

**Rationale:** 与 STORY-020 结构类似（API 调用 + 降级处理），但 prompt 和解析逻辑不同。JSON 结构化输出解析增加少许复杂度。

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
