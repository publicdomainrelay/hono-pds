import type { CommitEvent, Sequencer, SequencedFrame } from "@publicdomainrelay/atproto-repo-abc";
import { EventBus } from "@publicdomainrelay/common";

const MAX_BACKLOG = 10000;

function now(): string {
  return new Date().toISOString();
}

export class FirehoseSequencer implements Sequencer {
  #backlog: SequencedFrame[] = [];
  #seq = 0;
  #bus = new EventBus<SequencedFrame>();

  append(evt: CommitEvent): SequencedFrame {
    this.#seq++;
    const frame: SequencedFrame = {
      $type: "com.atproto.sync.subscribeRepos#commit",
      seq: this.#seq,
      repo: evt.repo,
      commit: { $link: evt.commit },
      rev: evt.rev,
      since: evt.since,
      blocks: evt.blocks,
      ops: evt.ops.map((op) => ({
        action: op.action,
        path: op.path,
        cid: op.cid ? { $link: op.cid } : null,
        prev: null,
      })),
      time: now(),
    };
    this.#backlog.push(frame);
    if (this.#backlog.length > MAX_BACKLOG) {
      this.#backlog.shift();
    }
    this.#bus.publish(frame);
    return frame;
  }

  async *backfill(since?: number): AsyncIterable<SequencedFrame> {
    const startSeq = since ?? 0;
    for (const frame of this.#backlog) {
      if ((frame.seq as number) > startSeq) {
        yield frame;
      }
    }
  }

  async *live(): AsyncIterable<SequencedFrame> {
    const queue: SequencedFrame[] = [];
    let resolve: ((frame: SequencedFrame) => void) | null = null;

    const dispose = this.#bus.subscribe((frame) => {
      if (resolve) {
        resolve(frame);
        resolve = null;
      } else {
        queue.push(frame);
      }
    });

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          yield await new Promise<SequencedFrame>((r) => { resolve = r; });
        }
      }
    } finally {
      dispose();
    }
  }
}
