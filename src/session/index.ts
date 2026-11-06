/**
 * 会话管理层
 *
 * 管理推推 peer → dsh Agent 的映射和生命周期。
 */
export { SessionManager } from './session-manager.ts';
export { IdleEvictor } from './idle-evictor.ts';
export type {
  AgentSetup,
  SessionEventLike,
  DshAgent,
  DshAgentHandle,
  DshAgentRegistry,
  AgentPresetsLike,
  PresetComposition,
  PresetEntry,
  PresetSwitchOutcome,
  ModelSwitchOutcome,
  SessionRecord,
  SessionStatus,
  TokenUsageStats,
  QuestionChannelLike,
  ApprovalChannelLike,
} from './types.ts';
