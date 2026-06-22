export type AutomationAction =
  | 'open_browser'
  | 'navigate'
  | 'type_into'
  | 'click'
  | 'wait'
  | 'log_message'
  | 'message_box'
  | 'get_selector'
  | 'create_uipath_activity'
  | 'save_project';

export interface AutomationStep {
  id: string;
  action: AutomationAction;
  description: string;
  target?: string;
  value?: string;
  selectorName?: string;
  selector?: string;
  delayMs?: number;
  requiresConfirmation?: boolean;
  sensitive?: boolean;
}

export interface AutomationPlan {
  projectName: string;
  summary: string;
  dryRun: boolean;
  warnings: string[];
  requiresConfirmation: boolean;
  steps: AutomationStep[];
}
