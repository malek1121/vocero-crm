import { describe, expect, it } from "vitest";
import {
  addHistoryMessages,
  HISTORY_CHAT_LIMIT,
  HISTORY_MESSAGES_PER_CHAT,
  newHistoryBuffer,
  readHistoryMessages,
  type HistoryMessage,
} from "@/server/inbox/history";
import {
  INBOX_CONVERSATION_PAGE_SIZE,
  INBOX_MESSAGE_PAGE_SIZE,
} from "@/server/inbox/queries";

function message(phone: string, timestamp: number, id = `${phone}-${timestamp}`): HistoryMessage {
  return {
    phone,
    direction: "in",
    waMessageId: id,
    type: "text",
    text: id,
    timestamp: String(timestamp),
  };
}

describe("bounded WhatsApp history policy", () => {
  it("keeps only the 30 chats with the newest messages across chunks", () => {
    const buffer = newHistoryBuffer();
    const first = Array.from({ length: 30 }, (_, index) =>
      message(String(1000 + index), 1000 - index)
    );
    addHistoryMessages(buffer, first);

    addHistoryMessages(buffer, [
      message("older", 1),
      message("newer", 2000),
    ]);

    const phones = new Set(readHistoryMessages(buffer).map((item) => item.phone));
    expect(phones).toHaveLength(HISTORY_CHAT_LIMIT);
    expect(phones.has("newer")).toBe(true);
    expect(phones.has("older")).toBe(false);
    expect(phones.has("1029")).toBe(false);
  });

  it("deduplicates messages and caps each selected chat", () => {
    const buffer = newHistoryBuffer();
    const items = Array.from(
      { length: HISTORY_MESSAGES_PER_CHAT + 20 },
      (_, index) => message("51999999999", index + 1, `m-${index}`)
    );
    addHistoryMessages(buffer, [...items, items[0]!]);

    const stored = readHistoryMessages(buffer);
    expect(stored).toHaveLength(HISTORY_MESSAGES_PER_CHAT);
    expect(new Set(stored.map((item) => item.waMessageId))).toHaveLength(
      HISTORY_MESSAGES_PER_CHAT
    );
    expect(stored.at(-1)?.waMessageId).toBe(`m-${items.length - 1}`);
  });
});

describe("inbox page limits", () => {
  it("loads 30 conversations without shrinking message pages", () => {
    expect(INBOX_CONVERSATION_PAGE_SIZE).toBe(30);
    expect(INBOX_MESSAGE_PAGE_SIZE).toBe(100);
  });
});
