export type ProcessableInboundMessage = {
  processedAt: Date | null;
};

export type InboundEffectSteps<TMessage extends ProcessableInboundMessage> = {
  insertOrLock(): Promise<TMessage>;
  updateConversation(message: TMessage): Promise<void>;
  updateLead(message: TMessage): Promise<void>;
  createDispatch(message: TMessage): Promise<void>;
  markProcessed(message: TMessage): Promise<TMessage>;
};

/** Runs only durable steps; the caller must wrap this in one DB transaction. */
export async function applyInboundEffects<
  TMessage extends ProcessableInboundMessage,
>(steps: InboundEffectSteps<TMessage>): Promise<{
  message: TMessage;
  applied: boolean;
}> {
  const message = await steps.insertOrLock();
  if (message.processedAt) return { message, applied: false };

  await steps.updateConversation(message);
  await steps.updateLead(message);
  await steps.createDispatch(message);
  const processed = await steps.markProcessed(message);
  return { message: processed, applied: true };
}