import { useState } from "react";

import { labelsAfterKeep, LABELS } from "../lib/labels";
import { selectProposed, selectRawDumps } from "../lib/select";
import { age } from "../lib/time";
import type { IssueCard } from "../sources/types";
import { Empty, Group, Pill, Row, Rows, ViewHeader } from "../components/ui";
import type { Ctx } from "./context";

/**
 * 📥 Inbox — everything that arrived from outside the pipeline.
 *
 * The intended path is Telegram: you send a voice note or a text to the bot, a
 * worker transcribes and extracts it, and each item lands here as an
 * `inbox:proposed` issue for keep-or-reject. That worker is a separate
 * workstream. Until it exists, the paste box below is the honest fallback — it
 * files **one** `inbox:raw` issue holding the dump verbatim, for the extraction
 * pipeline to split later.
 *
 * It deliberately does not split the paste itself. Doing that client-side would
 * mean either a regex pretending to be comprehension, or shipping an LLM call
 * from a page whose CSP pins it to api.github.com. One honest issue beats five
 * confident wrong ones.
 */
export function Inbox({ ctx }: { ctx: Ctx }) {
  const proposed = selectProposed(ctx.snapshot.issues);
  const raw = selectRawDumps(ctx.snapshot.issues);

  return (
    <>
      <ViewHeader title="Inbox" sub="dumps in, proposals out — nothing enters the queue unread" />

      <PasteBox ctx={ctx} />

      {raw.length > 0 && (
        <Rows>
          <Group right="waiting on extraction">raw dumps</Group>
          {raw.map((issue) => (
            <Row key={issue.id}>
              <Pill>raw</Pill>
              <span className="grow">
                <a href={issue.url} target="_blank" rel="noreferrer">
                  {issue.title}
                </a>
                <span className="sm">
                  {issue.repoLabel} #{issue.number} · filed {age(issue.createdAt)} ago
                </span>
              </span>
            </Row>
          ))}
        </Rows>
      )}

      {proposed.length === 0 ? (
        <Empty>
          <b>No proposals waiting.</b> Items land here when the Telegram worker extracts a dump into
          individual <code>{LABELS.inboxProposed}</code> issues — send a voice note or a message to
          the bot and it files them against the right repo. Pasting above files the dump itself as{" "}
          <code>{LABELS.inboxRaw}</code>; extraction is what turns it into these cards.
        </Empty>
      ) : (
        <Rows>
          <Group tone="p" right={`${proposed.length} waiting`}>
            proposed — keep, edit, or reject
          </Group>
          {proposed.map((issue) => (
            <ProposalRow key={issue.id} ctx={ctx} issue={issue} />
          ))}
        </Rows>
      )}
    </>
  );
}

function ProposalRow({ ctx, issue }: { ctx: Ctx; issue: IssueCard }) {
  const keepKey = `keep:${issue.id}`;
  const rejectKey = `reject:${issue.id}`;
  const busy = ctx.actions.busy;

  return (
    <Row>
      <span className="grow">
        <a href={issue.url} target="_blank" rel="noreferrer">
          {issue.title}
        </a>
        <span className="sm">
          {issue.repoLabel} #{issue.number}
          {issue.initiatives.length > 0 && ` · ${issue.initiatives.join(", ")}`}
          {issue.size !== null && ` · size ${issue.size}`} · {age(issue.createdAt)} ago
        </span>
      </span>
      <span className="bt-row">
        <button
          type="button"
          className="bt pri"
          disabled={busy !== null}
          onClick={() =>
            ctx.actions.run(
              keepKey,
              async (writer) => {
                // Set the full surviving label set in one call so the `init:*`
                // labels the extractor wrote are provably still there afterwards,
                // then drop the proposal marker.
                await writer.addLabels(
                  issue.repoSlug,
                  issue.number,
                  labelsAfterKeep(issue.labels.map((name) => ({ name }))),
                );
                await writer.removeLabel(issue.repoSlug, issue.number, LABELS.inboxProposed);
              },
              `Kept #${issue.number} — it is on ${LABELS.ready} for the next plan.`,
            )
          }
        >
          {busy === keepKey ? "…" : "Keep"}
        </button>
        <a className="bt" href={`${issue.url}#issue-edit`} target="_blank" rel="noreferrer">
          Edit
        </a>
        <button
          type="button"
          className="bt danger"
          disabled={busy !== null}
          onClick={() => {
            const reason = window.prompt(`Reject: ${issue.title}\n\nWhy? (teaches the extractor)`);
            if (reason === null || reason.trim() === "") return;
            ctx.actions.run(
              rejectKey,
              (writer) =>
                writer.closeIssue(
                  issue.repoSlug,
                  issue.number,
                  `Rejected at inbox: ${reason.trim()}`,
                ),
              `Rejected #${issue.number} — closed with your reason.`,
            );
          }}
        >
          {busy === rejectKey ? "…" : "Reject"}
        </button>
      </span>
    </Row>
  );
}

function PasteBox({ ctx }: { ctx: Ctx }) {
  const [text, setText] = useState("");
  const [slug, setSlug] = useState(ctx.config.repos[0]?.slug ?? "");
  const [filed, setFiled] = useState<{ url: string; number: number } | null>(null);
  const key = "paste";
  const busy = ctx.actions.busy === key;

  const firstLine = text.trim().split("\n")[0] ?? "";
  const title = firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;

  return (
    <Rows>
      <Group right={`filed as ${LABELS.inboxRaw}`}>paste a dump</Group>
      <div className="row">
        <span className="grow">
          <label className="field">
            <span className="sr-only">Dump text</span>
            <textarea
              value={text}
              placeholder="Paste notes, a transcript, a thread — anything. It is filed verbatim as one issue for the extraction pipeline to split."
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Repo</span>
            <select value={slug} onChange={(event) => setSlug(event.target.value)}>
              {ctx.config.repos.map((repo) => (
                <option key={repo.slug} value={repo.slug}>
                  {repo.label}
                </option>
              ))}
            </select>
          </label>
          {filed !== null && (
            <span className="sm">
              Filed{" "}
              <a href={filed.url} target="_blank" rel="noreferrer">
                #{filed.number}
              </a>{" "}
              with <code>{LABELS.inboxRaw}</code>. It will show under “raw dumps” on the next
              refresh.
            </span>
          )}
        </span>
        <button
          type="button"
          className="bt pri"
          disabled={ctx.actions.busy !== null || text.trim() === "" || slug === ""}
          onClick={() =>
            ctx.actions.run(key, async (writer) => {
              const created = await writer.createIssue(slug, {
                title: title === "" ? "Inbox dump" : title,
                body: text,
                labels: [LABELS.inboxRaw],
              });
              setFiled(created);
              setText("");
            })
          }
        >
          {busy ? "filing…" : "File dump"}
        </button>
      </div>
    </Rows>
  );
}
