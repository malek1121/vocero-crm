"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, MessageSquareText, Search } from "lucide-react";
import type { ContactDto } from "@/lib/types";
import { formatPhone } from "@/lib/utils";
import { apiRequest } from "@/lib/client-api";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ContactsClient() {
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (showArchived) params.set("archived", "true");
    try {
      const data = await apiRequest<{ contacts: ContactDto[] }>(
        `/api/contacts?${params}`,
        { cache: "no-store" },
        "No se pudieron cargar los contactos"
      );
      setContacts(data.contacts);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar los contactos");
    }
  }, [query, showArchived]);

  useEffect(() => {
    const t = setTimeout(() => void refetch(), 250);
    return () => clearTimeout(t);
  }, [refetch]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      await apiRequest(
        `/api/contacts/${id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        "No se pudo actualizar el contacto"
      );
      await refetch();
      setError(null);
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo actualizar el contacto");
      return false;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <h2 className="font-semibold">Contactos</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-primary"
            />
            Ver archivados
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Buscar contactos"
              placeholder="Buscar por nombre o teléfono…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-72 pl-8"
            />
          </div>
        </div>
      </header>

      {error && (
        <p className="border-b px-6 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {contacts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium">Sin contactos</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Cada persona que escriba a tu WhatsApp quedará registrada aquí
              automáticamente.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3"
              >
                <ContactAvatar name={c.name} seed={c.id} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.name}
                    </span>
                    {c.archivedAt && (
                      <Badge variant="secondary">Archivado</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatPhone(c.phone)}
                    {c.notes ? ` · ${c.notes.slice(0, 60)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(c)}
                  >
                    Editar
                  </Button>
                  <Link
                    href={`/inbox?contact=${c.id}`}
                    aria-label="Abrir conversaci?n"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={c.archivedAt ? "Desarchivar" : "Archivar"}
                    onClick={() => void patch(c.id, { archived: !c.archivedAt })}
                  >
                    {c.archivedAt ? (
                      <ArchiveRestore className="h-4 w-4" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <EditDialog
          contact={editing}
          onClose={() => setEditing(null)}
          onSave={(patchBody) => patch(editing.id, patchBody)}
        />
      )}
    </div>
  );
}

function EditDialog({
  contact,
  onClose,
  onSave,
}: {
  contact: ContactDto;
  onClose: () => void;
  onSave: (patch: { name: string; notes: string }) => Promise<boolean>;
}) {
  const [name, setName] = useState(contact.name);
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>("#edit-name")?.focus();
    return () => previousFocus?.focus();
  }, []);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    const saved = await onSave({ name: name.trim(), notes });
    setSaving(false);
    if (saved) onClose();
    else setSaveError("No se pudo guardar el contacto. Revis? el mensaje e intent? nuevamente.");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href]'
      ) ?? []
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-contact-title"
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 id="edit-contact-title" className="mb-4 font-semibold">Editar contacto</h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-name">
              Nombre
            </label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-notes">
              Notas
            </label>
            <Textarea
              id="edit-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        {saveError && <p className="mt-3 text-sm text-destructive" role="alert">{saveError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!name.trim() || saving}
            onClick={() => void save()}
          >
            {saving ? "Guardando?" : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
