import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AutomationPlan } from '../shared/types.js';
import { generateXaml } from './xamlGenerator.js';

const root = process.cwd().endsWith('backend') ? path.resolve('..') : process.cwd();
export const generatedRoot = path.join(root, 'generated-projects');

export async function createUiPathProject(plan: AutomationPlan) {
  const safeName = plan.projectName.replace(/[^a-z0-9_-]/gi, '_');
  const projectDir = path.join(generatedRoot, safeName);
  await fs.mkdir(projectDir, { recursive: true });
  const projectJson = {
    name: safeName,
    projectId: crypto.randomUUID(),
    description: plan.summary,
    main: 'Main.xaml',
    dependencies: { 'UiPath.System.Activities': '[24.10.0]', 'UiPath.UIAutomation.Activities': '[24.10.0]' },
    schemaVersion: '4.0',
    studioVersion: '24.10.0',
    expressionLanguage: 'VisualBasic'
  };
  await fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify(projectJson, null, 2));
  await fs.writeFile(path.join(projectDir, 'Main.xaml'), generateXaml(plan));
  await fs.writeFile(path.join(projectDir, 'automation-plan.json'), JSON.stringify(plan, null, 2));
  return { projectDir, projectJsonPath: path.join(projectDir, 'project.json'), xamlPath: path.join(projectDir, 'Main.xaml') };
}
