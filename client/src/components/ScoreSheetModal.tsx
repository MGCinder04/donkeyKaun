import { Button } from "./Button";
import type { PublicPlayer, RoundSummary } from "../rooms/types";

interface ScoreSheetModalProps {
  roundHistory: RoundSummary[];
  players: PublicPlayer[];
  scores: Record<string, number>;
  seatOrder: string[];
  onClose: () => void;
}

export function ScoreSheetModal({ roundHistory, players, scores, seatOrder, onClose }: ScoreSheetModalProps) {
  const nameFor = (id: string) => players.find((p) => p.deviceId === id)?.name ?? "?";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-2xl border p-6"
        style={{ background: "var(--ground-raised)", borderColor: "var(--hairline)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">Scoresheet</h3>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        {roundHistory.length === 0 ? (
          <p style={{ color: "var(--ink-dim)" }}>No rounds completed yet.</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--hairline)" }}>
                <th className="py-2 pr-3 font-semibold" style={{ color: "var(--ink-faint)" }}>
                  Round
                </th>
                {seatOrder.map((id) => (
                  <th key={id} className="py-2 pr-3 font-semibold" style={{ color: "var(--ink-faint)" }}>
                    {nameFor(id)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roundHistory.map((summary) => (
                <tr key={summary.round} style={{ borderBottom: "1px solid var(--hairline)" }}>
                  <td className="py-2 pr-3" style={{ color: "var(--ink-dim)" }}>
                    {summary.round}
                  </td>
                  {seatOrder.map((id) => {
                    const r = summary.results.find((res) => res.deviceId === id);
                    return (
                      <td key={id} className="py-2 pr-3">
                        {r ? `${r.bid}→${r.tricksWon} (${r.roundScore})` : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="py-2 pr-3 font-semibold" style={{ color: "var(--gold)" }}>
                  Total
                </td>
                {seatOrder.map((id) => (
                  <td key={id} className="py-2 pr-3 font-semibold" style={{ color: "var(--gold-bright)" }}>
                    {scores[id] ?? 0}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
