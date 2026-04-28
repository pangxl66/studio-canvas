import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';

type ReviewFeedbackDialogProps = {
  open: boolean;
  title?: string;
  hint?: string;
  initialValue?: string;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (feedback: string) => void;
};

export function ReviewFeedbackDialog(props: ReviewFeedbackDialogProps) {
  const {
    open,
    title = '填写审核意见',
    hint = '请明确说明需要修改、保留或补强的点。提交后会进入“已审核”状态，可继续按意见优化或直接通过。',
    initialValue = '',
    submitLabel = '保存审核意见',
    onClose,
    onSubmit,
  } = props;
  const [draft, setDraft] = useState(initialValue);
  const titleId = useId();

  useEffect(() => {
    if (open) setDraft(initialValue);
  }, [initialValue, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  const trimmed = draft.trim();

  return createPortal(
    <div className="review-feedback-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="review-feedback-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="review-feedback-modal__title">
          {title}
        </h3>
        <p className="review-feedback-modal__hint">{hint}</p>
        <textarea
          className="review-feedback-modal__textarea"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="例如：保留现有空间关系，只补强结果位、关键动作和接力物。"
          rows={8}
          spellCheck={false}
          autoFocus
        />
        <div className="review-feedback-modal__footer">
          <span className="review-feedback-modal__count">{trimmed.length} 字</span>
          <div className="review-feedback-modal__actions">
            <button
              type="button"
              className="review-feedback-modal__btn review-feedback-modal__btn--ghost"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="review-feedback-modal__btn review-feedback-modal__btn--primary"
              disabled={!trimmed}
              onClick={() => {
                if (!trimmed) return;
                onSubmit(trimmed);
                onClose();
              }}
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
