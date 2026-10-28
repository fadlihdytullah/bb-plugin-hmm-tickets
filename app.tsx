import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode, RefObject } from "react";
import {
  definePluginApp,
  Markdown,
  useBbContext,
  useBbNavigate,
  useComposer,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  Archive03Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ArrowUpDoubleIcon,
  BotIcon,
  Cancel01Icon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  CircleIcon,
  DashedLineCircleIcon,
  Delete02Icon,
  Download01Icon,
  DragDropVerticalIcon,
  Edit02Icon,
  FolderIcon,
  Loading03Icon,
  MoreHorizontalIcon,
  PlayListIcon,
  Search01Icon,
  SentIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import {
  isStale,
  plural,
  progressOf,
  splitDraft,
  STATUS_LABEL,
  STATUSES,
  THREAD_KIND_LABEL,
  type Status,
  type ThreadLink,
  type Ticket,
} from "@/lib/status";
import {
  ago,
  longDate,
  perDay,
  shortDate,
  summaryMarkdown,
  type DoneItem,
} from "@/lib/summary";
import { cn } from "@/lib/utils";

const TOGGLE_EVENT = "hmm-tickets:toggle";
const TICKETS_CHANGED = "tickets-changed";
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

let composeProjectId: string | null = null;
const composeListeners = new Set<() => void>();

function setComposeProject(next: string | null): void {
  if (composeProjectId === next) return;
  composeProjectId = next;
  for (const listener of composeListeners) listener();
}

function subscribeComposeProject(listener: () => void): () => void {
  composeListeners.add(listener);
  return () => composeListeners.delete(listener);
}

const STATUS_ICON: Record<Status, IconSvgElement> = {
  todo: CircleIcon,
  in_progress: DashedLineCircleIcon,
  done: CheckmarkCircle02Icon,
};

const STATUS_TONE: Record<Status, string> = {
  todo: "text-muted-foreground",
  in_progress: "text-amber-500",
  done: "text-emerald-500",
};

const MENU_CONTENT =
  "z-[110] min-w-[12rem] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg";
const MENU_ITEM =
  "flex h-7 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-xs outline-none data-[highlighted]:bg-state-hover";
const ICON_BUTTON =
  "size-7 rounded-md text-muted-foreground hover:text-foreground";
const SCROLLBAR =
  "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-track]:bg-transparent";

type View = { kind: "list" } | { kind: "form"; id: string | null };

type Menu = {
  tickets: Ticket[];
  x: number;
  y: number;
  only?: "status";
};

type SendTarget =
  | { kind: "new"; separate: boolean }
  | { kind: "thread"; threadId: string };

function Glyph({
  icon,
  className,
}: {
  icon: IconSvgElement;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      className={cn("size-3.5 shrink-0", className)}
      strokeWidth={1.8}
    />
  );
}

function useTickets(
  projectId: string | null,
  enabled: boolean,
  archived: boolean,
) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [tickets, setTickets] = useState<readonly Ticket[] | null>(null);

  const refresh = useCallback(async () => {
    if (projectId === null) return;
    try {
      const result = await rpc.call("list", { projectId, archived });
      setTickets(result.tickets);
    } catch (error) {
      setTickets([]);
      toast.error(
        error instanceof Error ? error.message : "Could not load tickets",
      );
    }
  }, [archived, projectId, rpc]);

  useEffect(() => {
    if (!enabled) return;
    setTickets(null);
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (enabled && connection === "connected") void refresh();
  }, [connection, enabled, refresh]);

  useRealtime(TICKETS_CHANGED, () => {
    if (enabled) void refresh();
  });

  return tickets;
}

function InlineTitleInput({
  value,
  label,
  className,
  onDone,
}: {
  value: string;
  label: string;
  className?: string;
  onDone: (title: string | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const finished = useRef(false);

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const title = draft.trim();
    onDone(save && title !== "" && title !== value ? title : null);
  };

  return (
    <input
      aria-label={label}
      autoFocus
      className={cn(
        "min-w-0 flex-1 rounded bg-transparent px-1 outline-none ring-1 ring-ring/40",
        className,
      )}
      data-inline-edit=""
      maxLength={200}
      onBlur={() => finish(true)}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      value={draft}
    />
  );
}

function ThreadBadge({ ticket }: { ticket: Ticket }) {
  const navigate = useBbNavigate();
  if (ticket.threadId === null) return null;
  const threadId = ticket.threadId;
  const working = ticket.working;
  return (
    <button
      aria-label={working ? "Agent working — open thread" : "Open agent thread"}
      className={cn(
        "flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium transition-colors",
        working
          ? "bg-amber-500/12 text-amber-600 dark:text-amber-400"
          : "text-muted-foreground/60 hover:bg-state-active hover:text-foreground",
      )}
      onClick={(event) => {
        event.stopPropagation();
        navigate.toThread(threadId);
      }}
      type="button"
    >
      <Glyph
        icon={working ? Loading03Icon : BotIcon}
        className={cn("size-3", working && "animate-spin")}
      />
      {working ? "Working" : null}
    </button>
  );
}

function useThreadLinks(ticketId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [links, setLinks] = useState<readonly ThreadLink[]>([]);

  const refresh = useCallback(async () => {
    if (ticketId === null) return;
    try {
      const result = await rpc.call("threads", { ticketId });
      setLinks(result.threads);
    } catch {
      setLinks([]);
    }
  }, [rpc, ticketId]);

  useEffect(() => {
    setLinks([]);
    void refresh();
  }, [refresh]);

  useRealtime(TICKETS_CHANGED, () => void refresh());

  return links;
}

function ThreadChip({
  links,
  onClose,
}: {
  links: readonly ThreadLink[];
  onClose: () => void;
}) {
  const navigate = useBbNavigate();
  const open = (threadId: string) => {
    onClose();
    navigate.toThread(threadId);
  };
  const live = links.filter((one) => !one.gone);
  if (live.length === 0) return null;
  const working = live.some((one) => one.working);
  const chip = (
    <Button
      aria-label={
        live.length === 1
          ? "Open linked thread"
          : `${live.length} linked threads`
      }
      className="h-7 gap-1 rounded-md px-2 text-xs text-muted-foreground"
      onClick={live.length === 1 ? () => open(live[0]!.threadId) : undefined}
      size="sm"
      variant="ghost"
    >
      <Glyph
        icon={working ? Loading03Icon : BotIcon}
        className={cn(
          "size-3.5",
          working && "animate-spin text-amber-600 dark:text-amber-400",
        )}
      />
      {live.length === 1 ? "Thread" : `${live.length} threads`}
    </Button>
  );
  if (live.length === 1) return chip;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{chip}</DropdownMenu.Trigger>
      <DropdownMenu.Content
        align="start"
        className={MENU_CONTENT}
        side="top"
        sideOffset={6}
      >
        {live.map((one) => (
          <DropdownMenu.Item
            className={MENU_ITEM}
            key={`${one.threadId}:${one.kind}`}
            onSelect={() => open(one.threadId)}
          >
            <Glyph icon={one.working ? Loading03Icon : BotIcon} />
            <span className="text-muted-foreground">
              {THREAD_KIND_LABEL[one.kind]}
            </span>
            <span className="max-w-[16rem] truncate">
              {one.title === "" ? one.threadId : one.title}
            </span>
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function TicketRow({
  ticket,
  progress,
  selected,
  soleSelected,
  editing,
  onEdit,
  onEditDone,
  onSelect,
  onOpen,
  onMenu,
  onStatusMenu,
}: {
  ticket: Ticket;
  progress: { done: number; total: number };
  selected: boolean;
  soleSelected: boolean;
  editing: boolean;
  onEdit: () => void;
  onEditDone: (title: string | null) => void;
  onSelect: (event: React.MouseEvent) => void;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
  onStatusMenu: (x: number, y: number) => void;
}) {
  const selectedAt = useRef(0);
  const editedAt = useRef(0);

  useEffect(() => {
    if (selected) selectedAt.current = Date.now();
  }, [selected]);

  useEffect(() => {
    if (editing) editedAt.current = Date.now();
  }, [editing]);

  return (
    <div
      aria-selected={selected}
      className={cn(
        "group mx-1.5 flex h-[30px] cursor-default select-none items-center gap-2 rounded-md pl-1 pr-1.5 transition-colors",
        selected ? "bg-accent" : "hover:bg-state-hover",
      )}
      data-ticket-id={ticket.id}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu(event.clientX, event.clientY);
      }}
      onDoubleClick={(event) => {
        if (editing && Date.now() - editedAt.current > 500) return;
        event.preventDefault();
        onOpen();
      }}
      role="option"
    >
      <button
        aria-label={`Status: ${STATUS_LABEL[ticket.status]}`}
        className="flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-state-active"
        onClick={(event) => {
          event.stopPropagation();
          const box = event.currentTarget.getBoundingClientRect();
          onStatusMenu(box.left, box.bottom + 4);
        }}
        type="button"
      >
        <Glyph
          icon={STATUS_ICON[ticket.status]}
          className={STATUS_TONE[ticket.status]}
        />
      </button>
      {editing ? (
        <InlineTitleInput
          className="text-[13px] leading-5"
          label="Ticket title"
          onDone={onEditDone}
          value={ticket.title}
        />
      ) : (
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] leading-5",
            ticket.status === "done" && "text-muted-foreground",
            soleSelected && "cursor-text",
          )}
          onClick={(event) => {
            const additive = event.metaKey || event.ctrlKey || event.shiftKey;
            if (!soleSelected || additive) return;
            if (Date.now() - selectedAt.current < 500) return;
            event.stopPropagation();
            onEdit();
          }}
        >
          {ticket.title}
        </span>
      )}
      {ticket.description.trim() === "" ? null : (
        <span
          aria-hidden="true"
          className="size-1 shrink-0 rounded-full bg-muted-foreground/30"
        />
      )}
      {progress.total === 0 ? null : (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
          <span aria-hidden="true">
            {progress.done}/{progress.total}
          </span>
          <span className="sr-only">
            {progress.done} of {plural(progress.total, "sub-task")} done
          </span>
        </span>
      )}
      {ticket.queuePos === null ? null : (
        <span className="shrink-0 rounded-full bg-accent px-1.5 text-[10px] tabular-nums text-muted-foreground">
          <span aria-hidden="true">#{ticket.queuePos + 1}</span>
          <span className="sr-only">Queue position {ticket.queuePos + 1}</span>
        </span>
      )}
      <ThreadBadge ticket={ticket} />
      <button
        aria-label="Ticket actions"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-state-active hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
          selected ? "opacity-60" : "opacity-0",
        )}
        onClick={(event) => {
          event.stopPropagation();
          const box = event.currentTarget.getBoundingClientRect();
          onMenu(box.left, box.bottom + 4);
        }}
        type="button"
      >
        <Glyph icon={MoreHorizontalIcon} />
      </button>
    </div>
  );
}

