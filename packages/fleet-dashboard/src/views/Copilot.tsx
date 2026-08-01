import { Empty, Row, Rows, Group, ViewHeader } from "../components/ui";
import type { Ctx } from "./context";

/**
 * ✦ Copilot — a stub, and it says so.
 *
 * The design calls for a brainstorm partner that can commission research and
 * turn a conclusion into an initiative. That needs a model, which needs a
 * backend, which this app does not have (and whose CSP pins it to
 * api.github.com). So v2 ships the half that works without one: the ⌘K palette,
 * which is real, keyboard-driven, and does everything a command palette should.
 *
 * Saying "no chat yet" in the UI is the point. A disabled text box with a
 * plausible placeholder would imply the feature exists and is broken.
 */
export function Copilot({ ctx, onOpenPalette }: { ctx: Ctx; onOpenPalette: () => void }) {
  return (
    <>
      <ViewHeader
        title="Copilot"
        sub="the command palette works; the conversation does not exist yet"
        actions={
          <button type="button" className="bt pri" onClick={onOpenPalette}>
            open palette ⌘K
          </button>
        }
      />

      <Empty>
        <b>There is no chat here yet, and this is not a loading state.</b> A copilot that can
        brainstorm and commission research needs a model to talk to. This dashboard has no backend
        and its Content-Security-Policy allows exactly one host — api.github.com — so there is
        nowhere to send a prompt from. Until a backend exists, the palette below is the honest
        subset: it does the things that are really just GitHub calls.
      </Empty>

      <Rows>
        <Group right="⌘K from anywhere">what the palette does today</Group>
        <Row>
          <span className="grow">
            <b>File an issue</b> to any app, optionally against an initiative
            <span className="sm">
              Creates a real issue with <code>agent:ready</code> and an <code>init:*</code> label.
            </span>
          </span>
        </Row>
        <Row>
          <span className="grow">
            <b>Save a dump</b> to the inbox
            <span className="sm">
              Same path as the Inbox paste box — one <code>inbox:raw</code> issue, verbatim.
            </span>
          </span>
        </Row>
        <Row>
          <span className="grow">
            <b>Open Claude Code</b>
            <span className="sm">
              A link to <code>{ctx.config.claudeCodeUrl}</code>, where the actual conversation
              happens today.
            </span>
          </span>
        </Row>
        <Row>
          <span className="grow">
            <b>Jump to any view</b>
            <span className="sm">Type a view name and press ↵.</span>
          </span>
        </Row>
      </Rows>

      <p className="foot">
        Course-correcting mid-day is a Telegram message, not a chat window here — that is the
        design, not a limitation of the stub.{" "}
        <a href={ctx.config.telegramUrl} target="_blank" rel="noreferrer">
          🎙 course-correct
        </a>
      </p>
    </>
  );
}
