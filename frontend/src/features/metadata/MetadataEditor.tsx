import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CslItem } from "../../api/csl";
import type { Source, UpdateSourceInput } from "../../api/library";
import type { SuggestOrigin } from "../../api/metadata";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Dialog } from "../../components/Dialog";
import forms from "../../components/Form.module.css";
import { useToast } from "../../components/Toast";
import { useConfig } from "../config/useConfig";
import { useUpdateSource } from "../library/useLibrary";
import { CitationKeyField, citationKeyProblem, type KeyEdit } from "./CitationKeyField";
import {
  applyMerge,
  citationKeyChange,
  cslToForm,
  defaultSelection,
  diffForms,
  formToCsl,
  isFormChanged,
  mergeUnmanagedKeys,
  sameJson,
  validateForm,
  type MergeItem,
  type MergeKey,
  type MetadataForm,
} from "./cslForm";
import { MergePanel } from "./MergePanel";
import { MetadataFields } from "./MetadataFields";
import { StatusBadge } from "./StatusBadge";
import { useLookupDoi, useSuggestMetadata } from "./useMetadata";
import styles from "./MetadataEditor.module.css";

interface Props {
  projectId: string;
  source: Source;
  onClose: () => void;
}

interface Suggestion {
  /** Where the data came from: Crossref (by DOI) or the PDF's own properties. */
  origin: Exclude<SuggestOrigin, "none">;
  /** The DOI was typed in the form (`lookup`) or found by the server in the PDF (`suggest`). */
  via: "lookup" | "suggest";
  doi: string | null;
  csl: CslItem;
  incoming: MetadataForm;
  items: MergeItem[];
  selected: Set<MergeKey>;
}

type Notice = { kind: "info" | "error"; text: string };

const FORM_ID = "metadata-form";

