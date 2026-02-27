# STORY-020: distilled_rule LLM 生成

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
I want high-quality Bullets refined by LLM into concise rules,
So that recalled knowledge is more precise and actionable.

---

## Description

### Background

当前 Reflector 的 `distilled_rule` 字段直接等于 `content`（`reflector.ts` L246），没有经过真正的 LLM 蒸馏。蒸馏模板仅靠字符串拼接生成，质量参差不齐。

本 Story 为高分 Bullet（`instructivity_score > 70`）引入 LLM 精炼流程，使用 Claude Haiku（低成本）或 Sonnet（高质量）将原始 content 精炼为 "When X, do Y because Z" 格式的 `distilled_rule`。

此功能**默认关闭**，通过 `config.json` 中 `reflector.llm_evaluate: true` 启用，需要用户配置 Anthropic API Key。

### Scope

**In scope:**
- `engine/llm-refiner.ts`：LLM 精炼器，调用 Claude API 生成 distilled_rule
- `engine/reflector.ts`：集成 LLM 精炼步骤（高分 Bullet 触发）
- `types/config.ts`：新增 `anthropic_api_key` 配置字段
- `shared/config-loader.ts`：支持 API key 配置
- 单元测试（mock LLM 响应）

**Out of scope:**
- LLM 批量重新精炼已有 Bullet（未来增强）
- 多模型切换 UI（本 Story 仅支持配置文件切换）
- 流式输出

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
2. PostToolUse → Stop → Curate 正常触发
3. Reflector 蒸馏时，若 Bullet 的 `instructivity_score > 70`，调用 LLM 精炼
4. LLM 返回 "When X, do Y because Z" 格式的 distilled_rule
5. distilled_rule 写入 Bullet，recall 时优先展示 distilled_rule

---

## Acceptance Criteria

- [ ] `engine/llm-refiner.ts`：LLMRefiner 类实现
- [ ] 使用 Anthropic SDK (`@anthropic-ai/sdk`) 调用 Claude API
- [ ] 支持 `haiku` 和 `sonnet` 两种模型选项
- [ ] Prompt 模板产出 "When [situation], do [action] because [reason]" 格式
- [ ] 高分 Bullet（`instructivity_score > 70`）触发 LLM 精炼
- [ ] 低分 Bullet 保持现有行为（`distilled_rule = content`）
- [ ] `llm_evaluate: false`（默认）时完全跳过 LLM 调用
- [ ] 缺少 `anthropic_api_key` 时跳过并 log warning
- [ ] 单次 LLM 调用超时 5 秒，超时降级为规则模板（不影响入库）
- [ ] LLM API 错误不阻塞蒸馏流程，降级到原有模板结果
- [ ] `config.json` 新增字段有合理默认值
- [ ] 单元测试：mock API 响应，验证 prompt 组装和结果解析
- [ ] 单元测试：超时、API 错误、缺少 key 的降级路径

---

## Technical Notes

### Components

- **New:** `engine/llm-refiner.ts` — LLMRefiner class
- **Modify:** `engine/reflector.ts` — 集成 LLM 精炼步骤
- **Modify:** `types/config.ts` — 新增 anthropic_api_key 和 llm 相关配置
- **Modify:** `shared/config-loader.ts` — 处理 API key 配置

### LLMRefiner 设计

```typescript
import Anthropic from '@anthropic-ai/sdk';

class LLMRefiner {
  private client: Anthropic | null;
  private model: string; // 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6'
  private timeoutMs: number; // 5000

  constructor(config: { apiKey?: string; model?: 'haiku' | 'sonnet'; timeoutMs?: number })

  // Returns distilled rule or null on failure
  async refine(bullet: {
    content: string;
    knowledge_type: KnowledgeType;
    code_content: string | null;
    key_entities: string[];
  }): Promise<string | null>

  isAvailable(): boolean // true if client initialized
}
```

### Prompt 模板

```
You are a knowledge distillation assistant. Convert the following developer knowledge into a concise rule.

Format: "When [situation], do [action] because [reason]"

Knowledge type: {knowledge_type}
Content: {content}
{code_content ? `Code: ${code_content}` : ''}
{key_entities.length ? `Entities: ${key_entities.join(', ')}` : ''}

Output ONLY the distilled rule, nothing else. Keep it under 200 characters.
```

### Reflector 集成点

```typescript
// reflector.ts distill() 流程中，步骤 8.5（在 embedding 之前）
if (this.llmRefiner?.isAvailable() && classifyResult.instructivity_score > 70) {
  const refined = await this.llmRefiner.refine({
    content: cleanContent,
    knowledge_type: classifyResult.knowledge_type,
    code_content: codeContent,
    key_entities: entities,
  });
  if (refined) {
    distilledRule = refined;
  }
}
```

### 配置变更

```typescript
// types/config.ts — AceConfig 新增
interface AceConfig {
  // ... existing fields
  anthropic_api_key?: string; // Anthropic API key for LLM features
  reflector: {
    // ... existing fields
    llm_evaluate: boolean;     // default: false (already exists)
    llm_model: 'haiku' | 'sonnet'; // default: 'haiku' (already exists)
    llm_score_threshold: number; // default: 70
    llm_timeout_ms: number;    // default: 5000
  };
}
```

### 新增依赖

```
@anthropic-ai/sdk  (peer/optional)
```

### Security Considerations

- API key 存储在本地 `config.json`，不写入任何日志
- Sanitizer 已在 LLM 调用之前运行，确保发送给 API 的内容已脱敏
- API key 格式验证（`sk-ant-` 前缀）

### Edge Cases

- API key 有效但配额耗尽 → 降级到模板，不报错
- LLM 返回非预期格式 → 原样使用返回文本（截断到 500 字符）
- 网络不可用 → 5s 超时后降级
- 并发蒸馏多条 Bullet → 串行 LLM 调用（避免 rate limit）

---

## Dependencies

**Prerequisite Stories:**
- STORY-013: Reflector 蒸馏器（集成点）

**Blocked Stories:**
- None

**External Dependencies:**
- `@anthropic-ai/sdk` npm package
- 用户需要 Anthropic API key

---

## Definition of Done

- [ ] `engine/llm-refiner.ts` 实现并通过测试
- [ ] `engine/reflector.ts` 集成 LLM 精炼步骤
- [ ] 配置字段新增并有合理默认值
- [ ] 单元测试覆盖正常路径 + 所有降级路径
- [ ] 默认关闭状态下不影响现有功能
- [ ] 所有现有测试仍通过（364 tests regression）

---

## Story Points Breakdown

- **LLMRefiner engine:** 1.5 points
- **Reflector 集成 + 配置:** 0.5 points
- **Testing:** 1 point
- **Total:** 3 points

**Rationale:** 核心是一个 API 调用封装 + 降级处理，架构简单但需仔细处理超时和错误路径。

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
