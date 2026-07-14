import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 20);

const prefixes = {
  organization: "org",
  member: "mem",
  contact: "ct",
  conversation: "cv",
  message: "msg",
  agentDispatch: "dispatch",
  lead: "ld",
  stage: "stg",
  baileysAuth: "ba",
  agentProfile: "agp",
  kbEntry: "kb",
  testRun: "run",
  testCase: "case",
} as const;

export type IdKind = keyof typeof prefixes;

export function newId(kind: IdKind): string {
  return `${prefixes[kind]}_${nano()}`;
}
