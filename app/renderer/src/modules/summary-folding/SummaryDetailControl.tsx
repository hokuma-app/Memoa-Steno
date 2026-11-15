import { useId } from 'react';
import type { SummaryDetail } from '../../lib/summaryFoldingContracts';
import { foldText } from './foldText';
import './summary-folding.css';

export interface SummaryDetailControlProps {
  value: SummaryDetail;
  onChange: (value: SummaryDetail) => void;
  disabled?: boolean;
}
const choices: readonly SummaryDetail[] = ['brief', 'balanced', 'detailed'];
export function SummaryDetailControl({
  value,
  onChange,
  disabled = false,
}: SummaryDetailControlProps) {
  const id = useId();
  return (
    <fieldset
      className="summary-detail-setting"
      disabled={disabled}
      aria-describedby={`${id}-hint`}
    >
      <legend>{foldText.settings}</legend>
      <div className="summary-detail-choices">
        {choices.map((choice) => (
          <label key={choice}>
            <input
              type="radio"
              name={`${id}-detail`}
              value={choice}
              checked={choice === value}
              disabled={disabled}
              onChange={() => {
                if (!disabled) onChange(choice);
              }}
            />
            <span>{foldText.choices[choice]}</span>
          </label>
        ))}
      </div>
      <p id={`${id}-hint`}>{foldText.settingsHelp}</p>
    </fieldset>
  );
}
