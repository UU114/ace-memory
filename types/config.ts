// Decay configuration
export interface DecayConfig {
  half_life_days: number;
  grace_period_days: number;
  recall_boost_factor: number;
  permanent_recall_threshold: number;
  archive_threshold: number;
}

// Reflector configuration
export interface ReflectorConfig {
  min_interaction_quality: number;
  max_content_length: number;
  max_code_lines: number;
  code_density_reject_threshold: number;
  llm_evaluate: boolean;
  llm_model: string;
  llm_score_threshold: number;
  llm_timeout_ms: number;
}

// Search configuration
export interface SearchConfig {
  keyword_weight: number;
  semantic_weight: number;
  recency_boost_days: number;
  recency_boost_factor: number;
  max_results: number;
  max_context_tokens: number;
  min_score_threshold: number;
}

// Daemon configuration
export interface DaemonConfig {
  idle_timeout_minutes: number;
  max_idle_minutes: number;
  session_check_interval_seconds: number;
}

// Complete ACE configuration
export interface AceConfig {
  anthropic_api_key?: string;
  decay: DecayConfig;
  reflector: ReflectorConfig;
  search: SearchConfig;
  daemon: DaemonConfig;
}

// Default configuration values
export const DEFAULT_CONFIG: AceConfig = {
  decay: {
    half_life_days: 30,
    grace_period_days: 7,
    recall_boost_factor: 0.3,
    permanent_recall_threshold: 15,
    archive_threshold: 0.02,
  },
  reflector: {
    min_interaction_quality: 0.3,
    max_content_length: 500,
    max_code_lines: 3,
    code_density_reject_threshold: 0.6,
    llm_evaluate: false,
    llm_model: 'haiku',
    llm_score_threshold: 70,
    llm_timeout_ms: 5000,
  },
  search: {
    keyword_weight: 0.6,
    semantic_weight: 0.4,
    recency_boost_days: 7,
    recency_boost_factor: 1.2,
    max_results: 5,
    max_context_tokens: 2000,
    min_score_threshold: 0.1,
  },
  daemon: {
    idle_timeout_minutes: 5,
    max_idle_minutes: 10,
    session_check_interval_seconds: 60,
  },
};
