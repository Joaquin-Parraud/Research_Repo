import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { flattenForPicker, type TreeNode } from "../library/tree";
import styles from "./FolderPickerDialog.module.css";

interface Props {
  title: string;
  description?: string;
  roots: readonly TreeNode[];
  /** Folder ids (or null = root) that cannot be chosen. */
  disabledIds?: ReadonlySet<string | null>;
  /** Where the thing being moved is now; shown as "current" and not selectable. */
  currentId?: string | null | undefined;
  onPick: (folderId: string | null) => void;
  onClose: () => void;
}

const ROOT_VALUE = "__root__";

/** "Move to…" folder chooser: the keyboard equivalent of drag-and-drop. */
export function FolderPickerDialog({
  title,
  description,
  roots,
  disabledIds,
  currentId,
  onPick,
  onClose,
}: Props) {
  const { t } = useTranslation("library");
  const groupName = useId();
  const [choice, setChoice] = useState<string | null>(null);
  const entries = flattenForPicker(roots);

  const options: { value: string; id: string | null; label: string; depth: number }[] = [
    { value: ROOT_VALUE, id: null, label: t("folders.root"), depth: 0 },
    ...entries.map((entry) => ({
      value: entry.folder.id,
      id: entry.folder.id,
      label: entry.folder.name,
      depth: entry.depth + 1,
    })),
  ];

  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common:cancel")}</Button>
          <Button
            variant="primary"
            disabled={choice === null}
            onClick={() => choice !== null && onPick(choice === ROOT_VALUE ? null : choice)}
          >
            {t("move.confirm")}
          </Button>
        </>
      }
    >
      <ul className={styles.list} role="radiogroup" aria-label={title}>
        {options.map((option) => {
          const isCurrent = currentId !== undefined && option.id === currentId;
          const disabled = isCurrent || (disabledIds?.has(option.id) ?? false);
          return (
            <li key={option.value}>
              <label
                className={`${styles.option} ${disabled ? styles.disabled : ""}`}
                style={{ paddingLeft: `${0.5 + option.depth * 1}rem` }}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={option.value}
                  disabled={disabled}
                  checked={choice === option.value}
                  onChange={() => setChoice(option.value)}
                />
                <span>{option.label}</span>
                {isCurrent && <span className={styles.note}>{t("move.current")}</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
