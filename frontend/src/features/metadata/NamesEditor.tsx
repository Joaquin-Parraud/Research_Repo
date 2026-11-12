import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import forms from "../../components/Form.module.css";
import { blankEntry, moveEntry, type FormError, type NameEntry, type NameKind } from "./cslForm";
import styles from "./NamesEditor.module.css";

export type NameRole = "author" | "editor";

interface Props {
  role: NameRole;
  entries: NameEntry[];
  onChange: (entries: NameEntry[]) => void;
  /** Errors for this list only. */
  errors: readonly FormError[];
}

/** What to focus after the list re-renders: a control inside an entry, or the "add" button. */
interface FocusRequest {
  entryId: string | null;
  field: string;
}

/**
 * Ordered list of people and organisations. Every action is a native button; moving can also be done
 * with Alt+ArrowUp / Alt+ArrowDown from inside a row. Focus follows the moved row and moves are announced.
 */
export function NamesEditor({ role, entries, onChange, errors }: Props) {
  const { t } = useTranslation("metadata");
  const containerRef = useRef<HTMLFieldSetElement>(null);
  const focusRequest = useRef<FocusRequest | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Runs after every change of the list: if an action asked for focus, give it now that the DOM is updated.
  useEffect(() => {
    const request = focusRequest.current;
    const container = containerRef.current;
    if (!request || !container) return;
    focusRequest.current = null;
    const scope = request.entryId
      ? container.querySelector(`[data-entry-id="${request.entryId}"]`)
      : container;
    let target = scope?.querySelector<HTMLElement>(`[data-field="${request.field}"]`) ?? null;
    if (target instanceof HTMLButtonElement && target.disabled) {
      // At the end of the list the button that was used is now disabled: use its counterpart.
      const other = request.field === "up" ? "down" : "up";
      target = scope?.querySelector<HTMLElement>(`[data-field="${other}"]`) ?? target;
    }
    target?.focus();
  }, [entries]);

  function update(id: string, patch: Partial<NameEntry>) {
    onChange(entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  function move(index: number, delta: -1 | 1, field: string) {
    const to = index + delta;
    const entry = entries[index];
    if (!entry || to < 0 || to >= entries.length) return;
    focusRequest.current = { entryId: entry.id, field };
    onChange(moveEntry(entries, index, to));
    setAnnouncement(t(`names.${role}.moved`, { position: to + 1, total: entries.length }));
  }

  function add(kind: NameKind) {
    const entry = blankEntry(kind);
    focusRequest.current = { entryId: entry.id, field: kind === "person" ? "family" : "literal" };
    onChange([...entries, entry]);
  }

  function remove(index: number) {
    const entry = entries[index];
    if (!entry) return;
    focusRequest.current = { entryId: null, field: "add-person" };
    onChange(entries.filter((candidate) => candidate.id !== entry.id));
    setAnnouncement(t(`names.${role}.removed`, { position: index + 1 }));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const field = event.target instanceof HTMLElement ? (event.target.dataset.field ?? "up") : "up";
    move(index, event.key === "ArrowUp" ? -1 : 1, field);
  }

  return (
    <fieldset ref={containerRef} className={styles.names}>
      <legend className={styles.legend}>{t(`names.${role}.legend`)}</legend>
      {entries.length === 0 && <p className={forms.hint}>{t(`names.${role}.none`)}</p>}
      <ol className={styles.list}>
        {entries.map((entry, index) => {
          const error = errors.find((candidate) => candidate.index === index);
          const errorId = `${entry.id}-error`;
          return (
            <li key={entry.id} data-entry-id={entry.id} className={styles.item}>
              <div
                role="group"
                aria-label={t(`names.${role}.item`, { position: index + 1 })}
                className={styles.group}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                <div className={styles.fields}>
                  <label className={`${forms.field} ${styles.kind}`}>
                    {t("names.kind")}
                    <select
                      className={forms.select}
                      data-field="kind"
                      value={entry.kind}
                      onChange={(event) =>
                        update(entry.id, {
                          kind: event.target.value === "organisation" ? "organisation" : "person",
                        })
                      }
                    >
                      <option value="person">{t("names.person")}</option>
                      <option value="organisation">{t("names.organisation")}</option>
                    </select>
                  </label>
                  {entry.kind === "person" ? (
                    <>
                      <label className={forms.field}>
                        {t("names.family")}
                        <input
                          className={forms.input}
                          data-field="family"
                          value={entry.family}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? errorId : undefined}
                          onChange={(event) => update(entry.id, { family: event.target.value })}
                        />
                      </label>
                      <label className={forms.field}>
                        {t("names.given")}
                        <input
                          className={forms.input}
                          data-field="given"
                          value={entry.given}
                          onChange={(event) => update(entry.id, { given: event.target.value })}
                        />
                      </label>
                    </>
                  ) : (
                    <label className={`${forms.field} ${styles.wide}`}>
                      {t("names.organisationName")}
                      <input
                        className={forms.input}
                        data-field="literal"
                        value={entry.literal}
                        onChange={(event) => update(entry.id, { literal: event.target.value })}
                      />
                    </label>
                  )}
                </div>
                <div className={styles.actions}>
                  <Button
                    size="small"
                    variant="ghost"
                    data-field="up"
                    disabled={index === 0}
                    aria-label={t(`names.${role}.moveUp`, { position: index + 1 })}
                    onClick={() => move(index, -1, "up")}
                  >
                    ↑
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    data-field="down"
                    disabled={index === entries.length - 1}
                    aria-label={t(`names.${role}.moveDown`, { position: index + 1 })}
                    onClick={() => move(index, 1, "down")}
                  >
                    ↓
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    data-field="remove"
                    aria-label={t(`names.${role}.remove`, { position: index + 1 })}
                    onClick={() => remove(index)}
                  >
                    {t("names.removeShort")}
                  </Button>
                </div>
              </div>
              {error && (
                <p id={errorId} className={forms.error}>
                  {t(`validation.${error.code}`)}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div className={styles.add}>
        <Button size="small" data-field="add-person" onClick={() => add("person")}>
          {t("names.addPerson")}
        </Button>
        <Button size="small" onClick={() => add("organisation")}>
          {t("names.addOrganisation")}
        </Button>
      </div>
      {entries.length > 1 && <p className={forms.hint}>{t("names.keyboardHint")}</p>}
      <p className={forms.visuallyHidden} role="status">
        {announcement}
      </p>
    </fieldset>
  );
}
