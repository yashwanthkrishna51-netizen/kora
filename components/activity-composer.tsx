"use client";

import { useRef, useState } from "react";
import { Paperclip, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api/fetcher";
import { keys } from "@/lib/query/keys";
import { isConflict } from "@/lib/query/mutations";
import { validateFile, uploadFile, type UploadedFile } from "@/lib/uploads-client";

/**
 * Posting an update, with an optional attachment.
 *
 * NO If-Match on any activity route, deliberately: two people commenting at
 * once is a conversation, not a conflict, and the append is atomic in SQL.
 *
 * But every activity write BUMPS THE PARENT'S `_v` — migration 0006 installs
 * the trigger on all seven tables — so any token the screen is holding for that
 * integration or phase is stale the moment anyone posts. The client's tree is
 * refetched on success rather than surgically patched, which both refreshes
 * those tokens and gets the signed attachment URL: the POST response is NOT
 * signed, so an optimistic insert would render a filename with a dead link.
 */

export function ActivityComposer({
  parentKind,
  parentId,
  clientId,
}: {
  parentKind: "integration" | "phase";
  parentId: string;
  clientId: string;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const path = `/api/${parentKind === "integration" ? "integrations" : "phases"}/${encodeURIComponent(parentId)}/activity`;

  const post = useMutation({
    mutationFn: () =>
      api<{ entry: unknown; _v: string | null }>(path, {
        method: "POST",
        body: { update: text.trim(), ...(attachment ? { attachment } : {}) },
        screen: parentKind === "integration" ? "integrations" : "implementation",
      }),
    onSuccess() {
      setText("");
      setAttachment(null);
      if (fileRef.current) fileRef.current.value = "";
      // Scoped to the client that changed and the shared tree, rather than the
      // whole ["clients"] prefix — no other client's detail query is affected
      // by a comment on this one.
      void qc.invalidateQueries({ queryKey: keys.clients.one(clientId) });
      void qc.invalidateQueries({ queryKey: keys.clients.tree() });
    },
    onError(err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not post that update.",
      );
    },
  });

  async function pick(file: File | undefined) {
    if (!file) return;
    // Checked locally first. The server is still the authority and rejects
    // anything this misses — but a 3MB round trip is a slow way to be told
    // something the browser already knew.
    const problem = await validateFile(file);
    if (problem) {
      toast.error(problem);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      setAttachment(await uploadFile(file));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setUploading(false);
    }
  }

  const busy = post.isPending || uploading;
  const canPost = text.trim().length > 0 && !busy;

  return (
    // 1d draws ONE bordered box, not a field inside a tinted tray. The border
    // and the focus ring move to the container so the textarea can sit flush
    // inside it without the composer reading as two nested controls.
    <div className="rounded-[4px] border border-k-line bg-k-paper p-2.5 transition-shadow focus-within:border-k-primary focus-within:shadow-[var(--k-focus-ring)]">
      <textarea
        className="k-textarea !min-h-[64px] !border-0 !bg-transparent !px-0 focus:!shadow-none"
        rows={2}
        placeholder="Add an update…"
        aria-label="Update"
        value={text}
        disabled={post.isPending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter is a newline here — updates are prose, and v1's feed had the
          // same behaviour. Cmd/Ctrl+Enter posts, which is what the hint below
          // advertises.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canPost) {
            e.preventDefault();
            post.mutate();
          }
        }}
      />

      {attachment && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px]">
          <Paperclip size={11} strokeWidth={1.5} aria-hidden className="shrink-0" />
          <span className="min-w-0 truncate text-k-ink-3">
            {attachment.fileName}
          </span>
          <button
            type="button"
            onClick={() => {
              // Only detaches it from THIS post. The file is already in
              // storage and nothing sweeps it — see the note in the plan.
              setAttachment(null);
              if (fileRef.current) fileRef.current.value = "";
            }}
            aria-label={`Remove ${attachment.fileName}`}
            className="k-btn k-btn-ghost k-btn-sm !h-5 !px-1"
          >
            <X size={11} strokeWidth={1.5} />
          </button>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            id={`attach-${parentId}`}
            accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.gif,.webp,.eml,.msg"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <label
            htmlFor={`attach-${parentId}`}
            className="k-btn k-btn-outline k-btn-sm cursor-pointer"
          >
            {uploading ? (
              <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
            ) : (
              <Paperclip size={12} strokeWidth={1.5} />
            )}
            {uploading ? "Uploading…" : "Attach"}
          </label>
        </div>

        <div className="flex min-w-0 items-center gap-2.5">
          {/* 1d writes "⌘S to save" here. ⌘S is the browser's Save Page, and
              swallowing it in a textarea is hostile; ⌘↵ is what this app has
              always used to post and what the shortcut handler above binds. */}
          <span className="k-mono truncate text-[10.5px] text-k-mute">
            ⌘↵ to post · PDF, Excel, image or email, max 3MB
          </span>
          <button
            type="button"
            className="k-btn k-btn-primary k-btn-sm"
            disabled={!canPost}
            onClick={() => post.mutate()}
          >
            {post.isPending ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Editing and deleting one entry.
 *
 * Author-or-admin, matched the way the server matches it — on the stored
 * display name against either `name` or `username` (`activity.ts:275-280`).
 * Showing controls a viewer's own server would refuse is worse than not showing
 * them.
 *
 * The index race is the interesting failure: entries are PREPENDED, so a
 * concurrent post shifts every position and the server answers **400** — not
 * 409 — with "That entry moved while you were editing it". `isConflict` knows
 * about that, so it is reported as the conflict it is.
 */
export function useActivityItemMutations({
  parentKind,
  parentId,
  entryId,
}: {
  parentKind: "integration" | "phase";
  parentId: string;
  entryId: string;
}) {
  const qc = useQueryClient();
  const base = `/api/${parentKind === "integration" ? "integrations" : "phases"}/${encodeURIComponent(parentId)}/activity/${encodeURIComponent(entryId)}`;
  const screen = parentKind === "integration" ? "integrations" : "implementation";

  const report = (err: unknown) => {
    if (isConflict(err)) {
      toast.error("Someone posted while you were editing. Reloading the feed.");
    } else {
      toast.error(
        err instanceof ApiError ? err.message : "That change did not save.",
      );
    }
    void qc.invalidateQueries({ queryKey: keys.clients.all });
  };

  const edit = useMutation({
    // PATCH parses the FULL create schema, not a partial — `update` is required
    // on every edit, so the text always goes with it.
    mutationFn: (update: string) =>
      api(base, { method: "PATCH", body: { update }, screen }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.clients.all }),
    onError: report,
  });

  const remove = useMutation({
    mutationFn: () => api(base, { method: "DELETE", screen }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.clients.all }),
    onError: report,
  });

  return { edit, remove };
}
