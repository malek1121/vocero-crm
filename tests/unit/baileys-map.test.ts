import { describe, expect, it } from "vitest";
import {
  ackToStatus,
  extractContent,
  extractHistoryMessage,
  jidToPhone,
  resolveMessagePhone,
  toJid,
} from "@/server/baileys/map";

describe("toJid / jidToPhone", () => {
  it("teléfono → jid de usuario", () => {
    expect(toJid("5215512345678")).toBe("5215512345678@s.whatsapp.net");
    expect(toJid("+52 55 1234 5678")).toBe("525512345678@s.whatsapp.net");
  });

  it("jid directo → teléfono (con y sin device suffix)", () => {
    expect(jidToPhone("5215512345678@s.whatsapp.net")).toBe("5215512345678");
    expect(jidToPhone("5215512345678:12@s.whatsapp.net")).toBe("5215512345678");
  });

  it("grupos, broadcast y desconocidos → null", () => {
    expect(jidToPhone("123456-987654@g.us")).toBeNull();
    expect(jidToPhone("status@broadcast")).toBeNull();
    expect(jidToPhone(null)).toBeNull();
    expect(jidToPhone(undefined)).toBeNull();
  });
});

describe("resolveMessagePhone", () => {
  it("uses the canonical phone JID when available", () => {
    expect(
      resolveMessagePhone({
        remoteJid: "5215512345678@s.whatsapp.net",
        remoteJidAlt: "5215599999999@s.whatsapp.net",
        fromMe: false,
      })
    ).toBe("5215512345678");
  });

  it("uses remoteJidAlt for a LID-addressed direct message", () => {
    expect(
      resolveMessagePhone({
        remoteJid: "123456789@lid",
        remoteJidAlt: "5215512345678:12@s.whatsapp.net",
        fromMe: false,
      })
    ).toBe("5215512345678");
  });

  it("rejects self, group, broadcast, and invalid alternate traffic", () => {
    const alternate = "5215512345678@s.whatsapp.net";
    expect(
      resolveMessagePhone({
        remoteJid: "123456789@lid",
        remoteJidAlt: alternate,
        fromMe: true,
      })
    ).toBeNull();
    expect(
      resolveMessagePhone({
        remoteJid: "123456-987654@g.us",
        remoteJidAlt: alternate,
        fromMe: false,
      })
    ).toBeNull();
    expect(
      resolveMessagePhone({
        remoteJid: "status@broadcast",
        remoteJidAlt: alternate,
        fromMe: false,
      })
    ).toBeNull();
    expect(
      resolveMessagePhone({
        remoteJid: "123456789@lid",
        remoteJidAlt: "not-a-phone@s.whatsapp.net",
        fromMe: false,
      })
    ).toBeNull();
  });
});
describe("extractHistoryMessage", () => {
  it("entrante histórico → dirección in con teléfono canónico", () => {
    expect(
      extractHistoryMessage({
        key: { remoteJid: "5215512345678@s.whatsapp.net", id: "AAA", fromMe: false },
        message: { conversation: "hola" },
        messageTimestamp: 1700000000,
      })
    ).toEqual({
      phone: "5215512345678",
      direction: "in",
      waMessageId: "AAA",
      type: "text",
      text: "hola",
      timestamp: "1700000000",
    });
  });

  it("saliente histórico (fromMe) → dirección out", () => {
    const r = extractHistoryMessage({
      key: { remoteJid: "5215512345678@s.whatsapp.net", id: "BBB", fromMe: true },
      message: { conversation: "respuesta" },
      messageTimestamp: { toNumber: () => 1700000100 },
    });
    expect(r?.direction).toBe("out");
    expect(r?.timestamp).toBe("1700000100");
  });

  it("LID sin jid alternativo se resuelve con el mapa phoneByLid", () => {
    const map = new Map([["111@lid", "5215512345678"]]);
    expect(
      extractHistoryMessage(
        {
          key: { remoteJid: "111@lid", id: "EEE", fromMe: false },
          message: { conversation: "hola" },
          messageTimestamp: 1,
        },
        map
      )?.phone
    ).toBe("5215512345678");
    // Sin mapa (o LID desconocido) → null.
    expect(
      extractHistoryMessage({
        key: { remoteJid: "999@lid", id: "FFF", fromMe: false },
        message: { conversation: "hola" },
        messageTimestamp: 1,
      })
    ).toBeNull();
  });

  it("LID con jid alternativo se resuelve; grupos/sin-id → null", () => {
    expect(
      extractHistoryMessage({
        key: {
          remoteJid: "111@lid",
          remoteJidAlt: "5215512345678@s.whatsapp.net",
          id: "CCC",
          fromMe: false,
        },
        message: { conversation: "x" },
        messageTimestamp: 1,
      })?.phone
    ).toBe("5215512345678");
    expect(
      extractHistoryMessage({
        key: { remoteJid: "123-456@g.us", id: "DDD" },
        message: { conversation: "x" },
        messageTimestamp: 1,
      })
    ).toBeNull();
    expect(
      extractHistoryMessage({
        key: { remoteJid: "5215512345678@s.whatsapp.net", fromMe: false },
        message: { conversation: "x" },
        messageTimestamp: 1,
      })
    ).toBeNull();
  });
});

describe("ackToStatus", () => {
  it("mapea server/delivery/read", () => {
    expect(ackToStatus(2)).toBe("sent");
    expect(ackToStatus(3)).toBe("delivered");
    expect(ackToStatus(4)).toBe("read");
  });

  it("otros acks → null (los ignora)", () => {
    expect(ackToStatus(0)).toBeNull();
    expect(ackToStatus(1)).toBeNull();
    expect(ackToStatus(5)).toBeNull();
    expect(ackToStatus(null)).toBeNull();
    expect(ackToStatus(undefined)).toBeNull();
  });
});

describe("extractContent", () => {
  it("texto plano y texto extendido", () => {
    expect(extractContent({ conversation: "hola" })).toEqual({
      type: "text",
      text: "hola",
    });
    expect(extractContent({ extendedTextMessage: { text: "hola" } })).toEqual({
      type: "text",
      text: "hola",
    });
  });

  it("media soportada con caption", () => {
    expect(extractContent({ imageMessage: { caption: "foto" } })).toEqual({
      type: "image",
      text: "foto",
    });
    expect(extractContent({ audioMessage: {} })).toEqual({
      type: "audio",
      text: null,
    });
  });

  it("sin contenido soportado → null", () => {
    expect(extractContent(null)).toBeNull();
    expect(extractContent({})).toBeNull();
    expect(extractContent({ reactionMessage: { text: "👍" } })).toBeNull();
  });
});
