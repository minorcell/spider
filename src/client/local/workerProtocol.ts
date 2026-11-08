import type {
  LocalLoadOptions,
  LocalMessage,
  LocalOptions,
  LocalReply,
  LocalStatus,
} from '@/src/client/local/types';

export type LocalRequest =
  | { id: number; method: 'localSession'; args: [string, boolean] }
  | { id: number; method: 'localLoad'; args: [LocalLoadOptions?] }
  | { id: number; method: 'localStatus' | 'localUnload' }
  | {
      id: number;
      method: 'localComplete';
      args: [string, LocalMessage[], LocalOptions?];
      stream?: boolean;
    }
  | { id: number; method: 'localCancel'; args: [string] };

export type LocalControl =
  | { event: 'connect'; key: number; port: MessagePort }
  | { event: 'disconnect'; key: number };

export type LocalReplyMessage =
  | { event: 'localActivity'; busy: boolean }
  | { event: 'localDelta'; id: number; text: string }
  | { event: 'failure'; error: string }
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string; name?: string };

export interface LocalResultMap {
  localSession: void;
  localLoad: void;
  localStatus: LocalStatus;
  localUnload: void;
  localComplete: LocalReply;
  localCancel: void;
}
