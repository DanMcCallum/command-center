/**
 * Pure mapping from an approved front suggestion to the task the worker will
 * run (specs/fronts.md US-002). Kept free of I/O so it can be unit tested.
 */
import type { FrontSuggestion, Task } from './types';
import { TASK_TYPES } from './types';

const DEFAULT_TYPE = 'Building';
const DEFAULT_MODEL: Task['model'] = 'sonnet';
const MODELS: Task['model'][] = ['sonnet', 'opus', 'haiku'];

export function suggestionToTask(
  suggestion: FrontSuggestion,
  operatorNotes?: string,
): Partial<Task> {
  const notes = operatorNotes?.trim();
  const description = notes
    ? `${suggestion.body.trimEnd()}\n\n## Operator notes\n${notes}\n`
    : suggestion.body;
  const type = (TASK_TYPES as string[]).includes(suggestion.type ?? '')
    ? (suggestion.type as string)
    : DEFAULT_TYPE;
  const model = suggestion.model && MODELS.includes(suggestion.model)
    ? suggestion.model
    : DEFAULT_MODEL;
  return {
    title: suggestion.title,
    description,
    type,
    priority: 3,
    model,
    slashCommand: suggestion.slashCommand ?? null,
    tags: [`front:${suggestion.frontSlug}`],
    metadata: {
      frontSlug: suggestion.frontSlug,
      suggestionId: suggestion.id,
      sourceSessionId: suggestion.sourceSessionId,
      sourceMemoryFile: suggestion.sourceMemoryFile,
    },
  };
}
