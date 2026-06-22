import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { log, getLogs, maskSensitive } from './logs/logger.js';
import { generatePlan, refinePrompt } from './agent/agentService.js';
import { openBrowser, sendPromptToAiPage } from './browser/browserController.js';
import { createUiPathProject } from './uipath/projectGenerator.js';
import { generateXaml } from './uipath/xamlGenerator.js';
import { openUiPathStudio, stopAutomation } from './desktop-control/desktopController.js';
import { saveSelector } from './selectors/selectorManager.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000' }));
app.use(express.json({ limit: '1mb' }));

const promptSchema = z.object({ userPrompt: z.string().min(3), dryRun: z.boolean().default(true) });
const planSchema = z.object({ plan: z.any() });

app.post('/api/agent/refine-prompt', async (req, res, next) => { try { const { userPrompt } = promptSchema.parse(req.body); const refinedPrompt = refinePrompt(userPrompt); await log('info', `Refined prompt: ${maskSensitive(userPrompt)}`); res.json({ refinedPrompt }); } catch (e) { next(e); } });
app.post('/api/agent/generate-plan', async (req, res, next) => { try { const { userPrompt, dryRun } = promptSchema.parse(req.body); const plan = generatePlan(userPrompt, dryRun); await log('info', `Generated plan for prompt: ${maskSensitive(userPrompt)}`); res.json({ plan }); } catch (e) { next(e); } });
app.post('/api/browser/open', async (req, res, next) => { try { await log('info', 'Opening Playwright browser.'); res.json(await openBrowser(req.body?.url)); } catch (e) { next(e); } });
app.post('/api/browser/send-prompt', async (req, res, next) => { try { const refinedPrompt = z.object({ refinedPrompt: z.string().min(3) }).parse(req.body).refinedPrompt; await log('warn', 'Sending refined prompt to configured AI browser page.'); res.json(await sendPromptToAiPage(refinedPrompt)); } catch (e) { next(e); } });
app.post('/api/uipath/create-project', async (req, res, next) => { try { const { plan } = planSchema.parse(req.body); const result = await createUiPathProject(plan); await log('info', `Created UiPath project at ${result.projectDir}`); res.json(result); } catch (e) { next(e); } });
app.post('/api/uipath/generate-xaml', async (req, res, next) => { try { const { plan } = planSchema.parse(req.body); res.type('application/xml').send(generateXaml(plan)); } catch (e) { next(e); } });
app.post('/api/uipath/open-studio', async (req, res, next) => { try { const body = z.object({ projectJsonPath: z.string(), confirmed: z.boolean().default(false) }).parse(req.body); const result = await openUiPathStudio(body.projectJsonPath, body.confirmed); await log(body.confirmed ? 'info' : 'warn', body.confirmed ? 'Opening UiPath Studio.' : 'UiPath Studio open skipped; confirmation missing.'); res.json(result); } catch (e) { next(e); } });
app.post('/api/selectors/capture', async (req, res, next) => { try { const body = z.object({ url: z.string().url(), name: z.string().min(1), selector: z.string().default("<webctrl />") }).parse(req.body); const record = await saveSelector(body); await log('info', `Captured selector placeholder ${body.name}`); res.json({ record, note: 'MVP stores provided selector placeholders. Interactive capture can be added later.' }); } catch (e) { next(e); } });
app.get('/api/logs', (_req, res) => res.json({ logs: getLogs() }));
app.post('/api/agent/stop', (_req, res) => res.json(stopAutomation()));
app.post('/api/agent/run-mvp', async (req, res, next) => { try { const { userPrompt, dryRun } = promptSchema.parse(req.body); const refinedPrompt = refinePrompt(userPrompt); const plan = generatePlan(userPrompt, dryRun); const project = await createUiPathProject(plan); await log('info', `MVP flow completed for ${plan.projectName}`); res.json({ refinedPrompt, plan, project, studio: { skipped: true, reason: 'Open Studio requires a separate explicit confirmation call.' } }); } catch (e) { next(e); } });
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { const message = error instanceof Error ? error.message : 'Unknown error'; void log('error', message); res.status(400).json({ error: message }); });

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => { void log('info', `Backend listening on http://localhost:${port}`); console.log(`Backend listening on http://localhost:${port}`); });
