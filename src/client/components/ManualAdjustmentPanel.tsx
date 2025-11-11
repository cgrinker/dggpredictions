import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { AdjustBalanceRequest, BalanceAdjustmentMode } from '../../shared/types/dto.js';
import type { ModeratorActionLogEntry } from '../../shared/types/dto.js';
import { adjustUserBalance } from '../api/users.js';
import { isApiError } from '../api/client.js';
import { formatDateTime, formatPoints } from '../utils/format.js';

type ReasonOption = AdjustBalanceRequest['reasonCode'];

interface ManualAdjustmentPanelProps {
  readonly auditActions: readonly ModeratorActionLogEntry[];
  readonly onAdjustmentRecorded: () => Promise<void> | void;
}

interface FormState {
  readonly targetUserId: string;
  readonly delta: string;
  readonly mode: BalanceAdjustmentMode;
  readonly reasonCode: ReasonOption;
  readonly memo: string;
  readonly confirmation: string;
}

interface FeedbackState {
  readonly type: 'success' | 'error';
  readonly message: string;
}

const DEFAULT_FORM: FormState = {
  targetUserId: '',
  delta: '',
  mode: 'credit',
  reasonCode: 'DISPUTE_REFUND',
  memo: '',
  confirmation: '',
};

const REASONS: ReadonlyArray<{ readonly value: ReasonOption; readonly label: string }> = [
  { value: 'DISPUTE_REFUND', label: 'Dispute refund' },
  { value: 'BUG_FIX', label: 'Bug fix' },
  { value: 'MOD_REWARD', label: 'Moderator reward' },
  { value: 'OTHER', label: 'Other' },
];

const isAdjustmentAction = (action: ModeratorActionLogEntry): boolean =>
  action.action === 'ADJUST_BALANCE';

const resolvePayloadNumber = (payload: Record<string, unknown>, key: string): number | null => {
  const value = payload[key];
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
};

const resolvePayloadString = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

export const ManualAdjustmentPanel = ({ auditActions, onAdjustmentRecorded }: ManualAdjustmentPanelProps) => {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const recentAdjustments = useMemo(
    () => auditActions.filter(isAdjustmentAction).slice(0, 10),
    [auditActions],
  );

  const handleChange = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleModeChange = (mode: BalanceAdjustmentMode) => {
    setForm((current) => ({ ...current, mode }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedUserId = form.targetUserId.trim();
    if (!trimmedUserId) {
      setFeedback({ type: 'error', message: 'Target user ID is required.' });
      return;
    }

    const amount = Number.parseInt(form.delta, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFeedback({ type: 'error', message: 'Enter a positive whole number amount.' });
      return;
    }

    if (form.confirmation.trim().toUpperCase() !== 'CONFIRM') {
      setFeedback({
        type: 'error',
        message: 'Type CONFIRM in the confirmation field to authorize this adjustment.',
      });
      return;
    }

    const payload: AdjustBalanceRequest = {
      delta: amount,
      mode: form.mode,
      reasonCode: form.reasonCode,
      ...(form.memo.trim().length > 0 ? { memo: form.memo.trim() } : {}),
    };

    setSubmitting(true);
    setFeedback(null);

    try {
      const result = await adjustUserBalance(trimmedUserId, payload);
      setFeedback({
        type: 'success',
        message: `Adjustment recorded. New balance: ${formatPoints(result.balance.balance)} pts.`,
      });
      setForm(DEFAULT_FORM);
      await onAdjustmentRecorded();
    } catch (error) {
      if (isApiError(error)) {
        setFeedback({ type: 'error', message: `${error.code}: ${error.message}` });
      } else {
        setFeedback({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to record adjustment.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-gray-900">Manual Balance Adjustments</h2>
        <p className="text-sm text-gray-600">
          Credit or debit participant balances with an audit trail. Require CONFIRM to avoid mistakes.
        </p>
      </div>

      {feedback && (
        <div
          className={`rounded border px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {feedback.message}
        </div>
      )}

      <form className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Target User ID
            <input
              type="text"
              value={form.targetUserId}
              onChange={(event) => handleChange('targetUserId', event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              placeholder="t2_abc123"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Amount (points)
            <input
              type="number"
              min={1}
              step={1}
              value={form.delta}
              onChange={(event) => handleChange('delta', event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              placeholder="100"
              required
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Adjustment Type</span>
          {(['credit', 'debit'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                form.mode === mode
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-white text-gray-700 border border-slate-200 hover:bg-slate-50'
              }`}
              onClick={() => handleModeChange(mode)}
            >
              {mode === 'credit' ? 'Credit (add)' : 'Debit (remove)'}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Reason code
          <select
            value={form.reasonCode}
            onChange={(event) => handleChange('reasonCode', event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            {REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Memo (optional)
          <textarea
            value={form.memo}
            onChange={(event) => handleChange('memo', event.target.value)}
            rows={3}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            placeholder="Describe why this adjustment is necessary"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Confirmation
          <input
            type="text"
            value={form.confirmation}
            onChange={(event) => handleChange('confirmation', event.target.value)}
            className="rounded-md border border-red-200 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            placeholder="Type CONFIRM"
          />
          <span className="text-xs text-gray-500">
            This safeguard prevents accidental adjustments. Only moderators can submit this form.
          </span>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Recording…' : 'Record Adjustment'}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-slate-100"
            onClick={() => {
              setForm(DEFAULT_FORM);
              setFeedback(null);
            }}
            disabled={isSubmitting}
          >
            Clear Form
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold text-gray-900">Recent Adjustments</h3>
        {recentAdjustments.length === 0 ? (
          <p className="text-sm text-gray-600">No manual adjustments recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentAdjustments.map((entry) => {
              const payload = entry.payload ?? {};
              const amount = resolvePayloadNumber(payload, 'delta');
              const mode = resolvePayloadString(payload, 'mode');
              const reason = resolvePayloadString(payload, 'reasonCode');
              const memo = resolvePayloadString(payload, 'memo');
              return (
                <li key={entry.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-1 text-sm text-gray-700">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-gray-700">
                        {entry.targetUserId ?? 'unknown'}
                      </span>
                      {mode && (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-gray-600">
                          {mode.toUpperCase()}
                        </span>
                      )}
                      {reason && (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-gray-600">
                          {reason}
                        </span>
                      )}
                    </div>
                    <p>
                      <span className="font-semibold text-gray-900">Moderator:</span>{' '}
                      {entry.performedByUsername || entry.performedBy}
                    </p>
                    <p>
                      <span className="font-semibold text-gray-900">When:</span>{' '}
                      {formatDateTime(entry.createdAt)}
                    </p>
                    {amount !== null && (
                      <p>
                        <span className="font-semibold text-gray-900">Amount:</span>{' '}
                        {formatPoints(amount)} pts
                      </p>
                    )}
                    {memo && (
                      <p>
                        <span className="font-semibold text-gray-900">Memo:</span> {memo}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};