function GroupHeader({
  status,
  count,
  collapsed,
  onToggle,
}: {
  status: Status;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={!collapsed}
      className="sticky top-0 z-10 flex w-full items-center gap-1 bg-card/95 px-2 pb-1 pt-2.5 text-left backdrop-blur-sm"
      onClick={onToggle}
      type="button"
    >
      <Glyph
        icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon}
        className="size-3 text-muted-foreground/50"
      />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {STATUS_LABEL[status]}
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground/50">
        {count}
      </span>
    </button>
  );
}

function QuickAdd({
  onCreate,
  onClose,
}: {
  onCreate: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");

  const submit = async () => {
    const title = value.trim();
    if (title === "") {
      onClose();
      return;
    }
    setValue("");
    await onCreate(title);
  };

  return (
    <div className="mx-1.5 mt-1.5 flex h-[30px] items-center gap-2 rounded-md bg-state-hover pl-1 pr-1.5 ring-1 ring-inset ring-ring/40">
      <span className="flex size-6 shrink-0 items-center justify-center">
        <Glyph icon={Add01Icon} className="text-muted-foreground" />
      </span>
      <input
        autoFocus
        className="min-w-0 flex-1 bg-transparent text-[13px] leading-5 outline-none placeholder:text-muted-foreground/50"
        maxLength={200}
        onBlur={() => {
          if (value.trim() === "") onClose();
        }}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setValue("");
            onClose();
          }
        }}
        placeholder="Ticket title, then Enter"
        value={value}
      />
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2.5 px-3 pt-4">
      {[70, 45, 60, 35].map((width, index) => (
        <div className="flex items-center gap-2" key={index}>
          <span className="size-3.5 shrink-0 animate-pulse rounded-full bg-muted" />
          <span
            className="h-3 animate-pulse rounded bg-muted"
            style={{ width: `${width}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function queueable(ticket: Ticket): boolean {
  return ticket.parentId === null && ticket.status !== "done" && !ticket.archived;
}

function TicketMenu({
  menu,
  threadId,
  onClose,
  onOpen,
  onRename,
  onSend,
  onQueue,
  onQueueNext,
  onStatus,
  onArchive,
  onDelete,
}: {
  menu: Menu | null;
  threadId: string | null;
  onClose: () => void;
  onOpen: (ticket: Ticket) => void;
  onRename: (ticket: Ticket) => void;
  onSend: (tickets: Ticket[], target: SendTarget) => void;
  onQueue: (tickets: Ticket[], queued: boolean) => void;
  onQueueNext: (ticket: Ticket) => void;
  onStatus: (tickets: Ticket[], status: Status) => void;
  onArchive: (tickets: Ticket[], archived: boolean) => void;
  onDelete: (tickets: Ticket[]) => void;
}) {
  const tickets = menu?.tickets ?? [];
  const queueables = tickets.filter(queueable);
  const inQueue =
    queueables.length > 0 &&
    queueables.every((ticket) => ticket.queuePos !== null);
  const count = tickets.length;
  const many = count > 1;
  const suffix = many ? ` ${count} tickets` : "";
  const allArchived = count > 0 && tickets.every((ticket) => ticket.archived);
  const shared = STATUSES.find((status) =>
    tickets.every((ticket) => ticket.status === status),
  );
  const statusOnly = menu?.only === "status";
  const renaming = useRef(false);
  const single = count === 1 ? tickets[0] : undefined;

  const statusItems = STATUSES.map((status) => (
    <DropdownMenu.Item
      className={MENU_ITEM}
      key={status}
      onSelect={() => onStatus(tickets, status)}
    >
      <Glyph icon={STATUS_ICON[status]} className={STATUS_TONE[status]} />
      <span className="flex-1">{STATUS_LABEL[status]}</span>
      {shared === status ? (
        <Glyph icon={Tick02Icon} className="size-3 text-muted-foreground" />
      ) : null}
    </DropdownMenu.Item>
  ));

  return (
    <DropdownMenu.Root
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={menu !== null}
    >
      <DropdownMenu.Trigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-0"
          style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        align="start"
        className={MENU_CONTENT}
        onCloseAutoFocus={(event) => {
          if (!renaming.current) return;
          renaming.current = false;
          event.preventDefault();
        }}
        side="bottom"
        sideOffset={0}
      >
        {count === 0 ? null : statusOnly ? (
          statusItems
        ) : (
          <>
            {single === undefined ? null : (
              <>
                <DropdownMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => onOpen(single)}
                >
                  <Glyph icon={ArrowRight01Icon} />
                  Open
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => {
                    renaming.current = true;
                    onRename(single);
                  }}
                >
                  <Glyph icon={Edit02Icon} />
                  Rename
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
              </>
            )}
            {allArchived ? null : (
              <>
                <DropdownMenu.Item
                  className={MENU_ITEM}
                  onSelect={() =>
                    onSend(tickets, { kind: "new", separate: false })
                  }
                >
                  <Glyph icon={BotIcon} />
                  {many ? `Send ${count} to a new agent` : "Send to new agent"}
                </DropdownMenu.Item>
                {many ? (
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    onSelect={() =>
                      onSend(tickets, { kind: "new", separate: true })
                    }
                  >
                    <Glyph icon={BotIcon} />
                    Send to {count} new agents
                  </DropdownMenu.Item>
                ) : null}
                {threadId === null ? null : (
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    onSelect={() =>
                      onSend(tickets, { kind: "thread", threadId })
                    }
                  >
                    <Glyph icon={SentIcon} />
                    Send to this thread
                  </DropdownMenu.Item>
                )}
                {queueables.length === 0 ? null : (
                  <>
                    <DropdownMenu.Item
                      className={MENU_ITEM}
                      onSelect={() => onQueue(queueables, !inQueue)}
                    >
                      <Glyph icon={inQueue ? Cancel01Icon : Add01Icon} />
                      {inQueue ? "Remove from queue" : "Add to queue"}
                    </DropdownMenu.Item>
                    {single === undefined || single.queuePos === 0 ? null : (
                      <DropdownMenu.Item
                        className={MENU_ITEM}
                        onSelect={() => onQueueNext(single)}
                      >
                        <Glyph icon={ArrowUpDoubleIcon} />
                        Work on this next
                      </DropdownMenu.Item>
                    )}
                  </>
                )}
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Label className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  Status
                </DropdownMenu.Label>
                {statusItems}
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
              </>
            )}
            <DropdownMenu.Item
              className={MENU_ITEM}
              onSelect={() => onArchive(tickets, !allArchived)}
            >
              <Glyph icon={Archive03Icon} />
              {allArchived ? `Unarchive${suffix}` : `Archive${suffix}`}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={cn(MENU_ITEM, "text-destructive")}
              onSelect={() => onDelete(tickets)}
            >
              <Glyph icon={Delete02Icon} />
              Delete{suffix}
            </DropdownMenu.Item>
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function SelectionBar({
  tickets,
  onClear,
  onSend,
  onMenu,
}: {
  tickets: Ticket[];
  onClear: () => void;
  onSend: (tickets: Ticket[], target: SendTarget) => void;
  onMenu: (x: number, y: number) => void;
}) {
  const count = tickets.length;
  const sendable = tickets.filter((ticket) => !ticket.archived);
  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-t border-border bg-card px-2.5">
      <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
        {count} selected
      </span>
      <div className="flex-1" />
      {sendable.length === 0 ? null : (
        <Button
          className="h-7 rounded-md px-2.5 text-xs"
          onClick={() => onSend(sendable, { kind: "new", separate: false })}
          size="sm"
        >
          <Glyph icon={BotIcon} className="size-3.5" />
          {count > 1 ? "Send all" : "Send to agent"}
        </Button>
      )}
      <Button
        aria-label="More actions"
        className={ICON_BUTTON}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onMenu(box.left, box.top - 8);
        }}
        size="icon"
        variant="ghost"
      >
        <Glyph icon={MoreHorizontalIcon} />
      </Button>
      <Button
        aria-label="Clear selection"
        className={ICON_BUTTON}
        onClick={onClear}
        size="icon"
        variant="ghost"
      >
        <Glyph icon={Cancel01Icon} />
      </Button>
    </div>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  value: Status;
  onChange: (status: Status) => void;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex h-7 items-center gap-1.5 rounded-md bg-muted/50 pl-2 pr-1.5 text-[11px] font-medium transition-colors hover:bg-muted"
          type="button"
        >
          <Glyph icon={STATUS_ICON[value]} className={STATUS_TONE[value]} />
          {STATUS_LABEL[value]}
          <Glyph
            icon={ArrowDown01Icon}
            className="size-3 text-muted-foreground/60"
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        align="start"
        className={MENU_CONTENT}
        side="top"
        sideOffset={6}
      >
        {STATUSES.map((status) => (
          <DropdownMenu.Item
            className={MENU_ITEM}
            key={status}
            onSelect={() => onChange(status)}
          >
            <Glyph icon={STATUS_ICON[status]} className={STATUS_TONE[status]} />
            <span className="flex-1">{STATUS_LABEL[status]}</span>
            {value === status ? (
              <Glyph icon={Tick02Icon} className="size-3 text-muted-foreground" />
            ) : null}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function Reveal({
  animate,
  children,
}: {
  animate: boolean;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(!animate);

  useEffect(() => {
    if (shown) return;
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [shown]);

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        shown ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function ProgressSummary({
  done,
  total,
  onJump,
}: {
  done: number;
  total: number;
  onJump: () => void;
}) {
  const percent = Math.round((done / total) * 100);
  return (
    <div className="mt-2 flex items-center gap-2">
      <span
        aria-label="Sub-task progress"
        aria-valuemax={total}
        aria-valuemin={0}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${plural(total, "sub-task")} done`}
        className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
      >
        <span
          className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </span>
      <button
        className="rounded px-1 text-[11px] tabular-nums text-muted-foreground transition-colors hover:text-foreground"
        onClick={onJump}
        type="button"
      >
        {done} of {total} done
      </button>
    </div>
  );
}

type RowDrag = {
  dragging: boolean;
  edge: "before" | "after" | null;
  onDragStart: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onMove: (delta: number) => void;
};

function SubTaskMenuItems({
  item,
  onOpen,
  onRename,
  onStatus,
  onDelete,
}: {
  item: Ticket;
  onOpen: (item: Ticket) => void;
  onRename: () => void;
  onStatus: (item: Ticket, status: Status) => void;
  onDelete: (item: Ticket) => void;
}) {
  return (
    <>
      <DropdownMenu.Item className={MENU_ITEM} onSelect={() => onOpen(item)}>
        <Glyph icon={ArrowRight01Icon} />
        Open
      </DropdownMenu.Item>
      <DropdownMenu.Item className={MENU_ITEM} onSelect={onRename}>
        <Glyph icon={Edit02Icon} />
        Rename
      </DropdownMenu.Item>
      <DropdownMenu.Separator className="my-1 h-px bg-border" />
      {STATUSES.map((status) => (
        <DropdownMenu.Item
          className={MENU_ITEM}
          key={status}
          onSelect={() => onStatus(item, status)}
        >
          <Glyph icon={STATUS_ICON[status]} className={STATUS_TONE[status]} />
          <span className="flex-1">{STATUS_LABEL[status]}</span>
          {item.status === status ? (
            <Glyph icon={Tick02Icon} className="size-3 text-muted-foreground" />
          ) : null}
        </DropdownMenu.Item>
      ))}
      <DropdownMenu.Separator className="my-1 h-px bg-border" />
      <DropdownMenu.Item
        className={cn(MENU_ITEM, "text-destructive")}
        onSelect={() => onDelete(item)}
      >
        <Glyph icon={Delete02Icon} />
        Delete
      </DropdownMenu.Item>
    </>
  );
}

function SubTaskRow({
  item,
  drag,
  onOpen,
  onRename,
  onStatus,
  onDelete,
}: {
  item: Ticket;
  drag: RowDrag;
  onOpen: (item: Ticket) => void;
  onRename: (item: Ticket, title: string) => void;
  onStatus: (item: Ticket, status: Status) => void;
  onDelete: (item: Ticket) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(
    null,
  );
  const editedAt = useRef(0);
  const renaming = useRef(false);

  const startEdit = () => {
    editedAt.current = Date.now();
    setEditing(true);
  };

  const rename = () => {
    renaming.current = true;
    startEdit();
  };

  const keepFocus = (event: Event) => {
    if (!renaming.current) return;
    renaming.current = false;
    event.preventDefault();
  };

  return (
    <div
      className={cn(
        "group flex h-[30px] items-center gap-1 rounded-md border-y border-transparent pl-0.5 pr-1 transition-colors hover:bg-state-hover",
        drag.dragging && "opacity-40",
        drag.edge === "before" && "border-t-ring",
        drag.edge === "after" && "border-b-ring",
      )}
      draggable={!editing}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setPointer({ x: event.clientX, y: event.clientY });
      }}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-no-open]")) return;
        if (editing && Date.now() - editedAt.current > 500) return;
        event.preventDefault();
        onOpen(item);
      }}
      onDragEnd={drag.onDragEnd}
      onDragOver={drag.onDragOver}
      onDragStart={drag.onDragStart}
      onDrop={drag.onDrop}
    >
      <button
        aria-label={`Reorder ${item.title}. Use arrow up and down to move.`}
        className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/40 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing motion-reduce:transition-none"
        data-handle={item.id}
        data-no-open=""
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          event.stopPropagation();
          drag.onMove(event.key === "ArrowDown" ? 1 : -1);
        }}
        type="button"
      >
        <Glyph icon={DragDropVerticalIcon} className="size-3" />
      </button>
      <button
        aria-checked={
          item.status === "done"
            ? true
            : item.status === "in_progress"
              ? "mixed"
              : false
        }
        aria-label={item.title}
        className="flex size-6 shrink-0 items-center justify-center rounded transition-[background-color,transform] duration-150 ease-out hover:bg-state-active active:scale-90 motion-reduce:transition-none"
        data-no-open=""
        onClick={() =>
          onStatus(item, item.status === "done" ? "todo" : "done")
        }
        role="checkbox"
        type="button"
      >
        <Glyph
          icon={STATUS_ICON[item.status]}
          className={STATUS_TONE[item.status]}
        />
      </button>
      {editing ? (
        <InlineTitleInput
          className="text-[13px] leading-5"
          label="Sub-task title"
          onDone={(title) => {
            setEditing(false);
            if (title !== null) onRename(item, title);
          }}
          value={item.title}
        />
      ) : (
        <button
          className={cn(
            "min-w-0 flex-1 cursor-text truncate rounded px-1 text-left text-[13px] leading-5",
            item.status === "done" && "text-muted-foreground",
          )}
          onClick={startEdit}
          type="button"
        >
          {item.title}
        </button>
      )}
      <ThreadBadge ticket={item} />
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            aria-label={`Actions for ${item.title}`}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-state-active hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            data-no-open=""
            type="button"
          >
            <Glyph icon={MoreHorizontalIcon} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          align="end"
          className={MENU_CONTENT}
          onCloseAutoFocus={keepFocus}
          side="bottom"
          sideOffset={4}
        >
          <SubTaskMenuItems
            item={item}
            onDelete={onDelete}
            onOpen={onOpen}
            onRename={rename}
            onStatus={onStatus}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <DropdownMenu.Root
        modal={false}
        onOpenChange={(open) => {
          if (!open) setPointer(null);
        }}
        open={pointer !== null}
      >
        <DropdownMenu.Trigger asChild>
          <span
            aria-hidden="true"
            className="pointer-events-none fixed size-0"
            style={{ left: pointer?.x ?? 0, top: pointer?.y ?? 0 }}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          align="start"
          className={MENU_CONTENT}
          onCloseAutoFocus={keepFocus}
          side="bottom"
          sideOffset={0}
        >
          <SubTaskMenuItems
            item={item}
            onDelete={onDelete}
            onOpen={onOpen}
            onRename={rename}
            onStatus={onStatus}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}

