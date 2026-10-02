import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  Archive03Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BotIcon,
  Cancel01Icon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  CircleIcon,
  DashedLineCircleIcon,
  Delete02Icon,
  Edit02Icon,
  FolderIcon,
  Loading03Icon,
  MoreHorizontalIcon,
  Search01Icon,
  SentIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { clampSize, loadSize, saveSize, type Size } from "@/lib/frame";
import {
  splitDraft,
  STATUS_LABEL,
  STATUSES,
  type Status,
  type Ticket,
} from "@/lib/status";
import { cn } from "@/lib/utils";

const TOGGLE_EVENT = "hmm-tickets:toggle";
const TICKETS_CHANGED = "tickets-changed";
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl+";

let composeProjectId: string | null = null;
const composeListeners = new Set<() => void>();

function setComposeProject(next: string | null): void {
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

function TicketRow({
  ticket,
  selected,
  onSelect,
  onOpen,
  onMenu,
  onStatusMenu,
}: {
  ticket: Ticket;
  selected: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
  onStatusMenu: (x: number, y: number) => void;
}) {
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
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] leading-5",
          ticket.status === "done" && "text-muted-foreground",
        )}
      >
        {ticket.title}
      </span>
      {ticket.description.trim() === "" ? null : (
        <span
          aria-hidden="true"
          className="size-1 shrink-0 rounded-full bg-muted-foreground/30"
        />
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

function TicketMenu({
  menu,
  threadId,
  onClose,
  onSend,
  onStatus,
  onArchive,
  onDelete,
}: {
  menu: Menu | null;
  threadId: string | null;
  onClose: () => void;
  onSend: (tickets: Ticket[], target: SendTarget) => void;
  onStatus: (tickets: Ticket[], status: Status) => void;
  onArchive: (tickets: Ticket[], archived: boolean) => void;
  onDelete: (tickets: Ticket[]) => void;
}) {
  const tickets = menu?.tickets ?? [];
  const count = tickets.length;
  const many = count > 1;
  const suffix = many ? ` ${count} tickets` : "";
  const allArchived = count > 0 && tickets.every((ticket) => ticket.archived);
  const shared = STATUSES.find((status) =>
    tickets.every((ticket) => ticket.status === status),
  );
  const statusOnly = menu?.only === "status";

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
        side="bottom"
        sideOffset={0}
      >
        {count === 0 ? null : statusOnly ? (
          statusItems
        ) : (
          <>
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

function TicketForm({
  ticket,
  projectId,
  onBack,
  onSend,
  onArchive,
  onDelete,
}: {
  ticket: Ticket | null;
  projectId: string;
  onBack: () => void;
  onSend: (ticket: Ticket) => void;
  onArchive: (ticket: Ticket) => void;
  onDelete: (ticket: Ticket) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [editing, setEditing] = useState(ticket === null);
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [description, setDescription] = useState(ticket?.description ?? "");

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
            <h2 className="text-[15px] font-semibold leading-6 tracking-tight">
              {title}
            </h2>
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
                <DropdownMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => onArchive(ticket)}
                >
                  <Glyph icon={Archive03Icon} />
                  {ticket.archived ? "Unarchive" : "Archive"}
                </DropdownMenu.Item>
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

function TicketsWindow() {
  const rpc = useRpc<typeof rpcContract>();
  const bbContext = useBbContext();
  const routeProjectId = bbContext.projectId;
  const routeThreadId = bbContext.threadId;
  const composedProjectId = useSyncExternalStore(
    subscribeComposeProject,
    () => composeProjectId,
  );
  const projectId = routeProjectId ?? composedProjectId;
  const [openProjects, setOpenProjects] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const isOpen = projectId !== null && openProjects.has(projectId);
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<View>({ kind: "list" });
  const [menu, setMenu] = useState<Menu | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [anchor, setAnchor] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<Status>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [quickAdd, setQuickAdd] = useState(false);
  const [worktree, setWorktree] = useState(false);
  const [size, setSize] = useState<Size>(() =>
    loadSize(window.innerWidth, window.innerHeight),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loaded = useTickets(projectId, isOpen, showArchived);
  const tickets = loaded ?? [];
  const needle = query.trim().toLowerCase();
  const matching =
    needle === ""
      ? tickets
      : tickets.filter(
          (ticket) =>
            ticket.title.toLowerCase().includes(needle) ||
            ticket.description.toLowerCase().includes(needle),
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

  const toggle = useCallback(() => {
    if (projectId === null) return;
    setOpenProjects((current) => {
      const next = new Set(current);
      if (!next.delete(projectId)) next.add(projectId);
      return next;
    });
  }, [projectId]);

  const close = useCallback(() => {
    if (projectId === null) return;
    setOpenProjects((current) => {
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  }, [projectId]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  useEffect(() => {
    window.addEventListener(TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(TOGGLE_EVENT, toggle);
  }, [toggle]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = IS_MAC
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!mod || !event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      event.stopPropagation();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [toggle]);

  useEffect(() => {
    setView({ kind: "list" });
    setShowArchived(false);
    setQuery("");
    clearSelection();
  }, [clearSelection, projectId]);

  useEffect(() => {
    clearSelection();
  }, [clearSelection, showArchived]);

  useEffect(() => {
    if (!isOpen || projectId === null) return;
    rpc.call("configGet", { projectId }).then(
      (config) => setWorktree(config.worktree),
      () => setWorktree(false),
    );
  }, [isOpen, projectId, rpc]);

  useEffect(() => {
    const onResize = () => {
      setSize((current) =>
        clampSize(current, window.innerWidth, window.innerHeight),
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
    if (!isOpen || isForm) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      const mod = IS_MAC ? event.metaKey : event.ctrlKey;

      if (event.key === "Escape") {
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
        }
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
      if (event.key.toLowerCase() === "n" && !mod && !showArchived) {
        event.preventDefault();
        setQuickAdd(true);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    clearSelection,
    isForm,
    isOpen,
    moveSelection,
    ordered,
    query,
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

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const grip = event.currentTarget;
    const origin = { x: event.clientX, y: event.clientY, ...size };
    grip.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      setSize(
        clampSize(
          {
            width: origin.width + (origin.x - move.clientX),
            height: origin.height + (origin.y - move.clientY),
          },
          window.innerWidth,
          window.innerHeight,
        ),
      );
    };
    const stop = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", stop);
      grip.removeEventListener("pointercancel", stop);
      setSize((current) => {
        saveSize(current);
        return current;
      });
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", stop);
    grip.addEventListener("pointercancel", stop);
  };

  const act = async (task: () => Promise<unknown>) => {
    try {
      await task();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed");
    }
  };

  const idsOf = (list: Ticket[]) => list.map((ticket) => ticket.id);

  const send = (list: Ticket[], target: SendTarget) =>
    act(async () => {
      const { threadIds } = await rpc.call("send", {
        ids: idsOf(list),
        separate: target.kind === "new" && target.separate,
        ...(target.kind === "thread" ? { threadId: target.threadId } : {}),
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
    const label =
      list.length === 1
        ? `"${list[0]?.title ?? ""}"`
        : `${list.length} tickets`;
    if (!window.confirm(`Delete ${label}?`)) return;
    void act(async () => {
      await rpc.call("remove", { ids: idsOf(list) });
      setView({ kind: "list" });
      clearSelection();
    });
  };
  const create = async (title: string) => {
    if (projectId === null) return;
    await act(() => rpc.call("create", { projectId, title, description: "" }));
  };

  if (!isOpen || projectId === null) return null;

  const editing =
    view.kind === "form"
      ? (tickets.find((ticket) => ticket.id === view.id) ?? null)
      : null;
  const frame = clampSize(size, window.innerWidth, window.innerHeight);

  const rowsFor = (items: Ticket[]) =>
    items.map((ticket) => (
      <TicketRow
        key={ticket.id}
        onMenu={(x, y) => openMenuFor(ticket, x, y)}
        onOpen={() => setView({ kind: "form", id: ticket.id })}
        onSelect={(event) => selectRow(ticket, event)}
        onStatusMenu={(x, y) => openMenuFor(ticket, x, y, "status")}
        selected={selected.has(ticket.id)}
        ticket={ticket}
      />
    ));

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      style={{ width: frame.width, height: frame.height }}
    >
      <div
        aria-hidden="true"
        className="absolute left-0 top-0 z-20 size-4 cursor-nwse-resize"
        onPointerDown={startResize}
      />

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pl-4 pr-1.5">
        {isForm ? (
          <Button
            aria-label="Back to list"
            className={cn(ICON_BUTTON, "-ml-2.5")}
            onClick={() => setView({ kind: "list" })}
            size="icon"
            variant="ghost"
          >
            <Glyph icon={ArrowLeft01Icon} />
          </Button>
        ) : null}
        <span className="flex-1 truncate text-xs font-semibold tracking-tight">
          {isForm
            ? view.id === null
              ? "New ticket"
              : "Ticket"
            : showArchived
              ? "Archived"
              : "Tickets"}
        </span>
        {isForm ? null : (
          <>
            {matching.length === 0 ? null : (
              <span className="mr-0.5 text-[10px] tabular-nums text-muted-foreground/50">
                {matching.length}
              </span>
            )}
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
                <DropdownMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => setShowArchived((current) => !current)}
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

      {isForm ? (
        <TicketForm
          key={view.id ?? "new"}
          onArchive={(ticket) => void archive([ticket], !ticket.archived)}
          onBack={() => setView({ kind: "list" })}
          onDelete={(ticket) => remove([ticket])}
          onSend={(ticket) =>
            void send([ticket], { kind: "new", separate: false })
          }
          projectId={projectId}
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

      <TicketMenu
        menu={menu}
        onArchive={(list, archived) => void archive(list, archived)}
        onClose={() => setMenu(null)}
        onDelete={remove}
        onSend={(list, target) => void send(list, target)}
        onStatus={(list, status) => void setStatus(list, status)}
        threadId={routeThreadId}
      />
    </div>
  );
}

function toggleTickets(): void {
  window.dispatchEvent(new Event(TOGGLE_EVENT));
}

function TicketsActionButton({ className = "size-7" }: { className?: string }) {
  return (
    <Button
      aria-keyshortcuts="Meta+Shift+K Control+Shift+K"
      aria-label={`Tickets (${MOD_LABEL}⇧K)`}
      className={cn("text-muted-foreground hover:text-foreground", className)}
      onClick={toggleTickets}
      size="icon"
      variant="ghost"
    >
      <Glyph icon={CheckListIcon} className="size-4" />
    </Button>
  );
}

function ThreadHeaderTicketsAction(_props: PluginThreadHeaderActionProps) {
  return <TicketsActionButton />;
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
  app.slots.experimental_threadHeaderAction({
    id: "tickets",
    title: "Tickets",
    component: ThreadHeaderTicketsAction,
  });
  app.slots.commandPaletteAction({
    id: "toggle-tickets",
    title: "Hmm Tickets: toggle tickets",
    isAvailable: ({ projectId }) =>
      projectId !== null || composeProjectId !== null,
    run: toggleTickets,
  });
  app.composer.customize({
    id: "tickets-composer",
    scopes: ["new-thread", "thread"],
    actions: [{ id: "ticket", component: ComposerTicketAction }],
  });
});
