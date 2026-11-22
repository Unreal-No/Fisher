import { useEffect, useState } from 'react';
import type { LivePos } from './types';

export interface LiveState { latest: Map<string, LivePos>; trail: Map<string, LivePos[]>; connected: boolean; lastAt: Date | null }
const MAX_TRAIL = 720;

/** Server-Sent Events feed of vessel positions (same-origin cookie auth). EventSource reconnects by itself. */
export function useLivePositions(): LiveState {
  const [st, setSt] = useState<LiveState>({ latest: new Map(), trail: new Map(), connected: false, lastAt: null });
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/v1/gps/stream');
    es.onopen = () => setSt((s) => ({ ...s, connected: true }));
    es.onerror = () => setSt((s) => ({ ...s, connected: false }));
    es.addEventListener('position', (ev) => {
      let p: LivePos;
      try { p = JSON.parse((ev as MessageEvent<string>).data) as LivePos; } catch { return; }
      setSt((s) => {
        const latest = new Map(s.latest);
        const old = latest.get(p.vesselId);
        if (!old || old.recordedAt <= p.recordedAt) latest.set(p.vesselId, p);
        const trail = new Map(s.trail);
        trail.set(p.vesselId, [...(trail.get(p.vesselId) ?? []), p].slice(-MAX_TRAIL));
        return { latest, trail, connected: true, lastAt: new Date() };
      });
    });
    return () => es.close();
  }, []);
  return st;
}
