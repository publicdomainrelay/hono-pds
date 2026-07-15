import type { Sequencer } from "@publicdomainrelay/atproto-repo-abc";
import type { SubscribeHandler } from "@publicdomainrelay/atproto-repo-common";

export function createSubscribeHandler(sequencer: Sequencer): SubscribeHandler {
  return (sub, emit) => {
    const cursor = sub.params?.cursor ? Number(sub.params.cursor) : undefined;
    let active = true;

    (async () => {
      // Subscribe to live events FIRST so no frames escape during backfill.
      const liveIter = sequencer.live();
      let lastSeq = cursor ?? 0;

      // Backfill past frames.
      for await (const frame of sequencer.backfill(cursor)) {
        if (!active) return;
        lastSeq = frame.seq;
        emit(frame);
      }

      // Stream live frames, skipping those already emitted during backfill.
      for await (const frame of liveIter) {
        if (!active) return;
        if (frame.seq > lastSeq) {
          lastSeq = frame.seq;
          emit(frame);
        }
      }
    })();

    return () => { active = false; };
  };
}
