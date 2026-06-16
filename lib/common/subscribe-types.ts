export interface Subscription {
  nsid: string;
  params?: Record<string, string>;
}

export type SubscribeHandler = (
  sub: Subscription,
  emit: (msg: unknown) => void,
) => (() => void) | void;
