/**
 * Publish a push notification through ntfy (https://ntfy.sh).
 *
 * The topic name is the only secret: anyone who knows it can read and post,
 * so it is a long random string kept in the project-root .env.local and
 * never logged or shown in the UI. Phones receive it through the ntfy app.
 */
import { readProjectEnvVar } from './project-env';

export interface NtfyMessage {
  title: string;
  body: string;
  /** URL the notification opens when tapped. */
  click?: string;
  /** 1 (min) .. 5 (max); ntfy default is 3. */
  priority?: number;
  /** Emoji shortcodes, e.g. ['moneybag']. */
  tags?: string[];
}

export function ntfyServer(): string {
  return (readProjectEnvVar('BUYWANDER_NTFY_SERVER') ?? 'https://ntfy.sh').replace(/\/+$/, '');
}

export async function publishNtfy(topicVar: string, msg: NtfyMessage): Promise<void> {
  const topic = readProjectEnvVar(topicVar);
  if (!topic) throw new Error(`${topicVar} is not set in the project-root .env.local`);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) throw new Error(`${topicVar} is not a valid ntfy topic name`);

  const headers: Record<string, string> = {
    Title: msg.title,
    'Content-Type': 'text/plain; charset=utf-8',
  };
  if (msg.click) headers.Click = msg.click;
  if (msg.priority) headers.Priority = String(msg.priority);
  if (msg.tags?.length) headers.Tags = msg.tags.join(',');
  const token = readProjectEnvVar('BUYWANDER_NTFY_TOKEN');
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${ntfyServer()}/${topic}`, { method: 'POST', headers, body: msg.body });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`ntfy ${res.status}: ${text || res.statusText}`);
  }
}
