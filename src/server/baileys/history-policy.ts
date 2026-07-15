import { proto } from "baileys";

type HistorySyncType = number | null | undefined;

const syncType = proto.HistorySync.HistorySyncType;

export function shouldSyncHistoryType(type: HistorySyncType): boolean {
  return (
    type == null ||
    type === syncType.FULL ||
    type === syncType.INITIAL_BOOTSTRAP ||
    type === syncType.RECENT ||
    type === syncType.ON_DEMAND
  );
}

export function isBootstrapHistoryType(type: HistorySyncType): boolean {
  return (
    type == null ||
    type === syncType.FULL ||
    type === syncType.INITIAL_BOOTSTRAP ||
    type === syncType.RECENT
  );
}
