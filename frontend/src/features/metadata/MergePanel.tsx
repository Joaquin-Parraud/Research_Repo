import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import forms from "../../components/Form.module.css";
import type { MergeItem, MergeKey } from "./cslForm";
import { fieldLabel, typeLabel } from "./fieldLabels";
import styles from "./MergePanel.module.css";

interface Props {
  title: string;
  note?: string;
  /** Type used for type-dependent labels. */
  type: string;
  items: readonly MergeItem[];
  selected: ReadonlySet<MergeKey>;
  onToggle: (key: MergeKey) => void;
  onUseAll: () => void;
  onApply: () => void;
  onDismiss: () => void;
}

/** Field-by-field comparison of what is in the form and what a lookup suggests. Nothing changes until "Apply". */
export function MergePanel({ title, note, type, items, selected, onToggle, onUseAll, onApply, onDismiss }: Props) {
  const { t } = useTranslation("metadata");
  const headingId = useId();
  const show = (item: MergeItem, value: string) => (item.key === "type" ? typeLabel(t, value) : value);

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h3 id={headingId} className={forms.sectionTitle}>
        {title}
      </h3>
      {note && <p className={forms.hint}>{note}</p>}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t("merge.use")}</th>
              <th scope="col">{t("merge.field")}</th>
              <th scope="col">{t("merge.current")}</th>
              <th scope="col">{t("merge.suggested")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const label = fieldLabel(t, item.key, type);
              return (
                <tr key={item.key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(item.key)}
                      aria-label={t("merge.useField", { field: label })}
                      onChange={() => onToggle(item.key)}
                    />
                  </td>
                  <th scope="row">{label}</th>
                  <td className={item.current ? undefined : styles.none}>
                    {item.current ? show(item, item.current) : t("merge.empty")}
                  </td>
                  <td>{show(item, item.incoming)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.actions}>
        <Button size="small" onClick={onUseAll}>
          {t("merge.useAll")}
        </Button>
        <Button size="small" variant="primary" disabled={selected.size === 0} onClick={onApply}>
          {t("merge.apply", { count: selected.size })}
        </Button>
        <Button size="small" variant="ghost" onClick={onDismiss}>
          {t("merge.dismiss")}
        </Button>
      </div>
    </section>
  );
}
