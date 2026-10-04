import { useEffect, useRef } from 'react';
import type { InputHTMLAttributes, RefObject } from 'react';
import { NumericFormat, numericFormatter } from 'react-number-format';
import { normalizePastedManualAmount } from '../../lib/manualAmount';
import {
  manualAmountDraftSchema, manualAmountSchema, MANUAL_AMOUNT_ERROR, MANUAL_AMOUNT_TYPING_ERROR, MANUAL_AMOUNT_PASTE_ERROR,
} from '../../lib/validation/manualEntry';

type AmountInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'onKeyDown' | 'onPaste'> & {
  value: string;
  onValueChange: (value: string) => void;
  error: string | null;
  onErrorChange: (error: string | null) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  onValidEnter?: () => void;
  onEscape?: () => void;
};

const formatOptions = { thousandSeparator: ',', decimalScale: 2, allowNegative: false };

function insertedDraft(input: HTMLInputElement, text: string): string {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  return input.value.slice(0, start).replace(/,/g, '')
    + (text === ',' ? '.' : text)
    + input.value.slice(end).replace(/,/g, '');
}

/** Inspect raw edits before formatting can discard letters or extra cents. */
export default function AmountInput({
  value, onValueChange, error, onErrorChange, inputRef, onValidEnter, onEscape, ...props
}: AmountInputProps) {
  const localRef = useRef<HTMLInputElement | null>(null);
  const rejected = useRef(!!error && error !== MANUAL_AMOUNT_ERROR);
  const correcting = useRef(false);
  const pendingDraft = useRef<string | null>(null);

  const reject = (message: string) => {
    rejected.current = message !== MANUAL_AMOUNT_ERROR;
    correcting.current = false;
    pendingDraft.current = null;
    onErrorChange(message);
  };
  const acceptCorrection = () => {
    rejected.current = false;
    onErrorChange(null);
  };
  const checkInsertion = (input: HTMLInputElement, text: string): boolean => {
    const result = manualAmountDraftSchema.safeParse(insertedDraft(input, text));
    if (!result.success) {
      reject(result.error.issues[0].message);
      return false;
    }
    pendingDraft.current = result.data;
    correcting.current = input.value.length > 0
      && input.selectionStart === 0 && input.selectionEnd === input.value.length;
    return true;
  };

  // Mobile keyboards and IMEs can insert text without sending a keydown.
  // A capture listener sees that complete text before NumericFormat changes it.
  useEffect(() => {
    const input = localRef.current;
    if (!input) return;
    const beforeInput = (event: InputEvent) => {
      if (event.inputType.startsWith('delete')) {
        pendingDraft.current = null;
        correcting.current = true;
        if (input.value === '') acceptCorrection();
      } else if (event.data !== null && !checkInsertion(input, event.data)) {
        event.preventDefault();
      }
    };
    input.addEventListener('beforeinput', beforeInput);
    return () => input.removeEventListener('beforeinput', beforeInput);
  });

  return <NumericFormat
    {...props}
    type="text"
    inputMode="decimal"
    autoComplete="off"
    valueIsNumericString
    {...formatOptions}
    allowedDecimalSeparators={['.', ',']}
    value={value}
    aria-invalid={!!error}
    getInputRef={(input: HTMLInputElement | null) => {
      localRef.current = input;
      if (inputRef) inputRef.current = input;
    }}
    onValueChange={({ value: next }, source) => {
      if (source.source === 'event') onValueChange(next);
    }}
    onInputCapture={event => {
      const input = event.currentTarget;
      const raw = input.value.replace(/,/g, '');
      const native = event.nativeEvent instanceof InputEvent ? event.nativeEvent : null;
      const deleting = native?.inputType.startsWith('delete') ?? false;
      const bulkText = native?.data && native.data.length > 1 ? native.data : raw;
      const rawValidation = manualAmountDraftSchema.safeParse(raw);
      const result = rawValidation.success ? manualAmountDraftSchema.safeParse(bulkText) : rawValidation;
      const unknownGrouping = input.value.includes(',') && !native?.data
        && !deleting && numericFormatter(raw, formatOptions) !== input.value;
      if (!result.success || unknownGrouping) {
        input.value = numericFormatter(value, formatOptions);
        reject(result.success ? MANUAL_AMOUNT_TYPING_ERROR : result.error.issues[0].message);
      } else {
        const replacing = native && (native.inputType === 'insertReplacementText'
          || (native.data === raw && (raw.length > 1 || value !== '')));
        if (!rejected.current || correcting.current || replacing || deleting || raw === '') {
          // Commit a correction with its feedback. Normal edits stay with
          // NumericFormat so its grouping and caret management remain intact.
          if (error !== null || rejected.current) onValueChange(pendingDraft.current ?? raw);
          acceptCorrection();
        }
      }
      pendingDraft.current = null;
      correcting.current = false;
    }}
    onPaste={event => {
      event.preventDefault();
      const text = event.clipboardData.getData('text');
      const normalized = normalizePastedManualAmount(text);
      if (normalized === null) {
        reject(MANUAL_AMOUNT_PASTE_ERROR);
        return;
      }
      const result = manualAmountSchema.safeParse(insertedDraft(event.currentTarget, normalized));
      if (!result.success) {
        reject(result.error.issues[0].message);
        return;
      }
      onValueChange(result.data.toFixed(2));
      acceptCorrection();
    }}
    onBlur={() => {
      if (rejected.current || error || !value) return;
      const result = manualAmountSchema.safeParse(value);
      if (!result.success) reject(result.error.issues[0].message);
      else onValueChange(result.data.toFixed(2));
    }}
    onKeyDown={event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (rejected.current) return;
        const result = manualAmountSchema.safeParse(value);
        if (!result.success) reject(result.error.issues[0].message);
        else if (!rejected.current && !error && !props.disabled) onValidEnter?.();
      } else if (event.key === 'Escape' && onEscape) {
        event.preventDefault();
        onEscape();
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
        if (!checkInsertion(event.currentTarget, event.key)) event.preventDefault();
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        correcting.current = true;
        if (event.currentTarget.value === '') acceptCorrection();
      }
    }}
  />;
}
