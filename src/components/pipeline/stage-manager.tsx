"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { StageDto } from "@/lib/types";
import { apiRequest } from "@/lib/client-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function StageManager({
  stages,
  onClose,
  onChanged,
}: {
  stages: StageDto[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<StageDto | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  function showError(requestError: unknown, fallback: string) {
    setError(requestError instanceof Error ? requestError.message : fallback);
  }

  async function rename(stage: StageDto, name: string) {
    if (!name.trim() || name === stage.name) return;
    setError(null);
    try {
      await apiRequest(
        `/api/pipeline/stages/${stage.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        },
        "No se pudo renombrar la etapa"
      );
      onChanged();
    } catch (requestError) {
      showError(requestError, "No se pudo renombrar la etapa");
    }
  }

  async function move(stage: StageDto, direction: -1 | 1) {
    const sorted = [...stages].sort((a, b) => a.position - b.position);
    const index = sorted.findIndex((item) => item.id === stage.id);
    const swap = sorted[index + direction];
    if (!swap) return;
    setError(null);
    try {
      await apiRequest(
        "/api/pipeline/stages/reorder",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stageId: stage.id, swapWithId: swap.id }),
        },
        "No se pudo reordenar la etapa"
      );
      onChanged();
    } catch (requestError) {
      showError(requestError, "No se pudo reordenar la etapa");
    }
  }

  async function add() {
    if (!newName.trim()) return;
    setError(null);
    try {
      await apiRequest(
        "/api/pipeline/stages",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: newName.trim() }),
        },
        "No se pudo agregar la etapa"
      );
      setNewName("");
      onChanged();
    } catch (requestError) {
      showError(requestError, "No se pudo agregar la etapa");
    }
  }

  async function remove(stage: StageDto, moveToId: string | null) {
    setError(null);
    const url = moveToId
      ? `/api/pipeline/stages/${stage.id}?moveTo=${moveToId}`
      : `/api/pipeline/stages/${stage.id}`;
    try {
      const response = await fetch(url, { method: "DELETE" });
      const data = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      if (!response.ok) {
        if (data?.error?.code === "stage_has_leads") {
          setDeleting(stage);
          return;
        }
        throw new Error(data?.error?.message ?? "No se pudo eliminar la etapa");
      }
      setDeleting(null);
      setMoveTo("");
      onChanged();
    } catch (requestError) {
      showError(requestError, "No se pudo eliminar la etapa");
    }
  }

  const sorted = [...stages].sort((a, b) => a.position - b.position);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stage-manager-title"
        tabIndex={-1}
        className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="stage-manager-title" className="mb-4 font-semibold">Etapas del pipeline</h3>
        <ul className="space-y-2">
          {sorted.map((stage, index) => (
            <li key={stage.id} className="flex items-center gap-2">
              <Input
                defaultValue={stage.name}
                aria-label={`Nombre de la etapa ${stage.name}`}
                onBlur={(event) => void rename(stage, event.target.value)}
                className="flex-1"
              />
              {stage.kind !== "open" ? (
                <Badge variant={stage.kind === "won" ? "success" : "secondary"}>
                  {stage.kind === "won" ? "ganado" : "perdido"}
                </Badge>
              ) : (
                <Button variant="ghost" size="icon" aria-label={`Eliminar ${stage.name}`} onClick={() => void remove(stage, null)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" disabled={index === 0} aria-label={`Subir ${stage.name}`} onClick={() => void move(stage, -1)}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" disabled={index === sorted.length - 1} aria-label={`Bajar ${stage.name}`} onClick={() => void move(stage, 1)}>
                <ArrowDown className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>

        {deleting && (
          <div className="mt-4 rounded-md border border-[#ece2cf] bg-[#faf7f0] p-3">
            <p className="text-sm text-[#765719]">&quot;{deleting.name}&quot; tiene tarjetas. Elige a dónde moverlas:</p>
            <div className="mt-2 flex gap-2">
              <label htmlFor="stage-move-to" className="sr-only">Etapa destino</label>
              <select id="stage-move-to" value={moveTo} onChange={(event) => setMoveTo(event.target.value)} className="h-9 flex-1 rounded-md border border-input bg-card px-3 text-sm">
                <option value="">Etapa destino…</option>
                {sorted.filter((stage) => stage.id !== deleting.id).map((stage) => (
                  <option key={stage.id} value={stage.id}>{stage.name}</option>
                ))}
              </select>
              <Button variant="destructive" size="sm" disabled={!moveTo} onClick={() => void remove(deleting, moveTo)}>
                Mover y eliminar
              </Button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}

        <div className="mt-4 flex gap-2 border-t pt-4">
          <label htmlFor="new-stage-name" className="sr-only">Nueva etapa</label>
          <Input id="new-stage-name" placeholder="Nueva etapa…" value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void add(); }} />
          <Button onClick={() => void add()} disabled={!newName.trim()}>Agregar</Button>
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </div>
  );
}