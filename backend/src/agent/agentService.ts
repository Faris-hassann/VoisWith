import { AutomationPlan, AutomationStep } from '../shared/types.js';
import { hasCredentials, markSensitiveSteps, validatePlan } from './security.js';

function projectNameFromPrompt(prompt: string) {
  return `Generated_${prompt.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 36) || 'Automation'}`;
}

function extractUrl(text: string): string | undefined {
  if (/google/i.test(text)) return 'https://www.google.com';
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match?.[0];
}

export function refinePrompt(userPrompt: string): string {
  return `Convert this request into a safe UiPath workflow using only Open Browser, Navigate To, Type Into, Click, Delay, Log Message, and Message Box. Use placeholder selectors and mark credential/form-submit steps as requiring confirmation. Request: ${userPrompt}`;
}

export function generatePlan(userPrompt: string, dryRun = true): AutomationPlan {
  const steps: AutomationStep[] = [];
  const prompt = userPrompt.trim();
  const url = extractUrl(prompt);
  steps.push({ id: 'step-1', action: 'log_message', description: 'Start generated automation', value: 'Starting generated UiPath automation.' });
  if (/open|browser|google|http/i.test(prompt)) steps.push({ id: 'step-2', action: 'open_browser', description: 'Open browser', target: url ?? 'about:blank' });
  if (url) steps.push({ id: 'step-3', action: 'navigate', description: `Navigate to ${url}`, target: url });
  if (/search\s+([^,.]+)/i.test(prompt)) {
    const query = prompt.match(/search\s+([^,.]+)/i)?.[1]?.trim() ?? '';
    steps.push({ id: 'step-4', action: 'type_into', description: `Type search query ${query}`, selectorName: 'google_search_box', selector: "<webctrl tag='TEXTAREA' name='q' />", value: query });
    steps.push({ id: 'step-5', action: 'click', description: 'Submit search', selectorName: 'google_search_button', selector: "<webctrl tag='INPUT' type='submit' />", requiresConfirmation: true });
  }
  const username = prompt.match(/(?:username|user)\s*(?:as|is|=|:)\s*([^\s,.]+)/i)?.[1];
  const password = prompt.match(/password\s*(?:as|is|=|:)\s*([^\s,.]+)/i)?.[1];
  if (/facebook/i.test(prompt)) steps.push({ id: 'step-6', action: 'navigate', description: 'Navigate to Facebook login page', target: 'https://www.facebook.com' });
  if (username) steps.push({ id: 'step-7', action: 'type_into', description: 'Type username', selectorName: 'facebook_email', selector: "<webctrl tag='INPUT' id='email' />", value: username, requiresConfirmation: true });
  if (password) steps.push({ id: 'step-8', action: 'type_into', description: 'Type password', selectorName: 'facebook_password', selector: "<webctrl tag='INPUT' id='pass' />", value: password, sensitive: true, requiresConfirmation: true });
  steps.push({ id: 'step-9', action: 'wait', description: 'Delay for review', delayMs: 1000 });
  steps.push({ id: 'step-10', action: 'message_box', description: 'Show completion message', value: 'Generated automation reached the review checkpoint.' });
  steps.push({ id: 'step-11', action: 'save_project', description: 'Save generated UiPath project' });
  return validatePlan({ projectName: projectNameFromPrompt(prompt), summary: 'MVP automation plan generated from natural language prompt.', dryRun, warnings: hasCredentials(prompt) ? ['Credential-like text was detected in the prompt.'] : [], requiresConfirmation: false, steps: markSensitiveSteps(steps) });
}
