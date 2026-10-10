import {
  AllowedOptionType,
  ComparisonOperator,
  ConditionRule,
  ContractSelectionConfig,
  EntryRulesConfig,
  ExitRulesConfig,
  ExpirySelection,
  IndicatorType,
  LogicalOperator,
  RuleGroup,
  RuleOperand,
  StrategyAstConfig,
  StrategyConfig,
  StrategyIndicatorConfig,
  StrategyStatus,
  StrikeSelection,
  TradeDirection,
  TradeMode,
  TrailingProfitConfig,
  TrailingProfitMode,
} from '@trading-bot/contracts';
import { StrategyTemplateItem } from '@trading-bot/domain';

export type StrategyLabTab =
  | 'MY_STRATEGIES'
  | 'TEMPLATES'
  | 'DRAFTS'
  | 'BACKTESTED'
  | 'PAPER'
  | 'LIVE_ELIGIBLE'
  | 'ARCHIVED';

export interface StrategyLabFilterOptions {
  searchQuery: string;
  tab: StrategyLabTab;
  underlyingFilter?: string;
}

export {
  AllowedOptionType,
  ComparisonOperator,
  ExpirySelection,
  IndicatorType,
  LogicalOperator,
  StrategyStatus,
  StrikeSelection,
  TradeDirection,
  TradeMode,
  TrailingProfitMode,
};

export type {
  ConditionRule,
  ContractSelectionConfig,
  EntryRulesConfig,
  ExitRulesConfig,
  RuleGroup,
  RuleOperand,
  StrategyAstConfig,
  StrategyConfig,
  StrategyIndicatorConfig,
  StrategyTemplateItem,
  TrailingProfitConfig,
};
