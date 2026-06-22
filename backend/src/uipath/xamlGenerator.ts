import { AutomationPlan, AutomationStep } from '../shared/types.js';

const esc = (v = '') => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function activity(step: AutomationStep): string {
  const annotation = `<!-- ${esc(step.id)}: ${esc(step.description)}${step.requiresConfirmation ? ' | REQUIRES USER CONFIRMATION' : ''} -->`;
  switch (step.action) {
    case 'log_message': return `${annotation}\n    <ui:LogMessage Message="${esc(step.value)}" Level="Info" />`;
    case 'message_box': return `${annotation}\n    <ui:MessageBox Text="${esc(step.value)}" />`;
    case 'wait': return `${annotation}\n    <Delay Duration="00:00:${String(Math.max(1, Math.round((step.delayMs ?? 1000) / 1000))).padStart(2, '0')}" />`;
    case 'open_browser': return `${annotation}\n    <ui:OpenBrowser Url="${esc(step.target)}" BrowserType="Chrome" />`;
    case 'navigate': return `${annotation}\n    <ui:NavigateTo Url="${esc(step.target)}" />`;
    case 'type_into': return `${annotation}\n    <ui:TypeInto Text="${step.sensitive ? '[REPLACE_WITH_SECURE_CREDENTIAL]' : esc(step.value)}" Selector="${esc(step.selector)}" />`;
    case 'click': return `${annotation}\n    <ui:Click Selector="${esc(step.selector)}" />`;
    default: return `${annotation}\n    <ui:LogMessage Message="Placeholder for ${esc(step.action)}" Level="Info" />`;
  }
}

export function generateXaml(plan: AutomationPlan): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Activity x:Class="Main" xmlns="http://schemas.microsoft.com/netfx/2009/xaml/activities" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:ui="http://schemas.uipath.com/workflow/activities">
  <Sequence DisplayName="${esc(plan.projectName)}">
${plan.steps.map(activity).join('\n')}
  </Sequence>
</Activity>
`;
}
