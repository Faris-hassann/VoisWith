import { spawn } from 'node:child_process';

export async function openUiPathStudio(projectJsonPath: string, confirmed: boolean) {
  if (!confirmed) return { skipped: true, reason: 'User confirmation is required before opening UiPath Studio.' };
  const studioPath = process.env.UIPATH_STUDIO_PATH || 'UiPath.Studio.exe';
  const child = spawn(studioPath, [projectJsonPath], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' });
  child.unref();
  return { skipped: false, studioPath, projectJsonPath };
}

export function stopAutomation() { return { stopped: true, message: 'Stop requested. Long-running desktop automation is not enabled in this MVP.' }; }
