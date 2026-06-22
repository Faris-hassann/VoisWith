import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'AI UiPath Flow Builder', description: 'Generate UiPath MVP automations from natural language prompts.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