/** Edit a source's CSL-JSON metadata. Saving sends the whole item; "Save and confirm" also marks it confirmed. */
export function MetadataEditor({ projectId, source, onClose }: Props) {
  const { t, i18n } = useTranslation("metadata");
  const toast = useToast();
  const config = useConfig();
  const lookupEnabled = config.data?.metadata_lookup_enabled ?? true;
  const update = useUpdateSource(projectId);
  const lookup = useLookupDoi();
  const suggest = useSuggestMetadata();

  /** The stored item at the time of opening; every comparison for "unsaved changes" is against it. */
  const [original] = useState<CslItem>(source.csl);
  /** The item the form is written onto. It only grows (keys a suggestion adds) while editing. */
  const [base, setBase] = useState<CslItem>(source.csl);
  const [form, setForm] = useState<MetadataForm>(() => cslToForm(source.csl));
  const [keyEdit, setKeyEdit] = useState<KeyEdit>({ mode: "keep" });
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const errors = validateForm(form);
  const keyProblem = citationKeyProblem(keyEdit);
  const keyChange = citationKeyChange(source.citation_key, keyEdit);
  const dirty =
    isFormChanged(form, original) || !sameJson(base, original) || Object.keys(keyChange).length > 0;
  const busy = update.isPending;

  function patch(changes: Partial<MetadataForm>) {
    setForm((current) => ({ ...current, ...changes }));
  }

  function requestClose() {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  function submit(confirm: boolean) {
    setShowErrors(true);
    if (errors.length > 0 || keyProblem) return;
    const input: UpdateSourceInput = {
      csl: formToCsl(form, base),
      ...(confirm ? { metadata_status: "confirmed" as const } : {}),
      ...keyChange,
    };
    update.mutate(
      { id: source.id, input },
      {
        onSuccess: () => {
          toast.show(confirm ? t("editor.confirmed") : t("editor.saved"));
          onClose();
        },
      },
    );
  }

  function offer(origin: Suggestion["origin"], via: Suggestion["via"], csl: CslItem, doi: string | null) {
    const incoming = cslToForm(csl);
    const items = diffForms(form, incoming);
    if (items.length === 0) {
      setSuggestion(null);
      setNotice({ kind: "info", text: t("suggest.nothingNew") });
      return;
    }
    setNotice(null);
    setSuggestion({ origin, via, doi, csl, incoming, items, selected: defaultSelection(items) });
  }

  function runLookup() {
    setNotice(null);
    setSuggestion(null);
    lookup.mutate(form.doi.trim(), {
      onSuccess: ({ csl }) => offer("doi", "lookup", csl, form.doi.trim()),
      onError: (error) => setNotice({ kind: "error", text: translateError(i18n, error) }),
    });
  }

  function runSuggest() {
    setNotice(null);
    setSuggestion(null);
    suggest.mutate(source.id, {
      onSuccess: ({ csl, origin, doi }) => {
        if (origin === "none" || !csl) setNotice({ kind: "info", text: t("suggest.none") });
        else offer(origin, "suggest", csl, doi);
      },
      onError: (error) => setNotice({ kind: "error", text: translateError(i18n, error) }),
    });
  }

  function toggle(key: MergeKey) {
    setSuggestion((current) => {
      if (!current) return current;
      const selected = new Set(current.selected);
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      return { ...current, selected };
    });
  }

  function apply(keys: ReadonlySet<MergeKey>) {
    if (!suggestion || keys.size === 0) return;
    setForm((current) => applyMerge(current, suggestion.incoming, keys));
    setBase((current) => mergeUnmanagedKeys(current, suggestion.csl));
    setNotice({ kind: "info", text: t("suggest.applied", { count: keys.size }) });
    setSuggestion(null);
  }

  const mergeNote = !suggestion
    ? undefined
    : suggestion.via === "lookup"
      ? t("suggest.fromLookup")
      : suggestion.origin === "doi"
        ? t("suggest.fromDoi", { doi: suggestion.doi ?? "" })
        : t("suggest.fromPdf");

  const serverError = update.isError ? translateError(i18n, update.error) : null;

  return (
    <>
      <Dialog
        title={t("editor.title")}
        description={t("editor.description")}
        onClose={requestClose}
        xwide
        footer={
          <>
            <Button onClick={requestClose}>{t("common:cancel")}</Button>
            <Button type="submit" form={FORM_ID} disabled={busy}>
              {t("editor.save")}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => submit(true)}>
              {t("editor.saveAndConfirm")}
            </Button>
          </>
        }
      >
        <form
          id={FORM_ID}
          className={styles.form}
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            submit(false);
          }}
        >
          <div className={styles.status}>
            <StatusBadge status={source.metadata_status} />
            <span className={forms.hint}>
              {source.metadata_status === "confirmed" ? t("editor.statusConfirmed") : t("editor.statusUnconfirmed")}
            </span>
            {source.has_file && (
              <Button size="small" className={styles.push} disabled={suggest.isPending} onClick={runSuggest}>
                {suggest.isPending ? t("suggest.busy") : t("suggest.button")}
              </Button>
            )}
          </div>

          <div role="status" className={notice?.kind === "error" ? forms.error : forms.hint}>
            {notice?.text}
          </div>

          {suggestion && (
            <MergePanel
              title={suggestion.origin === "doi" ? t("merge.titleDoi") : t("merge.titlePdf")}
              note={mergeNote}
              type={form.type}
              items={suggestion.items}
              selected={suggestion.selected}
              onToggle={toggle}
              onUseAll={() => apply(new Set(suggestion.items.map((item) => item.key)))}
              onApply={() => apply(suggestion.selected)}
              onDismiss={() => setSuggestion(null)}
            />
          )}

          <MetadataFields
            form={form}
            onChange={patch}
            errors={errors}
            showErrors={showErrors}
            lookupEnabled={lookupEnabled}
            lookupBusy={lookup.isPending}
            onLookup={runLookup}
          />

          <CitationKeyField source={source} edit={keyEdit} onChange={setKeyEdit} showErrors={showErrors} />

          {showErrors && (errors.length > 0 || keyProblem) && (
            <p role="alert" className={forms.error}>
              {t("editor.fixErrors")}
            </p>
          )}
          <p role="alert" className={forms.error}>
            {serverError}
          </p>
        </form>
      </Dialog>

      {confirmDiscard && (
        <ConfirmDialog
          title={t("common:unsaved.title")}
          description={t("common:unsaved.body")}
          confirmLabel={t("common:unsaved.discard")}
          danger
          onClose={() => setConfirmDiscard(false)}
          onConfirm={onClose}
        />
      )}
    </>
  );
}
