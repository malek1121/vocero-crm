"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { MessageSquareText, Settings2, Trophy, XCircle } from "lucide-react";
import type { StageDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/client-api";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/components/inbox/helpers";
import { StageManager } from "./stage-manager";

export type BoardLead = {
  id: string;
  stageId: string;
  position: number;
  lastActivityAt: string | null;
  contact: { id: string; name: string; phone: string };
  conversationId: string | null;
};

export function PipelineClient() {
  const [stages, setStages] = useState<StageDto[]>([]);
  const [leads, setLeads] = useState<BoardLead[]>([]);
  const [activeLead, setActiveLead] = useState<BoardLead | null>(null);
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  const refetch = useCallback(async () => {
    try {
      const data = await apiRequest<{
        stages: StageDto[];
        leads: BoardLead[];
        truncated?: boolean;
      }>("/api/pipeline/board", undefined, "No se pudo cargar el pipeline");
      setStages(data.stages);
      setLeads(data.leads);
      setTruncated(Boolean(data.truncated));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo cargar el pipeline");
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function onDragStart(event: DragStartEvent) {
    const lead = leads.find((l) => l.id === event.active.id);
    setActiveLead(lead ?? null);
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    const leadId = String(event.active.id);
    const overStage = event.over ? String(event.over.id) : null;
    if (!overStage) return;
    const lead = leads.find((item) => item.id === leadId);
    if (!lead || lead.stageId === overStage) return;

    const position = leads.filter((item) => item.stageId === overStage).length;
    const previous = leads;
    setLeads((current) =>
      current.map((item) =>
        item.id === leadId ? { ...item, stageId: overStage, position } : item
      )
    );
    setError(null);
    try {
      await apiRequest(
        `/api/pipeline/leads/${leadId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stageId: overStage, position }),
        },
        "No se pudo mover la tarjeta"
      );
      await refetch();
    } catch (requestError) {
      setLeads(previous);
      setError(requestError instanceof Error ? requestError.message : "No se pudo mover la tarjeta");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <h2 className="font-semibold">Pipeline</h2>
        <Button variant="outline" size="sm" onClick={() => setManaging(true)}>
          <Settings2 className="h-4 w-4" /> Gestionar etapas
        </Button>
      </header>

      {(error || truncated) && (
        <p className="border-b px-6 py-2 text-sm text-destructive" role="alert">
          {error ?? "El tablero es muy grande: se muestran las primeras 1.000 tarjetas."}
        </p>
      )}

      <div className="flex-1 overflow-x-auto p-4">
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={(e) => void onDragEnd(e)}
        >
          <div className="flex h-full gap-3">
            {stages.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                leads={leads
                  .filter((l) => l.stageId === stage.id)
                  .sort((a, b) => a.position - b.position)}
              />
            ))}
          </div>
          <DragOverlay>
            {activeLead ? <LeadCard lead={activeLead} overlay /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {managing && (
        <StageManager
          stages={stages}
          onClose={() => setManaging(false)}
          onChanged={() => void refetch()}
        />
      )}
    </div>
  );
}

function StageColumn({ stage, leads }: { stage: StageDto; leads: BoardLead[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-64 shrink-0 flex-col rounded-lg border bg-card/50",
        isOver && "ring-2 ring-primary/60"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {stage.kind === "won" && <Trophy className="h-3.5 w-3.5 text-primary" />}
          {stage.kind === "lost" && (
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {stage.name}
        </span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {leads.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {leads.map((lead) => (
          <DraggableLead key={lead.id} lead={lead} />
        ))}
      </div>
    </div>
  );
}

function DraggableLead({ lead }: { lead: BoardLead }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(isDragging && "opacity-40")}
    >
      <LeadCard lead={lead} />
    </div>
  );
}

function LeadCard({ lead, overlay = false }: { lead: BoardLead; overlay?: boolean }) {
  return (
    <div
      className={cn(
        "cursor-grab rounded-md border bg-card p-3 shadow-sm",
        overlay && "rotate-2 shadow-xl"
      )}
    >
      <div className="flex items-center gap-2.5">
        <ContactAvatar name={lead.contact.name} seed={lead.contact.id} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lead.contact.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {lead.lastActivityAt
              ? `Actividad: ${formatTime(lead.lastActivityAt)}`
              : "Sin actividad"}
          </p>
        </div>
        {lead.conversationId && (
          <Link
            href={`/inbox?contact=${lead.contact.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Abrir conversación"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MessageSquareText className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
