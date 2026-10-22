import { importGame, serialize } from '../game/state.ts';
import { simulate } from '../game/sim.ts';

interface CatchUpRequest {
  id: number;
  save: string;
  seconds: number;
}

self.addEventListener('message', (event: MessageEvent<CatchUpRequest>) => {
  const request = event.data;
  if (!request) return;
  try {
    const state = importGame(request.save);
    simulate(state, request.seconds, 1);
    const save = serialize(state);
    (self as unknown as Worker).postMessage({ id: request.id, save });
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'catch-up failed',
    });
  }
});
