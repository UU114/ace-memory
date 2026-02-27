// --- Hook input types (from stdin) ---

// SessionStart has no specific input beyond event metadata
export interface SessionStartInput {
  session_id: string;
  cwd: string;
}

// UserPromptSubmit input
export interface UserPromptSubmitInput {
  prompt: string;
  cwd: string;
  session_id: string;
}

// PostToolUse input
export interface PostToolUseInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: string;
  session_id: string;
}

// Stop input
export interface StopInput {
  session_id: string;
  cwd: string;
}

// SessionEnd input
export interface SessionEndInput {
  session_id: string;
  cwd: string;
}

// --- Hook output types (to stdout) ---

// Generic empty output
export interface EmptyHookOutput {
  // Empty JSON object
}

// UserPromptSubmit output with additional context
export interface UserPromptSubmitOutput {
  hookSpecificOutput?: {
    hookEventName: 'UserPromptSubmit';
    additionalContext: string;
  };
}

// --- Session queue entry (file-based, cross-process) ---

export interface SessionQueueEntry {
  timestamp: string; // ISO 8601
  tool_name: string; // "Edit" | "Write" | "Bash"
  pattern_type: string; // "error_fix" | "code_pattern" | "command_usage" | "file_creation"
  summary: string;
  context: {
    file?: string;
    language?: string;
    error_message?: string;
    command?: string;
  };
  processed: boolean;
}

// Pattern types detected by rules engine
export type PatternType = 'error_fix' | 'code_pattern' | 'command_usage' | 'file_creation';