function SubTasks({
  items,
  sectionRef,
  onAdd,
  onReorder,
  onOpen,
  onRename,
  onStatus,
  onDelete,
}: {
  items: Ticket[];
  sectionRef: RefObject<HTMLElement | null>;
  onAdd: (title: string) => Promise<void>;
  onReorder: (ids: string[]) => Promise<void>;
  onOpen: (item: Ticket) => void;
  onRename: (item: Ticket, title: string) => void;
  onStatus: (item: Ticket, status: Status) => void;
  onDelete: (item: Ticket) => void;
}) {
  const initial = useRef(new Set(items.map((item) => item.id)));
  const [value, setValue] = useState("");
  const [local, setLocal] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const [moved, setMoved] = useState("");
  const refocus = useRef<string | null>(null);
  const { done, total } = progressOf(items);

  const shown =
    local === null
      ? items
      : [...items].sort((a, b) => {
          const left = local.indexOf(a.id);
          const right = local.indexOf(b.id);
          return (left === -1 ? local.length : left) - (right === -1 ? local.length : right);
        });

  useEffect(() => {
    setLocal(null);
  }, [items]);

  useEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    sectionRef.current
      ?.querySelector<HTMLElement>(`[data-handle="${id}"]`)
      ?.focus();
  });

  const commit = (ids: string[]) => {
    setLocal(ids);
    onReorder(ids).catch(() => setLocal(null));
  };

  const place = (id: string, target: string, after: boolean) => {
    const rest = shown.map((one) => one.id).filter((one) => one !== id);
    const at = rest.indexOf(target) + (after ? 1 : 0);
    const next = [...rest.slice(0, at), id, ...rest.slice(at)];
    if (next.every((one, index) => one === shown[index]?.id)) return;
    commit(next);
  };

  const step = (id: string, delta: number) => {
    const ids = shown.map((one) => one.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    refocus.current = id;
    setMoved(
      `${shown[from]?.title ?? ""} moved to position ${to + 1} of ${ids.length}`,
    );
    window.setTimeout(() => setMoved(""), 1500);
    commit(ids);
  };

  const submit = async () => {
    const title = value.trim();
    if (title === "") return;
    setValue("");
    await onAdd(title);
  };

  return (
    <section
      aria-labelledby="subtasks-heading"
      className="mt-5 scroll-mt-2"
      ref={sectionRef}
    >
      <div className="mb-1 flex items-center gap-2 px-1">
        <h3
          className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          id="subtasks-heading"
        >
          Sub-tasks
        </h3>
        {total === 0 ? null : (
          <span
            aria-hidden="true"
            className="text-[10px] tabular-nums text-muted-foreground/50"
          >
            {done}/{total}
          </span>
        )}
      </div>
      {total === 0 ? (
        <p className="px-1 pb-1 text-[11px] text-muted-foreground/60">
          No sub-tasks yet
        </p>
      ) : (
        <ul className="-mx-1">
          {shown.map((item) => (
            <li key={item.id}>
              <Reveal animate={!initial.current.has(item.id)}>
                <SubTaskRow
                  drag={{
                    dragging: dragId === item.id,
                    edge:
                      over?.id === item.id && dragId !== item.id
                        ? over.after
                          ? "after"
                          : "before"
                        : null,
                    onDragStart: (event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.id);
                      setDragId(item.id);
                    },
                    onDragOver: (event) => {
                      if (dragId === null) return;
                      event.preventDefault();
                      const box = event.currentTarget.getBoundingClientRect();
                      const after = event.clientY > box.top + box.height / 2;
                      setOver((current) =>
                        current?.id === item.id && current.after === after
                          ? current
                          : { id: item.id, after },
                      );
                    },
                    onDrop: (event) => {
                      event.preventDefault();
                      if (dragId !== null && over !== null) {
                        place(dragId, over.id, over.after);
                      }
                      setDragId(null);
                      setOver(null);
                    },
                    onDragEnd: () => {
                      setDragId(null);
                      setOver(null);
                    },
                    onMove: (delta) => step(item.id, delta),
                  }}
                  item={item}
                  onDelete={onDelete}
                  onOpen={onOpen}
                  onRename={onRename}
                  onStatus={onStatus}
                />
              </Reveal>
            </li>
          ))}
        </ul>
      )}
      <div className="-mx-1 flex h-[30px] items-center gap-1.5 rounded-md pl-1 pr-1.5 focus-within:bg-state-hover">
        <span className="flex size-6 shrink-0 items-center justify-center">
          <Glyph icon={Add01Icon} className="text-muted-foreground" />
        </span>
        <input
          aria-label="Add a sub-task"
          className="min-w-0 flex-1 bg-transparent text-[13px] leading-5 outline-none placeholder:text-muted-foreground/50"
          maxLength={200}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              void submit();
            }
            if (event.key === "Escape" && value !== "") {
              event.preventDefault();
              event.stopPropagation();
              setValue("");
            }
          }}
          placeholder="Add a sub-task"
          value={value}
        />
      </div>
      <span aria-live="polite" className="sr-only">
        {moved !== ""
          ? moved
          : total === 0
            ? ""
            : `${done} of ${plural(total, "sub-task")} done`}
      </span>
    </section>
  );
}

