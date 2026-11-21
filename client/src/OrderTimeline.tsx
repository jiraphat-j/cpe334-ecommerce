import { useEffect, useId, useState } from "react";

type StatusEvent = {
  from_status: string;
  to_status: string;
  created_at: string;
};

type TimelineResult =
  | { events: StatusEvent[] }
  | { error: string };

export function OrderTimeline({ orderId, token }: { orderId: string; token: string }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<TimelineResult | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    async function loadTimeline() {
      try {
        const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error?.message ?? "Could not load status history.");
        }
        if (!controller.signal.aborted) setResult({ events: data.data.order.timeline });
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({ error: error instanceof Error ? error.message : "Could not load status history." });
        }
      }
    }
    void loadTimeline();
    return () => controller.abort();
  }, [open, orderId, token]);

  return (
    <div>
      <button
        type="button"
        className="btn btn-secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => { setResult(null); setOpen(!open); }}
      >
        {open ? "Hide timeline" : "View timeline"}
      </button>
      <div id={panelId} hidden={!open} className="order-timeline">
        {open && !result && <p role="status">Loading status history…</p>}
        {open && result && "error" in result && <p role="alert">{result.error}</p>}
        {open && result && "events" in result && (
          result.events.length === 0 ? <p>No status history yet</p> : (
            <ol>
              {result.events.map((event, index) => (
                <li key={`${event.created_at}-${index}`}>
                  <strong>{event.from_status} → {event.to_status}</strong>
                  <br />
                  <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
                </li>
              ))}
            </ol>
          )
        )}
      </div>
    </div>
  );
}
