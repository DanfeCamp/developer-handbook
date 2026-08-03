import {useId, useMemo, useState, type ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

export type QuizOption = {
  /** The answer text shown next to the radio/checkbox. */
  text: string;
  /** Marks this option as part of the correct answer. */
  correct?: boolean;
  /**
   * Why this option is right or wrong. Shown after the learner checks their
   * answer. Supplying this for *incorrect* options is what turns a quiz from a
   * score into a teaching moment.
   */
  why?: ReactNode;
};

export type QuizProps = {
  /** The question itself. */
  question: ReactNode;
  /**
   * `single` renders radios and accepts one answer.
   * `multiple` renders checkboxes and requires the exact correct set.
   * Defaults to `multiple` when more than one option is marked correct.
   */
  type?: 'single' | 'multiple';
  options: QuizOption[];
  /** Shown once answered, regardless of whether the learner was right. */
  explanation?: ReactNode;
  /** Optional pointer back into the handbook for further reading. */
  reference?: {label: string; href: string};
  /** Optional code sample rendered above the options. */
  children?: ReactNode;
};

/**
 * An interactive, self-marking quiz question.
 *
 * Rendering is deferred until the learner commits an answer so that the correct
 * option is never revealed by inspecting the DOM before they have tried.
 */
export default function Quiz({
  question,
  type,
  options,
  explanation,
  reference,
  children,
}: QuizProps): ReactNode {
  const groupName = useId();
  const [selected, setSelected] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const correctIndexes = useMemo(
    () =>
      options.reduce<number[]>(
        (acc, option, index) => (option.correct ? [...acc, index] : acc),
        [],
      ),
    [options],
  );

  // Infer the interaction model from the data so authors cannot mark two
  // options correct while accidentally rendering single-answer radios.
  const mode = type ?? (correctIndexes.length > 1 ? 'multiple' : 'single');
  const isMultiple = mode === 'multiple';

  const isCorrect =
    selected.length === correctIndexes.length &&
    selected.every((index) => correctIndexes.includes(index));

  function toggle(index: number) {
    if (submitted) {
      return;
    }
    setSelected((current) => {
      if (!isMultiple) {
        return [index];
      }
      return current.includes(index)
        ? current.filter((i) => i !== index)
        : [...current, index];
    });
  }

  function reset() {
    setSelected([]);
    setSubmitted(false);
  }

  return (
    <section className={styles.quiz}>
      <fieldset className={styles.fieldset} disabled={submitted}>
        <legend className={styles.legend}>
          <span className={styles.badge}>
            {isMultiple ? 'Select all that apply' : 'Quiz'}
          </span>
          <span className={styles.question}>{question}</span>
        </legend>

        {children ? <div className={styles.body}>{children}</div> : null}

        <ul className={styles.options}>
          {options.map((option, index) => {
            const checked = selected.includes(index);
            const isRight = correctIndexes.includes(index);
            return (
              <li key={index}>
                <label
                  className={clsx(
                    styles.option,
                    checked && styles.optionChecked,
                    submitted && isRight && styles.optionCorrect,
                    submitted && checked && !isRight && styles.optionIncorrect,
                  )}
                >
                  <input
                    className={styles.input}
                    type={isMultiple ? 'checkbox' : 'radio'}
                    name={groupName}
                    checked={checked}
                    onChange={() => toggle(index)}
                  />
                  <span className={styles.optionText}>{option.text}</span>
                  {submitted && isRight ? (
                    <span className={styles.mark} aria-label="Correct answer">
                      ✓
                    </span>
                  ) : null}
                  {submitted && checked && !isRight ? (
                    <span className={styles.mark} aria-label="Your answer">
                      ✕
                    </span>
                  ) : null}
                </label>
                {submitted && option.why ? (
                  <p className={styles.why}>{option.why}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className={styles.actions}>
        {submitted ? (
          <button type="button" className={styles.button} onClick={reset}>
            Try again
          </button>
        ) : (
          <button
            type="button"
            className={styles.button}
            disabled={selected.length === 0}
            onClick={() => setSubmitted(true)}
          >
            Check answer
          </button>
        )}
      </div>

      <div aria-live="polite">
        {submitted ? (
          <div
            className={clsx(
              styles.result,
              isCorrect ? styles.resultCorrect : styles.resultIncorrect,
            )}
          >
            <strong className={styles.resultTitle}>
              {isCorrect ? '✓ Correct' : '✕ Not quite'}
            </strong>
            {explanation ? (
              <div className={styles.explanation}>{explanation}</div>
            ) : null}
            {reference ? (
              <p className={styles.reference}>
                Read more: <Link to={reference.href}>{reference.label}</Link>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
