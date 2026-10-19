import { queryClient } from "../db/client";

/** What changed, as the DB triggers name it (notify_form_event). */
export type FormEventKind = "response" | "analysis" | "form";
type Listener = (kind: FormEventKind) => void;

const listeners = new Map<number, Set<Listener>>();
let listening: Promise<unknown> | null = null;

/**
 * Postgres NOTIFY → whoever has that form's dashboard open. One LISTEN connection per
 * server process, opened on first use; postgres.js reconnects it if it drops. Each
 * server instance listens itself, so this works with more than one.
 */
function ensureListening() {
  listening ??= queryClient
    .listen("form_events", (payload) => {
      try {
        const { formId, kind } = JSON.parse(payload) as { formId: number; kind: FormEventKind };
        for (const listener of listeners.get(formId) ?? []) listener(kind);
      } catch {
        // Not ours / malformed: nothing to deliver.
      }
    })
    .catch((error) => {
      listening = null; // let the next subscriber try again
      console.error("form_events LISTEN failed", error);
    });
}

/** Calls `listener` for each change to `formId`; returns the unsubscribe. */
export function subscribeFormEvents(formId: number, listener: Listener): () => void {
  ensureListening();
  const set = listeners.get(formId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(formId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(formId);
  };
}

const PING_MS = 25_000;

/**
 * A Server-Sent Events stream of `formId`'s changes. A comment line every 25s keeps
 * proxies (nginx, KMUTT's) from closing an idle connection.
 */
export function formEventStream(formId: number, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      send("retry: 5000\n\n");
      const unsubscribe = subscribeFormEvents(formId, (kind) => send(`event: ${kind}\ndata: {}\n\n`));
      const ping = setInterval(() => send(": ping\n\n"), PING_MS);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx: don't buffer this response (see gnp-client/deploy/nginx.conf).
      "X-Accel-Buffering": "no",
    },
  });
}