function TicketForm({
  ticket,
  parent,
  subtasks,
  projectId,
  onBack,
  onClose,
  onOpenTicket,
  onSend,
  onArchive,
  onDelete,
}: {
  ticket: Ticket | null;
  parent: Ticket | null;
  subtasks: Ticket[];
  projectId: string;
  onBack: () => void;
  onClose: () => void;
  onOpenTicket: (id: string) => void;
  onSend: (ticket: Ticket) => void;
  onArchive: (ticket: Ticket) => void;
  onDelete: (ticket: Ticket) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const threadLinks = useThreadLinks(ticket?.id ?? null);
  const [editing, setEditing] = useState(ticket === null);
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [description, setDescription] = useState(ticket?.description ?? "");
  const subtasksRef = useRef<HTMLElement>(null);
  const [titleEditing, setTitleEditing] = useState(false);

  const run = async (task: () => Promise<unknown>) => {
    try {
      await task();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed");
    }
  };

  const save = () =>
    run(async () => {
      if (title.trim() === "") return;
      if (ticket === null) {
        await rpc.call("create", { projectId, title, description });
        onBack();
        return;
      }
      await rpc.call("update", { ids: [ticket.id], title, description });
      setEditing(false);
    });

  const addSubtask = (subtitle: string) =>
    run(async () => {
      if (ticket === null) return;
      await rpc.call("create", {
        projectId,
        parentId: ticket.id,
        title: subtitle,
      });
    });

  const reorderSubtasks = async (ids: string[]) => {
    if (ticket === null) return;
    try {
      await rpc.call("reorder", { parentId: ticket.id, ids });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed");
      throw error;
    }
  };

  const setSubtaskStatus = (item: Ticket, status: Status) =>
    run(async () => {
      await rpc.call("update", { ids: [item.id], status });
      if (
        ticket === null ||
        status !== "done" ||
        ticket.status === "done" ||
        !subtasks.every((one) => one.id === item.id || one.status === "done")
      ) {
        return;
      }
      toast("All sub-tasks done", {
        action: {
          label: "Mark done",
          onClick: () =>
            void run(() =>
              rpc.call("update", { ids: [ticket.id], status: "done" }),
            ),
        },
      });
    });

  const jumpToSubtasks = () => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    subtasksRef.current?.scrollIntoView({
      behavior: reduced.matches ? "auto" : "smooth",
      block: "start",
    });
  };

  const cancel = () => {
    if (ticket === null) {
      onBack();
      return;
    }
    setTitle(ticket.title);
    setDescription(ticket.description);
    setEditing(false);
  };

  const dirty =
    ticket === null
      ? title.trim() !== "" || description.trim() !== ""
      : title !== ticket.title || description !== ticket.description;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        event.stopPropagation();
        const mod = IS_MAC ? event.metaKey : event.ctrlKey;
        if (editing && mod && event.key === "Enter") {
          event.preventDefault();
          void save();
          return;
        }
        if (event.key === "Escape") {
          if (document.querySelector('[role="menu"]') !== null) return;
          event.preventDefault();
          if (editing) cancel();
          else onBack();
        }
      }}
    >
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3",
          SCROLLBAR,
        )}
      >
        {parent === null ? null : (
          <button
            className="-ml-1 mb-1 flex max-w-full items-center gap-1 rounded px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => onOpenTicket(parent.id)}
            type="button"
          >
            <Glyph icon={ArrowLeft01Icon} className="size-3" />
            <span className="truncate">{parent.title}</span>
          </button>
        )}
        {editing ? (
          <>
            <input
              autoFocus
              className="w-full bg-transparent text-[15px] font-semibold leading-6 tracking-tight outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
              maxLength={200}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="Ticket title"
              value={title}
            />
            <textarea
              className="mt-2.5 min-h-[10rem] w-full flex-1 resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
              onChange={(event) => setDescription(event.currentTarget.value)}
              placeholder="Add description… Markdown works."
              value={description}
            />
          </>
        ) : (
          <>
            {titleEditing ? (
              <InlineTitleInput
                className="w-full text-[15px] font-semibold leading-6 tracking-tight"
                label="Ticket title"
                onDone={(next) => {
                  setTitleEditing(false);
                  if (next === null || ticket === null) return;
                  setTitle(next);
                  void run(() =>
                    rpc.call("update", { ids: [ticket.id], title: next }),
                  );
                }}
                value={title}
              />
            ) : (
              <h2 className="text-[15px] font-semibold leading-6 tracking-tight">
                <button
                  className="w-full cursor-text rounded text-left"
                  onClick={() => setTitleEditing(true)}
                  type="button"
                >
                  {title}
                </button>
              </h2>
            )}
            {subtasks.length === 0 ? null : (
              <ProgressSummary
                done={progressOf(subtasks).done}
                onJump={jumpToSubtasks}
                total={subtasks.length}
              />
            )}
            {description.trim() === "" ? (
              <p className="mt-2.5 text-[13px] text-muted-foreground/50">
                No description
              </p>
            ) : (
              <Markdown
                className="mt-2.5 text-[13px] leading-relaxed"
                content={description}
              />
            )}
            {ticket === null || ticket.parentId !== null ? null : (
              <SubTasks
                items={subtasks}
                onAdd={addSubtask}
                onDelete={onDelete}
                onOpen={(item) => onOpenTicket(item.id)}
                onRename={(item, name) =>
                  void run(() => rpc.call("update", { ids: [item.id], title: name }))
                }
                onReorder={reorderSubtasks}
                onStatus={(item, status) => void setSubtaskStatus(item, status)}
                sectionRef={subtasksRef}
              />
            )}
          </>
        )}
      </div>

      <div className="flex h-12 shrink-0 items-center gap-1.5 border-t border-border px-3">
        {editing ? (
          <>
            <div className="flex-1" />
            <Button
              className="h-7 rounded-md px-2.5 text-xs"
              onClick={cancel}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              aria-keyshortcuts="Meta+Enter Control+Enter"
              className="h-7 rounded-md px-3 text-xs"
              disabled={title.trim() === "" || !dirty}
              onClick={() => void save()}
              size="sm"
            >
              {ticket === null ? "Create" : "Save"}
            </Button>
          </>
        ) : ticket === null ? null : (
          <>
            <StatusSelect
              onChange={(status) =>
                void run(() => rpc.call("update", { ids: [ticket.id], status }))
              }
              value={ticket.status}
            />
            <ThreadChip links={threadLinks} onClose={onClose} />
            <div className="flex-1" />
            <Button
              className="h-7 rounded-md px-2 text-xs"
              onClick={() => onSend(ticket)}
              size="sm"
              variant="ghost"
            >
              <Glyph icon={BotIcon} className="size-3.5" />
              Send
            </Button>
            <Button
              className="h-7 rounded-md px-2.5 text-xs"
              onClick={() => setEditing(true)}
              size="sm"
              variant="secondary"
            >
              <Glyph icon={Edit02Icon} className="size-3.5" />
              Edit
            </Button>
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <Button
                  aria-label="More actions"
                  className={ICON_BUTTON}
                  size="icon"
                  variant="ghost"
                >
                  <Glyph icon={MoreHorizontalIcon} />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content
                align="end"
                className={MENU_CONTENT}
                side="top"
                sideOffset={6}
              >
                {ticket.parentId !== null ? null : (
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    onSelect={() => onArchive(ticket)}
                  >
                    <Glyph icon={Archive03Icon} />
                    {ticket.archived ? "Unarchive" : "Archive"}
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item
                  className={cn(MENU_ITEM, "text-destructive")}
                  onSelect={() => onDelete(ticket)}
                >
                  <Glyph icon={Delete02Icon} />
                  Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  archived,
  searching,
}: {
  archived: boolean;
  searching: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <Glyph
        icon={
          searching ? Search01Icon : archived ? Archive03Icon : CheckListIcon
        }
        className="size-5 text-muted-foreground/40"
      />
      <p className="text-xs text-muted-foreground">
        {searching
          ? "No match"
          : archived
            ? "Nothing archived"
            : "No tickets yet"}
      </p>
      {searching || archived ? null : (
        <p className="text-[11px] leading-relaxed text-muted-foreground/60">
          Press <span className="text-muted-foreground">N</span> or the plus
          above, or turn a composer draft into a ticket.
        </p>
      )}
    </div>
  );
}

function NotesPrompt({
  tickets,
  notes,
  onChange,
  onCancel,
  onConfirm,
}: {
  tickets: Ticket[];
  notes: string;
  onChange: (next: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[60] flex flex-col justify-end bg-background/70 backdrop-blur-[2px]">
      <div
        className="flex flex-col gap-2 border-t border-border bg-card p-3 shadow-2xl"
        onKeyDown={(event) => {
          event.stopPropagation();
          const mod = IS_MAC ? event.metaKey : event.ctrlKey;
          if (mod && event.key === "Enter") {
            event.preventDefault();
            onConfirm();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <p className="text-[11px] text-muted-foreground">
          Notes for{" "}
          <span className="text-foreground">
            {tickets.length === 1
              ? (tickets[0]?.title ?? "")
              : `${tickets.length} tickets`}
          </span>
        </p>
        <textarea
          autoFocus
          className="h-24 w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring"
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="Anything the agent should know…"
          value={notes}
        />
        <div className="flex items-center justify-end gap-1.5">
          <Button
            className="h-7 rounded-md px-2.5 text-xs"
            onClick={onCancel}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            aria-keyshortcuts="Meta+Enter Control+Enter"
            className="h-7 rounded-md px-3 text-xs"
            onClick={onConfirm}
            size="sm"
          >
            <Glyph icon={BotIcon} className="size-3.5" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function Dialog({
  label,
  focusKey,
  onClose,
  onEscape,
  children,
}: {
  label: string;
  focusKey: string;
  onClose: () => void;
  onEscape: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => setShown(true));
    const timer = window.setTimeout(() => setSettled(true), 260);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel !== null && !panel.contains(document.activeElement)) {
      panel.focus();
    }
  }, [focusKey]);

  const trap = (event: React.KeyboardEvent) => {
    const panel = panelRef.current;
    if (event.key !== "Tab" || panel === null) return;
    const nodes = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = nodes[0];
    const last = nodes.at(-1);
    const active = document.activeElement;
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-[2px] transition-opacity duration-150 ease-out motion-reduce:transition-none",
        shown ? "opacity-100" : "opacity-0",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-label={label}
        aria-modal="true"
        className={cn(
          "relative flex h-[min(44rem,calc(100vh-4rem))] w-[min(40rem,100%)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl outline-none transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          settled
            ? ""
            : shown
              ? "scale-100 opacity-100"
              : "scale-[0.97] opacity-0",
        )}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          if (document.querySelector('[role="menu"]') !== null) return;
          event.preventDefault();
          onEscape();
        }}
        onKeyDownCapture={trap}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

function TicketsWindow() {
  const routeProjectId = useBbContext().projectId;
  const composedProjectId = useSyncExternalStore(
    subscribeComposeProject,
    () => composeProjectId,
  );
  const resolvedProjectId = routeProjectId ?? composedProjectId;
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);
  const projectId = resolvedProjectId ?? lastProjectId;
  const [open, setOpen] = useState(false);
  const [home, setHome] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedTicket, setPickedTicket] = useState<string | null>(null);
  const [tab, setTab] = useState<HomeTab | null>(null);

  useEffect(() => {
    if (resolvedProjectId === null) return;
    setLastProjectId(resolvedProjectId);
    setPicked(null);
    setPickedTicket(null);
    setHome(false);
  }, [resolvedProjectId]);

  const toggle = useCallback(() => {
    setOpen((current) => !current);
    setPicked(null);
    setPickedTicket(null);
    setTab(null);
    setHome(projectId === null);
  }, [projectId]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    window.addEventListener(TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(TOGGLE_EVENT, toggle);
  }, [toggle]);

  if (!open) return null;
  return (
    <TicketsContent
      home={home || (picked ?? projectId) === null}
      onClose={close}
      onHome={(next) => {
        setTab(next ?? null);
        setPickedTicket(null);
        setHome(true);
      }}
      onPick={(id, ticketId) => {
        setPicked(id);
        setPickedTicket(ticketId ?? null);
        setHome(false);
      }}
      onTab={setTab}
      projectId={picked ?? projectId}
      tab={tab}
      ticketId={pickedTicket}
    />
  );
}

function TicketsContent({
  home,
  projectId,
  tab,
  onClose,
  onHome,
  onPick,
  onTab,
  ticketId,
}: {
  home: boolean;
  projectId: string | null;
  tab: HomeTab | null;
  ticketId: string | null;
  onClose: () => void;
  onHome: (tab?: HomeTab) => void;
  onPick: (id: string, ticketId?: string) => void;
  onTab: (tab: HomeTab) => void;
}) {
  const projects = useProjects();
  const queue = useQueue();
  if (home || projectId === null) {
    const current: HomeTab | null =
      tab ?? (queue === null ? null : queue.length > 0 ? "queue" : "overview");
    const tabs: { id: HomeTab; label: string }[] = [
      { id: "queue", label: "Queue" },
      { id: "overview", label: "Overview" },
    ];
    return (
      <Dialog focusKey="home" label="Tickets" onClose={onClose} onEscape={onClose}>
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pl-4 pr-1.5">
          <span className="flex-1 truncate text-xs font-semibold tracking-tight">
            Tickets
          </span>
          <Button
            aria-label="Close tickets"
            className={ICON_BUTTON}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <Glyph icon={Cancel01Icon} />
          </Button>
        </div>
        <div
          aria-label="Tickets home"
          className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-3"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const other = current === "queue" ? "overview" : "queue";
            onTab(other);
            document.getElementById(`home-tab-${other}`)?.focus();
          }}
          role="tablist"
        >
          {tabs.map((item) => (
            <button
              aria-controls="home-panel"
              aria-selected={current === item.id}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded-md px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                current === item.id
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              id={`home-tab-${item.id}`}
              key={item.id}
              onClick={() => onTab(item.id)}
              role="tab"
              tabIndex={current === item.id ? 0 : -1}
              type="button"
            >
              {item.label}
              {item.id === "queue" && queue !== null && queue.length > 0 ? (
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {queue.length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div
          aria-labelledby={current === null ? undefined : `home-tab-${current}`}
          className={cn("min-h-0 flex-1 overflow-y-auto p-4", SCROLLBAR)}
          id="home-panel"
          role="tabpanel"
        >
          {current === null ? (
            <SkeletonList />
          ) : current === "queue" ? (
            <QueueView
              onClose={onClose}
              onOpenTicket={(ticket) => onPick(ticket.projectId, ticket.id)}
              projects={projects}
              tickets={queue ?? []}
            />
          ) : (
            <div className="space-y-6">
              <StatsPanel projects={projects} />
              <ProjectList onOpen={(id) => onPick(id)} projects={projects} />
            </div>
          )}
        </div>
      </Dialog>
    );
  }
  return (
    <TicketsBoard
      key={projectId}
      initialTicketId={ticketId}
      onClose={onClose}
      onHome={onHome}
      projectId={projectId}
      queueCount={queue?.length ?? 0}
      title={projects?.find((one) => one.id === projectId)?.name ?? "Tickets"}
    />
  );
}

type ShellProps = {
  label: string;
  focusKey: string;
  onClose: () => void;
  onEscape: () => void;
  children: ReactNode;
};

function TicketsBoard({
  projectId,
  initialTicketId = null,
  onClose,
  onHome,
  queueCount,
  title,
}: {
  projectId: string;
  initialTicketId?: string | null;
  onClose: () => void;
  onHome: (tab?: HomeTab) => void;
  queueCount: number;
  title: string;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const bbContext = useBbContext();
  const routeThreadId = bbContext.threadId;
  const routeProjectId = bbContext.projectId;
  const Shell = Dialog;
  const close = onClose;
  const [showArchived, setShowArchived] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState<View>(
    initialTicketId === null
      ? { kind: "list" }
      : { kind: "form", id: initialTicketId },
  );
  const [menu, setMenu] = useState<Menu | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [anchor, setAnchor] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<Status>>(
    () => new Set<Status>(["done"]),
  );
  const [query, setQuery] = useState("");
  const [quickAdd, setQuickAdd] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [worktree, setWorktree] = useState(false);
  const [askNotes, setAskNotes] = useState(false);
  const [pending, setPending] = useState<{
    list: Ticket[];
    target: SendTarget;
  } | null>(null);
  const [notes, setNotes] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loaded = useTickets(projectId, true, showArchived);
  const tickets = loaded ?? [];
  useEffect(() => {
    if (
      loaded !== null &&
      view.kind === "form" &&
      view.id !== null &&
      !loaded.some((ticket) => ticket.id === view.id)
    ) {
      setView({ kind: "list" });
    }
  }, [loaded, view]);
  const kids = new Map<string, Ticket[]>();
  for (const ticket of tickets) {
    if (ticket.parentId === null) continue;
    kids.set(ticket.parentId, [...(kids.get(ticket.parentId) ?? []), ticket]);
  }
  const needle = query.trim().toLowerCase();
  const hit = (ticket: Ticket) =>
    ticket.title.toLowerCase().includes(needle) ||
    ticket.description.toLowerCase().includes(needle);
  const now = Date.now();
  const topLevel = tickets.filter(
    (ticket) =>
      ticket.parentId === null &&
      (showAll || showArchived || !isStale(ticket, now)),
  );
  const matching =
    needle === ""
      ? topLevel
      : topLevel.filter(
          (ticket) => hit(ticket) || (kids.get(ticket.id) ?? []).some(hit),
        );

  const groups = STATUSES.map((status) => ({
    status,
    items: matching.filter((ticket) => ticket.status === status),
  })).filter((group) => group.items.length > 0);

  const ordered = showArchived
    ? [...matching]
    : groups.flatMap((group) =>
        collapsed.has(group.status) ? [] : group.items,
      );
  const selectedTickets = ordered.filter((ticket) => selected.has(ticket.id));
  const isForm = view.kind === "form";

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  useEffect(() => {
    clearSelection();
  }, [clearSelection, showArchived]);

  useEffect(() => {
    rpc.call("configGet", { projectId }).then(
      (config) => {
        setWorktree(config.worktree);
        setAskNotes(config.notes);
      },
      () => undefined,
    );
  }, [projectId, rpc]);

  const moveSelection = useCallback(
    (delta: number, extend: boolean) => {
      if (ordered.length === 0) return;
      const currentId = anchor ?? selectedTickets.at(-1)?.id ?? null;
      const from = ordered.findIndex((ticket) => ticket.id === currentId);
      const index = from === -1 ? 0 : Math.min(
        Math.max(from + delta, 0),
        ordered.length - 1,
      );
      const next = ordered[index];
      if (next === undefined) return;
      if (extend && anchor !== null) {
        const start = ordered.findIndex((ticket) => ticket.id === anchor);
        const range = ordered.slice(
          Math.min(start, index),
          Math.max(start, index) + 1,
        );
        setSelected(new Set(range.map((ticket) => ticket.id)));
      } else {
        setSelected(new Set([next.id]));
        setAnchor(next.id);
      }
      listRef.current
        ?.querySelector(`[data-ticket-id="${next.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    },
    [anchor, ordered, selectedTickets],
  );

  useEffect(() => {
    if (isForm) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      const mod = IS_MAC ? event.metaKey : event.ctrlKey;

      if (event.key === "Escape") {
        if (target?.closest("[data-inline-edit]")) return;
        if (query !== "") {
          event.preventDefault();
          event.stopPropagation();
          setQuery("");
          return;
        }
        if (selected.size > 0) {
          event.preventDefault();
          event.stopPropagation();
          clearSelection();
          return;
        }
        if (
          pending !== null ||
          quickAdd ||
          menu !== null ||
          document.querySelector('[role="menu"]') !== null
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (showArchived) setShowArchived(false);
        else if (showAll) setShowAll(false);
        else close();
        return;
      }
      if (typing) return;

      if (mod && !event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelected(new Set(ordered.map((ticket) => ticket.id)));
        setAnchor(ordered[0]?.id ?? null);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
        return;
      }
      if (event.key === "Enter" && selectedTickets.length === 1) {
        event.preventDefault();
        setView({ kind: "form", id: selectedTickets[0]?.id ?? null });
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key.toLowerCase() === "q" && !mod) {
        const list = selectedTickets.filter(queueable);
        if (list.length === 0) return;
        event.preventDefault();
        void queueTickets(
          list,
          !list.every((ticket) => ticket.queuePos !== null),
        );
        return;
      }
      if (event.key.toLowerCase() === "n" && !mod && !showArchived) {
        event.preventDefault();
        setQuickAdd(true);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    clearSelection,
    close,
    isForm,
    menu,
    moveSelection,
    ordered,
    pending,
    query,
    quickAdd,
    selected.size,
    selectedTickets,
    showArchived,
  ]);

  const selectRow = (ticket: Ticket, event: React.MouseEvent) => {
    const additive = IS_MAC ? event.metaKey : event.ctrlKey;
    if (event.shiftKey && anchor !== null) {
      const from = ordered.findIndex((one) => one.id === anchor);
      const to = ordered.findIndex((one) => one.id === ticket.id);
      if (from !== -1 && to !== -1) {
        const range = ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
        setSelected((current) => {
          const next = additive ? new Set(current) : new Set<string>();
          for (const one of range) next.add(one.id);
          return next;
        });
        return;
      }
    }
    if (additive) {
      setSelected((current) => {
        const next = new Set(current);
        if (!next.delete(ticket.id)) next.add(ticket.id);
        return next;
      });
      setAnchor(ticket.id);
      return;
    }
    setSelected(new Set([ticket.id]));
    setAnchor(ticket.id);
  };

  const openMenuFor = (
    ticket: Ticket,
    x: number,
    y: number,
    only?: "status",
  ) => {
    if (selected.has(ticket.id) && selected.size > 1) {
      setMenu({ tickets: selectedTickets, x, y, only });
      return;
    }
    setSelected(new Set([ticket.id]));
    setAnchor(ticket.id);
    setMenu({ tickets: [ticket], x, y, only });
  };

  const act = async (task: () => Promise<unknown>) => {
    try {
      await task();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed");
    }
  };

  const idsOf = (list: Ticket[]) => list.map((ticket) => ticket.id);

  const dispatch = (list: Ticket[], target: SendTarget, note: string) =>
    act(async () => {
      const { threadIds } = await rpc.call("send", {
        ids: idsOf(list),
        separate: target.kind === "new" && target.separate,
        ...(target.kind === "thread" ? { threadId: target.threadId } : {}),
        ...(note.trim() === "" ? {} : { notes: note }),
      });
      setView({ kind: "list" });
      clearSelection();
      toast.success(
        target.kind === "thread"
          ? "Sent to this thread"
          : threadIds.length === 1
            ? "Sent to agent"
            : `Sent to ${threadIds.length} agents`,
      );
      const opened = threadIds[0];
      if (target.kind === "new" && threadIds.length === 1 && opened) {
        navigate.toThread(opened);
      }
    });

  const send = (list: Ticket[], target: SendTarget) => {
    if (!askNotes) return dispatch(list, target, "");
    setNotes("");
    setPending({ list, target });
    return Promise.resolve();
  };
  const queueTickets = (list: Ticket[], queued: boolean) =>
    act(async () => {
      const ids = idsOf(list);
      await rpc.call("queueSet", { ids, queued });
      if (queued) {
        toast.success("Added to queue");
        return;
      }
      toast("Removed from queue", {
        action: {
          label: "Undo",
          onClick: () =>
            void rpc
              .call("queueSet", { ids, queued: true })
              .catch(() => undefined),
        },
      });
    });
  const queueNext = (ticket: Ticket) =>
    act(async () => {
      await rpc.call("queueSet", { ids: [ticket.id], queued: true });
      await rpc.call("queueMove", { id: ticket.id, to: "top" });
      toast.success("Next in queue");
    });
  const setStatus = (list: Ticket[], status: Status) =>
    act(() => rpc.call("update", { ids: idsOf(list), status }));
  const archive = (list: Ticket[], archived: boolean) =>
    act(async () => {
      await rpc.call("update", { ids: idsOf(list), archived });
      setView({ kind: "list" });
      clearSelection();
    });
  const remove = (list: Ticket[]) => {
    const subs = list.reduce(
      (sum, one) => sum + (kids.get(one.id)?.length ?? 0),
      0,
    );
    const base =
      list.length === 1
        ? `"${list[0]?.title ?? ""}"`
        : `${list.length} tickets`;
    const label =
      subs === 0
        ? base
        : `${base} and ${list.length === 1 ? "its" : "their"} ${plural(subs, "sub-task")}`;
    if (!window.confirm(`Delete ${label}?`)) return;
    const parentId = list.length === 1 ? (list[0]?.parentId ?? null) : null;
    void act(async () => {
      await rpc.call("remove", { ids: idsOf(list) });
      setView(
        parentId === null ? { kind: "list" } : { kind: "form", id: parentId },
      );
      clearSelection();
    });
  };
  const renameTicket = (ticket: Ticket, title: string) =>
    act(() => rpc.call("update", { ids: [ticket.id], title }));
  const create = async (title: string) => {
    await act(() => rpc.call("create", { projectId, title, description: "" }));
  };

  const editing =
    view.kind === "form"
      ? (tickets.find((ticket) => ticket.id === view.id) ?? null)
      : null;
  const parent =
    editing === null || editing.parentId === null
      ? null
      : (tickets.find((ticket) => ticket.id === editing.parentId) ?? null);
  const backView: View =
    parent === null ? { kind: "list" } : { kind: "form", id: parent.id };

  const rowsFor = (items: Ticket[]) =>
    items.map((ticket) => (
      <TicketRow
        key={ticket.id}
        editing={renamingId === ticket.id}
        onEdit={() => setRenamingId(ticket.id)}
        onEditDone={(title) => {
          setRenamingId(null);
          if (title !== null) void renameTicket(ticket, title);
        }}
        onMenu={(x, y) => openMenuFor(ticket, x, y)}
        onOpen={() => setView({ kind: "form", id: ticket.id })}
        onSelect={(event) => selectRow(ticket, event)}
        onStatusMenu={(x, y) => openMenuFor(ticket, x, y, "status")}
        progress={progressOf(kids.get(ticket.id) ?? [])}
        selected={selected.has(ticket.id)}
        soleSelected={selected.size === 1 && selected.has(ticket.id)}
        ticket={ticket}
      />
    ));

  return (
    <Shell
      focusKey={isForm ? (view.id ?? "new") : "list"}
      label="Tickets"
      onClose={close}
      onEscape={isForm ? () => setView(backView) : close}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pl-4 pr-1.5">
        <Button
          aria-label={isForm ? "Back to list" : "All projects"}
          className={cn(ICON_BUTTON, "-ml-2.5")}
          onClick={() => (isForm ? setView(backView) : onHome("overview"))}
          size="icon"
          variant="ghost"
        >
          <Glyph icon={ArrowLeft01Icon} />
        </Button>
        <span className="flex-1 truncate text-xs font-semibold tracking-tight">
          {isForm
            ? view.id === null
              ? "New ticket"
              : parent === null
                ? "Ticket"
                : "Sub-task"
            : showArchived
              ? "Archived"
              : showAll
                ? "All tickets"
                : title}
        </span>
        {isForm ? null : (
          <>
            {matching.length === 0 ? null : (
              <span className="mr-0.5 text-[10px] tabular-nums text-muted-foreground/50">
                {matching.length}
              </span>
            )}
            <Button
              aria-label={`Queue, ${plural(queueCount, "ticket")}`}
              className="h-6 shrink-0 gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => onHome("queue")}
              size="sm"
              variant="ghost"
            >
              <Glyph icon={PlayListIcon} className="size-3" />
              Queue
              {queueCount > 0 ? (
                <span className="tabular-nums">{queueCount}</span>
              ) : null}
            </Button>
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <Button
                  aria-label="Ticket list options"
                  className={ICON_BUTTON}
                  size="icon"
                  variant="ghost"
                >
                  <Glyph icon={MoreHorizontalIcon} />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content
                align="end"
                className={MENU_CONTENT}
                side="bottom"
                sideOffset={6}
              >
                {projectId === routeProjectId ? null : (
                  <>
                    <DropdownMenu.Item
                      className={MENU_ITEM}
                      onSelect={() => {
                        close();
                        navigate.toProject(projectId);
                      }}
                    >
                      <Glyph icon={FolderIcon} />
                      <span className="flex-1">Open project</span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  </>
                )}
                <DropdownMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => {
                    setShowArchived(false);
                    setShowAll((current) => !current);
                  }}
                >
                  <Glyph icon={CheckListIcon} />
                  <span className="flex-1">
                    {showAll && !showArchived ? "Last 2 weeks" : "All tickets"}
                  </span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => {
                    setShowAll(false);
                    setShowArchived((current) => !current);
                  }}
                >
                  <Glyph icon={Archive03Icon} />
                  <span className="flex-1">
                    {showArchived ? "Show active" : "Show archived"}
                  </span>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => {
                    const next = !worktree;
                    setWorktree(next);
                    rpc
                      .call("configSet", { projectId, worktree: next })
                      .catch(() => setWorktree(!next));
                  }}
                >
                  <Glyph icon={FolderIcon} />
                  <span className="flex-1">Isolated worktree</span>
                  {worktree ? (
                    <Glyph
                      icon={Tick02Icon}
                      className="size-3 text-muted-foreground"
                    />
                  ) : null}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => {
                    const next = !askNotes;
                    setAskNotes(next);
                    rpc
                      .call("configSet", { projectId, notes: next })
                      .catch(() => setAskNotes(!next));
                  }}
                >
                  <Glyph icon={Edit02Icon} />
                  <span className="flex-1">Ask for notes before sending</span>
                  {askNotes ? (
                    <Glyph
                      icon={Tick02Icon}
                      className="size-3 text-muted-foreground"
                    />
                  ) : null}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </>
        )}
        <Button
          aria-label="Close tickets"
          className={ICON_BUTTON}
          onClick={close}
          size="icon"
          variant="ghost"
        >
          <Glyph icon={Cancel01Icon} />
        </Button>
      </div>

      {isForm ? null : (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
          <Glyph icon={Search01Icon} className="size-3 text-muted-foreground/60" />
          <input
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") event.stopPropagation();
            }}
            placeholder="Search tickets…"
            ref={searchRef}
            value={query}
          />
          {query === "" ? null : (
            <button
              aria-label="Clear search"
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-state-active hover:text-foreground"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              type="button"
            >
              <Glyph icon={Cancel01Icon} className="size-3" />
            </button>
          )}
          {showArchived ? null : (
            <Button
              className="-mr-1 h-6 shrink-0 rounded-md px-2 text-[11px]"
              onClick={() => setQuickAdd(true)}
              size="sm"
              variant="secondary"
            >
              <Glyph icon={Add01Icon} className="size-3" />
              New
            </Button>
          )}
        </div>
      )}

      {isForm && view.id !== null && loaded === null ? (
        <SkeletonList />
      ) : isForm ? (
        <TicketForm
          key={view.id ?? "new"}
          onArchive={(ticket) => void archive([ticket], !ticket.archived)}
          onBack={() => setView(backView)}
          onClose={close}
          onDelete={(ticket) => remove([ticket])}
          onOpenTicket={(id) => setView({ kind: "form", id })}
          onSend={(ticket) =>
            void send([ticket], { kind: "new", separate: false })
          }
          parent={parent}
          projectId={projectId}
          subtasks={editing === null ? [] : (kids.get(editing.id) ?? [])}
          ticket={editing}
        />
      ) : (
        <div
          className={cn("min-h-0 flex-1 overflow-y-auto pb-2", SCROLLBAR)}
          ref={listRef}
        >
          {loaded === null ? (
            <SkeletonList />
          ) : (
            <>
              {quickAdd && !showArchived ? (
                <QuickAdd onClose={() => setQuickAdd(false)} onCreate={create} />
              ) : null}
              {matching.length === 0 ? (
                <EmptyState
                  archived={showArchived}
                  searching={needle !== ""}
                />
              ) : showArchived ? (
                <div className="pt-1.5">{rowsFor([...matching])}</div>
              ) : (
                groups.map((group) => (
                  <section key={group.status}>
                    <GroupHeader
                      collapsed={collapsed.has(group.status)}
                      count={group.items.length}
                      onToggle={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (!next.delete(group.status)) {
                            next.add(group.status);
                          }
                          return next;
                        })
                      }
                      status={group.status}
                    />
                    {collapsed.has(group.status) ? null : rowsFor(group.items)}
                  </section>
                ))
              )}
            </>
          )}
        </div>
      )}

      {isForm || selectedTickets.length === 0 ? null : (
        <SelectionBar
          onClear={clearSelection}
          onMenu={(x, y) => setMenu({ tickets: selectedTickets, x, y })}
          onSend={(list, target) => void send(list, target)}
          tickets={selectedTickets}
        />
      )}

      {pending === null ? null : (
        <NotesPrompt
          notes={notes}
          onCancel={() => setPending(null)}
          onChange={setNotes}
          onConfirm={() => {
            const job = pending;
            setPending(null);
            void dispatch(job.list, job.target, notes);
          }}
          tickets={pending.list}
        />
      )}

      <TicketMenu
        menu={menu}
        onArchive={(list, archived) => void archive(list, archived)}
        onClose={() => setMenu(null)}
        onDelete={remove}
        onOpen={(ticket) => setView({ kind: "form", id: ticket.id })}
        onQueue={(list, queued) => void queueTickets(list, queued)}
        onQueueNext={(ticket) => void queueNext(ticket)}
        onRename={(ticket) => setRenamingId(ticket.id)}
        onSend={(list, target) => void send(list, target)}
        onStatus={(list, status) => void setStatus(list, status)}
        threadId={routeThreadId}
      />
    </Shell>
  );
}

const STATS_DAYS = 14;

type ProjectRow = {
  id: string;
  name: string;
  todo: number;
  in_progress: number;
  done: number;
  lastAt: number | null;
};
type SortKey = "recent" | "name" | "open";
type HomeTab = "queue" | "overview";

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";

function useLive<T>(load: () => Promise<T>): T | null {
  const connection = useRealtimeConnectionState();
  const [value, setValue] = useState<T | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setValue(await loadRef.current());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (connection === "connected") void refresh();
  }, [connection, refresh]);
  useRealtime(TICKETS_CHANGED, () => void refresh());

  return value;
}

function useQueue(): Ticket[] | null {
  const rpc = useRpc<typeof rpcContract>();
  const result = useLive(() => rpc.call("queue", {}));
  return result === null ? null : result.tickets;
}

function useProjects(): ProjectRow[] | null {
  const rpc = useRpc<typeof rpcContract>();
  const result = useLive(() => rpc.call("projects", {}));
  return result === null ? null : result.projects;
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="text-xl font-semibold tabular-nums tracking-tight">
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function ActivityBars({ done, now }: { done: DoneItem[]; now: number }) {
  const days = perDay(done, STATS_DAYS, now);
  const peak = Math.max(1, ...days.map((day) => day.count));
  const summary = `Done per day over the last ${STATS_DAYS} days. ${days
    .map((day) => `${longDate(day.at)}: ${day.count}`)
    .join(". ")}.`;
  return (
    <div>
      <div
        aria-label={summary}
        className="flex h-14 items-end gap-1"
        role="img"
      >
        {days.map((day) => (
          <div
            className="flex h-full flex-1 items-end"
            key={day.key}
            title={`${longDate(day.at)}: ${day.count} done`}
          >
            <div
              className={cn(
                "w-full rounded-sm",
                day.count === 0 ? "bg-muted" : "bg-emerald-500",
              )}
              style={{
                height: day.count === 0 ? "2px" : `${(day.count / peak) * 100}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/70">
        <span>{shortDate(days[0]?.at ?? now)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function StatsPanel({ projects }: { projects: ProjectRow[] | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const stats = useLive(() => rpc.call("stats", { days: STATS_DAYS }));
  const now = Date.now();

  if (stats === null) {
    return <div className="h-32 animate-pulse rounded-lg bg-muted/50" />;
  }

  const done = stats.done;
  const names = new Map((projects ?? []).map((one) => [one.id, one.name]));
  const active = new Set(done.map((item) => item.projectId)).size;
  const startsLate = stats.tracking === null || stats.tracking > stats.since;

  const download = () => {
    const markdown = summaryMarkdown({ done, days: STATS_DAYS, now, names });
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `tickets-summary-${new Date(now).toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Summary downloaded");
  };

  return (
    <section aria-labelledby="stats-heading" className="space-y-3">
      <div className="flex items-center gap-2">
        <h2
          className="flex-1 text-xs font-semibold tracking-tight"
          id="stats-heading"
        >
          Last {STATS_DAYS} days
        </h2>
        <Button
          className="h-7 rounded-md px-2 text-[11px]"
          disabled={done.length === 0}
          onClick={download}
          size="sm"
          variant="secondary"
        >
          <Glyph icon={Download01Icon} className="size-3" />
          Export last {STATS_DAYS} days
        </Button>
      </div>
      <div className="flex gap-2">
        <StatCard label="Done" value={done.length} />
        <StatCard label="In progress now" value={stats.working} />
        <StatCard label="Projects with progress" value={active} />
      </div>
      {done.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing finished in the last {STATS_DAYS} days. Completed tickets show
          up here.
        </p>
      ) : (
        <ActivityBars done={done} now={now} />
      )}
      {startsLate ? (
        <p className="text-[11px] text-muted-foreground/70">
          {stats.tracking === null
            ? "Finish a ticket and it will be counted here."
            : `Stats start on ${shortDate(stats.tracking)}. Earlier tickets have no finish date.`}
        </p>
      ) : null}
    </section>
  );
}

function ProjectButton({
  project,
  now,
  onOpen,
}: {
  project: ProjectRow;
  now: number;
  onOpen: () => void;
}) {
  const counts: [Status, number][] = [
    ["todo", project.todo],
    ["in_progress", project.in_progress],
    ["done", project.done],
  ];
  return (
    <button
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
      type="button"
    >
      <Glyph icon={FolderIcon} className="size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{project.name}</span>
      <span className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
        {counts.map(([status, count]) => (
          <span className="flex items-center gap-1" key={status}>
            <Glyph icon={STATUS_ICON[status]} className={STATUS_TONE[status]} />
            {count}
            <span className="sr-only"> {STATUS_LABEL[status]}</span>
          </span>
        ))}
      </span>
      <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground/70">
        {project.lastAt === null ? "No tickets" : ago(project.lastAt, now)}
      </span>
    </button>
  );
}

function ProjectList({
  projects,
  onOpen,
}: {
  projects: ProjectRow[] | null;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const listRef = useRef<HTMLUListElement>(null);
  const now = Date.now();

  if (projects === null) return <SkeletonList />;
  if (projects.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No projects yet. Open a project to start tracking tickets.
      </p>
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = projects
    .filter((one) => one.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "open") {
        return b.todo + b.in_progress - (a.todo + a.in_progress) ||
          a.name.localeCompare(b.name);
      }
      return (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.name.localeCompare(b.name);
    });

  const move = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    event.preventDefault();
    buttons[at + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
  };

  return (
    <section aria-labelledby="projects-heading" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2
          className="flex-1 text-xs font-semibold tracking-tight"
          id="projects-heading"
        >
          Projects
        </h2>
        <label className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 focus-within:ring-2 focus-within:ring-ring">
          <Glyph icon={Search01Icon} className="size-3 text-muted-foreground/60" />
          <input
            aria-label="Search projects"
            className="w-40 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search projects…"
            value={query}
          />
        </label>
        <select
          aria-label="Sort projects"
          className="h-7 rounded-md border border-border bg-transparent px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => setSort(event.currentTarget.value as SortKey)}
          value={sort}
        >
          <option value="recent">Recent</option>
          <option value="name">A to Z</option>
          <option value="open">Most open</option>
        </select>
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No project matches “{query.trim()}”.
        </p>
      ) : (
        <ul onKeyDown={move} ref={listRef}>
          {shown.map((project) => (
            <li key={project.id}>
              <ProjectButton
                now={now}
                onOpen={() => onOpen(project.id)}
                project={project}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueMenuItems({
  index,
  last,
  onOpen,
  onMove,
  onRemove,
}: {
  index: number;
  last: boolean;
  onOpen: () => void;
  onMove: (to: "top" | "up" | "down") => void;
  onRemove: () => void;
}) {
  return (
    <>
      <DropdownMenu.Item className={MENU_ITEM} onSelect={onOpen}>
        <Glyph icon={ArrowRight01Icon} />
        Open
      </DropdownMenu.Item>
      <DropdownMenu.Separator className="my-1 h-px bg-border" />
      {index === 0 ? null : (
        <DropdownMenu.Item className={MENU_ITEM} onSelect={() => onMove("top")}>
          <Glyph icon={ArrowUpDoubleIcon} />
          Work on this next
        </DropdownMenu.Item>
      )}
      {index === 0 ? null : (
        <DropdownMenu.Item className={MENU_ITEM} onSelect={() => onMove("up")}>
          <Glyph icon={ArrowUp01Icon} />
          Move up
        </DropdownMenu.Item>
      )}
      {last ? null : (
        <DropdownMenu.Item className={MENU_ITEM} onSelect={() => onMove("down")}>
          <Glyph icon={ArrowDown01Icon} />
          Move down
        </DropdownMenu.Item>
      )}
      <DropdownMenu.Separator className="my-1 h-px bg-border" />
      <DropdownMenu.Item className={MENU_ITEM} onSelect={onRemove}>
        <Glyph icon={Cancel01Icon} />
        Remove from queue
      </DropdownMenu.Item>
    </>
  );
}

function QueueRowMenu({
  ticket,
  index,
  last,
  onOpen,
  onMove,
  onRemove,
}: {
  ticket: Ticket;
  index: number;
  last: boolean;
  onOpen: () => void;
  onMove: (to: "top" | "up" | "down") => void;
  onRemove: () => void;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button
          aria-label={`Actions for ${ticket.title}`}
          className={ICON_BUTTON}
          size="icon"
          variant="ghost"
        >
          <Glyph icon={MoreHorizontalIcon} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        align="end"
        className={MENU_CONTENT}
        side="bottom"
        sideOffset={4}
      >
        <QueueMenuItems
          index={index}
          last={last}
          onMove={onMove}
          onOpen={onOpen}
          onRemove={onRemove}
        />
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function QueueView({
  tickets,
  projects,
  onOpenTicket,
  onClose,
}: {
  tickets: Ticket[];
  projects: ProjectRow[] | null;
  onOpenTicket: (ticket: Ticket) => void;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const tops = useRef<Map<string, number> | null>(null);
  const quiet = useRef(false);
  const focusId = useRef<string | null>(null);
  const [note, setNote] = useState("");
  const [ctx, setCtx] = useState<{
    ticket: Ticket;
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const names = new Map((projects ?? []).map((one) => [one.id, one.name]));
  const total = tickets.length;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    for (const el of Array.from(
      root.querySelectorAll<HTMLElement>("[data-queue-id]"),
    )) {
      const id = el.dataset.queueId ?? "";
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      const before = tops.current?.get(id);
      if (tops.current === null || reduced || quiet.current) continue;
      if (before === undefined) {
        el.animate(
          [
            { opacity: 0, transform: "translateY(4px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 180, easing: EASE_OUT },
        );
      } else if (before !== top) {
        el.animate(
          [{ transform: `translateY(${before - top}px)` }, { transform: "none" }],
          { duration: 200, easing: EASE_IN_OUT },
        );
      }
    }
    tops.current = next;
    quiet.current = false;
    if (focusId.current !== null) {
      root
        .querySelector<HTMLElement>(`[data-queue-id="${focusId.current}"]`)
        ?.focus();
      focusId.current = null;
    }
  }, [tickets]);

  const run = async (task: () => Promise<void>) => {
    try {
      await task();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed");
    }
  };

  const move = (ticket: Ticket, to: "top" | "up" | "down", byKey = false) => {
    quiet.current = byKey;
    if (byKey) focusId.current = ticket.id;
    const at = tickets.findIndex((one) => one.id === ticket.id);
    const position =
      to === "top" ? 1 : to === "up" ? Math.max(1, at) : Math.min(total, at + 2);
    return run(async () => {
      await rpc.call("queueMove", { id: ticket.id, to });
      setNote(`Moved to position ${position} of ${total}`);
    });
  };

  const remove = (ticket: Ticket, byKey = false) => {
    quiet.current = byKey;
    return run(async () => {
      await rpc.call("queueSet", { ids: [ticket.id], queued: false });
      setNote("Removed from queue");
      toast("Removed from queue", {
        description: ticket.title,
        action: {
          label: "Undo",
          onClick: () =>
            void rpc
              .call("queueSet", { ids: [ticket.id], queued: true })
              .catch(() => undefined),
        },
      });
    });
  };

  const send = (ticket: Ticket) =>
    run(async () => {
      const { threadIds } = await rpc.call("send", {
        ids: [ticket.id],
        separate: false,
      });
      const opened = threadIds[0];
      onClose();
      if (opened) navigate.toThread(opened);
      toast.success("Sent to agent");
    });

  const onContextMenu =
    (ticket: Ticket, index: number) => (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setCtx({ ticket, index, x: event.clientX, y: event.clientY });
    };

  const onKeyDown = (ticket: Ticket, index: number) => (
    event: React.KeyboardEvent,
  ) => {
    if (event.target !== event.currentTarget) return;
    const down = event.key === "ArrowDown";
    if (event.altKey && (down || event.key === "ArrowUp")) {
      event.preventDefault();
      if (down ? index === total - 1 : index === 0) return;
      void move(ticket, down ? "down" : "up", true);
      return;
    }
    if (down || event.key === "ArrowUp") {
      event.preventDefault();
      const rows = Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>("[data-queue-id]") ?? [],
      );
      rows[rows.indexOf(event.currentTarget as HTMLElement) + (down ? 1 : -1)]?.focus();
      return;
    }
    if (event.key.toLowerCase() === "q" || event.key === "Delete") {
      event.preventDefault();
      void remove(ticket, true);
    }
  };

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-16 text-center">
        <Glyph icon={PlayListIcon} className="size-5 text-muted-foreground/60" />
        <p className="text-sm font-medium">Nothing queued</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Add tickets from any project and work through them in order.
        </p>
      </div>
    );
  }

  const now = tickets[0] as Ticket;
  const next = tickets.slice(1);
  const projectName = (ticket: Ticket) =>
    names.get(ticket.projectId) ?? "Unknown project";

  return (
    <div className="space-y-5" ref={rootRef}>
      <div aria-live="polite" className="sr-only">
        {note}
      </div>
      <section aria-labelledby="queue-now" className="space-y-2">
        <h2
          className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70"
          id="queue-now"
        >
          Now
        </h2>
        <ol>
          <li
            aria-keyshortcuts="Alt+ArrowDown Q"
            aria-label={`Now: ${now.title}, ${projectName(now)}`}
            className="rounded-lg border border-border bg-background p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-queue-id={now.id}
            onContextMenu={onContextMenu(now, 0)}
            onKeyDown={onKeyDown(now, 0)}
            tabIndex={0}
          >
            <div className="flex items-start gap-2">
              <Glyph
                icon={STATUS_ICON[now.status]}
                className={cn("mt-1", STATUS_TONE[now.status])}
              />
              <div className="min-w-0 flex-1">
                <button
                  className="block w-full text-left text-sm font-medium leading-5 outline-none hover:underline focus-visible:underline"
                  onClick={() => onOpenTicket(now)}
                  type="button"
                >
                  {now.title}
                </button>
                <div className="text-[11px] text-muted-foreground">
                  {projectName(now)}
                </div>
              </div>
              <ThreadBadge ticket={now} />
              <QueueRowMenu
                index={0}
                last={total === 1}
                onMove={(to) => void move(now, to)}
                onOpen={() => onOpenTicket(now)}
                onRemove={() => void remove(now)}
                ticket={now}
              />
            </div>
            {now.working ? null : (
              <Button
                className="mt-2 h-7 rounded-md px-2 text-[11px]"
                onClick={() => void send(now)}
                size="sm"
                variant="secondary"
              >
                <Glyph icon={BotIcon} className="size-3" />
                Send to agent
              </Button>
            )}
          </li>
        </ol>
      </section>
      {next.length === 0 ? null : (
        <section aria-labelledby="queue-next" className="space-y-1">
          <h2
            className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70"
            id="queue-next"
          >
            Next
          </h2>
          <ol start={2}>
            {next.map((ticket, offset) => {
              const index = offset + 1;
              return (
                <li
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Q"
                  aria-label={`${index + 1} of ${total}: ${ticket.title}, ${projectName(ticket)}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring"
                  data-queue-id={ticket.id}
                  key={ticket.id}
                  onContextMenu={onContextMenu(ticket, index)}
                  onKeyDown={onKeyDown(ticket, index)}
                  tabIndex={0}
                >
                  <span
                    aria-hidden="true"
                    className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/70"
                  >
                    {index + 1}
                  </span>
                  <Glyph
                    icon={STATUS_ICON[ticket.status]}
                    className={STATUS_TONE[ticket.status]}
                  />
                  <button
                    className="min-w-0 flex-1 truncate text-left text-[13px] outline-none hover:underline focus-visible:underline"
                    onClick={() => onOpenTicket(ticket)}
                    type="button"
                  >
                    {ticket.title}
                  </button>
                  <span className="max-w-[8rem] shrink-0 truncate text-[11px] text-muted-foreground/70">
                    {projectName(ticket)}
                  </span>
                  <ThreadBadge ticket={ticket} />
                  <QueueRowMenu
                    index={index}
                    last={index === total - 1}
                    onMove={(to) => void move(ticket, to)}
                    onOpen={() => onOpenTicket(ticket)}
                    onRemove={() => void remove(ticket)}
                    ticket={ticket}
                  />
                </li>
              );
            })}
          </ol>
        </section>
      )}
      <DropdownMenu.Root
        modal={false}
        onOpenChange={(open) => {
          if (!open) setCtx(null);
        }}
        open={ctx !== null}
      >
        <DropdownMenu.Trigger asChild>
          <span
            aria-hidden="true"
            className="pointer-events-none fixed size-0"
            style={{ left: ctx?.x ?? 0, top: ctx?.y ?? 0 }}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          align="start"
          className={MENU_CONTENT}
          side="bottom"
          sideOffset={0}
        >
          {ctx === null ? null : (
            <QueueMenuItems
              index={ctx.index}
              last={ctx.index === total - 1}
              onMove={(to) => void move(ctx.ticket, to)}
              onOpen={() => onOpenTicket(ctx.ticket)}
              onRemove={() => void remove(ctx.ticket)}
            />
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <p className="text-[11px] text-muted-foreground/70">
        <kbd className="font-sans">⌥↑</kbd> <kbd className="font-sans">⌥↓</kbd>{" "}
        reorder · <kbd className="font-sans">Q</kbd> remove
      </p>
    </div>
  );
}

function toggleTickets(): void {
  window.dispatchEvent(new Event(TOGGLE_EVENT));
}

function ComposerTicketAction() {
  const view = useComposerView();
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const routeProjectId = useBbContext().projectId;
  const projectId =
    view.scope.kind === "new-thread" ? view.scope.projectId : routeProjectId;

  useEffect(() => {
    setComposeProject(projectId);
    return () => setComposeProject(null);
  }, [projectId]);

  if (projectId === null) return null;

  const draft = splitDraft(composer.text);
  const hasDraft = draft.title !== "";

  const onClick = async () => {
    if (!hasDraft) {
      toggleTickets();
      return;
    }
    try {
      await rpc.call("create", { projectId, ...draft });
      composer.setText("");
      toast.success("Ticket created", { description: draft.title });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create ticket",
      );
    }
  };

  return (
    <Button
      aria-keyshortcuts={hasDraft ? undefined : "Meta+Shift+K Control+Shift+K"}
      aria-label={hasDraft ? "Create ticket from draft" : "Tickets"}
      className="size-8 text-muted-foreground hover:text-foreground"
      onClick={() => void onClick()}
      size="icon"
      variant="ghost"
    >
      <Glyph icon={hasDraft ? Add01Icon : CheckListIcon} className="size-4" />
    </Button>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "tickets",
    component: TicketsWindow,
  });
  app.commands.register({
    id: "toggle-tickets",
    title: "Toggle tickets",
    defaultShortcut: { key: "k", mod: true, shift: true },
    run: toggleTickets,
  });
  app.composer.customize({
    id: "tickets-composer",
    scopes: ["new-thread", "thread"],
    actions: [{ id: "ticket", component: ComposerTicketAction }],
  });
});
