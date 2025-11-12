import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { CreateMarketRequest } from '../../shared/types/dto.js';
import { createMarket } from '../api/markets.js';
import { isApiError } from '../api/client.js';

interface CreateMarketPanelProps {
  readonly onCreated: () => Promise<void> | void;
}

interface FormState {
  readonly title: string;
  readonly description: string;
  readonly closesAt: string;
  readonly tags: string;
}

interface FeedbackState {
  readonly type: 'success' | 'error';
  readonly message: string;
}

const DEFAULT_LEAD_MINUTES = 60;

const formatDateTimeInput = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const createInitialFormState = (): FormState => {
  const closesAt = new Date(Date.now() + DEFAULT_LEAD_MINUTES * 60_000);
  return {
    title: '',
    description: '',
    closesAt: formatDateTimeInput(closesAt),
    tags: '',
  } satisfies FormState;
};

const toIsoString = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid closing time.');
  }
  return parsed.toISOString();
};

const parseTags = (input: string): readonly string[] =>
  input
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);

export const CreateMarketPanel = ({ onCreated }: CreateMarketPanelProps) => {
  const [form, setForm] = useState<FormState>(() => createInitialFormState());
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const tagsPreview = useMemo(() => parseTags(form.tags), [form.tags]);

  const handleChange = useCallback((key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const resetForm = useCallback(() => {
    setForm(createInitialFormState());
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmedTitle = form.title.trim();
      const trimmedDescription = form.description.trim();

      if (trimmedTitle.length === 0) {
        setFeedback({ type: 'error', message: 'Title is required.' });
        return;
      }

      if (trimmedDescription.length === 0) {
        setFeedback({ type: 'error', message: 'Description is required.' });
        return;
      }

      let closesAtIso: string;
      try {
        closesAtIso = toIsoString(form.closesAt);
      } catch (error) {
        setFeedback({
          type: 'error',
          message: error instanceof Error ? error.message : 'Invalid closing time provided.',
        });
        return;
      }

      const payload: CreateMarketRequest = {
        title: trimmedTitle,
        description: trimmedDescription,
        closesAt: closesAtIso,
        ...(tagsPreview.length > 0 ? { tags: tagsPreview } : {}),
      };

      setSubmitting(true);
      setFeedback(null);

      try {
        const result = await createMarket(payload);
        setFeedback({
          type: 'success',
          message: `Draft created: “${result.title}”.`,
        });
        resetForm();
        await Promise.resolve(onCreated());
      } catch (error) {
        if (isApiError(error)) {
          setFeedback({ type: 'error', message: `${error.code}: ${error.message}` });
        } else {
          setFeedback({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to create market.',
          });
        }
      } finally {
        setSubmitting(false);
      }
    },
    [form, onCreated, tagsPreview, resetForm],
  );

  return (
    <section className="flex flex-col gap-4 rounded-2xl theme-card p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold theme-heading">Create Draft Market</h2>
        <p className="text-sm theme-subtle">
          Capture title, description, and closing time to seed a draft. Drafts appear below for publishing.
        </p>
      </div>

      {feedback && (
        <div
          className={`rounded px-4 py-3 text-sm ${
            feedback.type === 'success' ? 'feedback-success' : 'feedback-error'
          }`}
        >
          {feedback.message}
        </div>
      )}

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-1 text-sm theme-heading">
          Title
          <input
            type="text"
            value={form.title}
            onChange={(event) => handleChange('title', event.target.value)}
            className="input-control rounded-md px-3 py-2 text-sm"
            placeholder="Who wins the next game?"
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm theme-heading">
          Description
          <textarea
            value={form.description}
            onChange={(event) => handleChange('description', event.target.value)}
            rows={4}
            className="input-control rounded-md px-3 py-2 text-sm"
            placeholder="Provide context, rules, and settlement criteria."
            required
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm theme-heading">
            Closes At
            <input
              type="datetime-local"
              value={form.closesAt}
              onChange={(event) => handleChange('closesAt', event.target.value)}
              className="input-control rounded-md px-3 py-2 text-sm"
              required
            />
            <span className="text-xs theme-muted">
              Closing time is interpreted in your local timezone and stored as UTC.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm theme-heading">
            Tags (optional)
            <input
              type="text"
              value={form.tags}
              onChange={(event) => handleChange('tags', event.target.value)}
              className="input-control rounded-md px-3 py-2 text-sm"
              placeholder="event, finals, spoiler"
            />
            {tagsPreview.length > 0 && (
              <span className="text-xs theme-muted">
                Tags: {tagsPreview.join(', ')}
              </span>
            )}
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="btn-base btn-primary px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creating…' : 'Create Draft'}
          </button>
          <button
            type="button"
            className="btn-base btn-secondary px-3 py-2 text-sm"
            onClick={resetForm}
            disabled={isSubmitting}
          >
            Reset
          </button>
        </div>
      </form>
    </section>
  );
};
