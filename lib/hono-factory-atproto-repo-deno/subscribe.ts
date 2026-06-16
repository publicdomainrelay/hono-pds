import type { Sequencer } from "@publicdomainrelay/atproto-repo-abc";
import type { SubscribeHandler } from "@publicdomainrelay/common";

export function createSubscribeHandler(sequencer: Sequencer): SubscribeHandler {
  return (sub, emit) => {
    const cursor = sub.params?.cursor ? Number(sub.params.cursor) : undefined;
    let active = true;

    (async () => {
      for await (const frame of sequencer.backfill(cursor)) {
        if (!active) return;
        emit(frame);
      }
      for await (const frame of sequencer.live()) {
        if (!active) return;
        emit(frame);
      }
    })();

    return () => { active = false; };
  };
}
