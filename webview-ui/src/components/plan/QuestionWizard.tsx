import { useState, useEffect, useRef } from 'react';
import type { WizardQuestion } from '../../types';

interface QuestionWizardProps {
  questions: WizardQuestion[];
  onSubmit: (answers: string[]) => void;
  onDismiss: () => void;
}

export function QuestionWizard({ questions, onSubmit, onDismiss }: QuestionWizardProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => Array(questions.length).fill(''));
  const [customText, setCustomText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const current = questions[step];
  const total = questions.length;
  const isLast = step === total - 1;
  const currentAnswer = answers[step] || '';

  // When step changes, pre-fill customText if the stored answer isn't an option
  useEffect(() => {
    const stored = answers[step] || '';
    const isOption = current.options?.includes(stored);
    setCustomText(isOption ? '' : stored);
    // Focus custom input if no options
    if (!current.options?.length && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step]);

  const setAnswer = (val: string) => {
    setAnswers(prev => {
      const next = [...prev];
      next[step] = val;
      return next;
    });
  };

  const handleOptionClick = (opt: string) => {
    setAnswer(opt);
    setCustomText('');
  };

  const handleCustomChange = (val: string) => {
    setCustomText(val);
    setAnswer(val);
  };

  const canProceed = currentAnswer.trim().length > 0;

  const handleNext = () => {
    if (!canProceed) return;
    if (isLast) {
      onSubmit(answers);
    } else {
      setStep(s => s + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(s => s - 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canProceed) {
      e.preventDefault();
      handleNext();
    }
    if (e.key === 'Escape') {
      onDismiss();
    }
  };

  return (
    <div className="question-wizard" onKeyDown={handleKeyDown}>
      {/* ── Header ── */}
      <div className="wizard-header">
        <span className="wizard-counter">{step + 1} of {total} questions</span>
        <div className="wizard-header-controls">
          <button className="wizard-close-btn" onClick={onDismiss} title="Dismiss">—</button>
        </div>
      </div>

      {/* ── Question ── */}
      <div className="wizard-body">
        <div className="wizard-question-text">{current.question}</div>
        {current.hint && (
          <div className="wizard-hint">{current.hint}</div>
        )}

        {/* ── Options ── */}
        {current.options && current.options.length > 0 && (
          <div className="wizard-options">
            {current.options.map((opt, i) => {
              const selected = currentAnswer === opt;
              return (
                <label
                  key={i}
                  className={`wizard-option${selected ? ' wizard-option--selected' : ''}`}
                  onClick={() => handleOptionClick(opt)}
                >
                  <span className="wizard-radio">
                    <span className={`wizard-radio-dot${selected ? ' wizard-radio-dot--filled' : ''}`} />
                  </span>
                  <span className="wizard-option-text">{opt}</span>
                </label>
              );
            })}
          </div>
        )}

        {/* ── Custom text input ── */}
        {(current.allowCustom !== false) && (
          <div className={`wizard-custom-wrap${!current.options?.length ? ' wizard-custom-wrap--only' : ''}`}>
            <input
              ref={inputRef}
              type="text"
              className={`wizard-custom-input${customText ? ' wizard-custom-input--active' : ''}`}
              placeholder="Type your own answer…"
              value={customText}
              onChange={e => handleCustomChange(e.target.value)}
              onFocus={() => {
                // Deselect radio when user starts typing custom
                if (currentAnswer && current.options?.includes(currentAnswer)) {
                  setAnswer(customText);
                }
              }}
            />
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="wizard-footer">
        <div className="wizard-footer-left">
          {step > 0 && (
            <button className="wizard-back-btn" onClick={handleBack}>← Back</button>
          )}
          <button className="wizard-dismiss-btn" onClick={onDismiss}>Dismiss</button>
        </div>
        <div className="wizard-footer-right">
          {/* Step dots */}
          <div className="wizard-dots">
            {questions.map((_, i) => (
              <span
                key={i}
                className={`wizard-dot${i === step ? ' wizard-dot--active' : i < step ? ' wizard-dot--done' : ''}`}
              />
            ))}
          </div>
          <button
            className={`wizard-next-btn${canProceed ? '' : ' wizard-next-btn--disabled'}`}
            onClick={handleNext}
            disabled={!canProceed}
          >
            {isLast ? 'Submit' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
