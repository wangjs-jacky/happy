import { useLingui } from "@lingui/react/macro";
import type { Bot, Group, ThreadSnapshot } from "@rakazo/contracts";
import { BotAvatar, Button, GroupAvatar } from "@rakazo/ui-web";
import { Gift, Menu, Monitor, Phone } from "lucide-react";
import { useState } from "react";
import { IconTooltip } from "../../components/IconTooltip";
import { InviteDialog } from "../../components/InviteDialog";
import { useBilling } from "../../components/SubscriptionGate";
import { desktopBridge, windowChromeKind } from "../../lib/desktop";
import { WindowChrome } from "../WindowChrome";

/** The floating header over the transcript: navigation, the chat's name, call and invite. */
export function ChatHeader({
  inGroup,
  active,
  activeGroup,
  activeSnapshot,
  phoneCallsEnabled,
  voiceReady,
  inCall,
  panelOpen,
  onOpenNavigation,
  onTogglePanel,
  onCall,
  onOpenComputer,
}: {
  inGroup: boolean;
  active: Bot | undefined;
  activeGroup: Group | undefined;
  activeSnapshot: ThreadSnapshot | null;
  phoneCallsEnabled: boolean;
  /** False while the voice status loads or no voice is connected; the button then opens voice settings. */
  voiceReady: boolean;
  inCall: boolean;
  panelOpen: boolean;
  onOpenNavigation: () => void;
  onTogglePanel: () => void;
  onCall: (bot: Bot) => void;
  onOpenComputer?: () => void;
}) {
  const { t } = useLingui();
  const referral = useBilling().status?.referral;
  const [inviteOpen, setInviteOpen] = useState(false);
  const macChrome = windowChromeKind(desktopBridge()) === "darwin";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b border-sidebar-border bg-background px-3 py-3 md:px-5 [&_button]:pointer-events-auto">
      <div className="flex items-center md:hidden">
        {macChrome ? <WindowChrome className="md:hidden" /> : null}
        <Button
          variant="floating"
          size="icon-lg"
          aria-label={t`Open navigation`}
          onClick={onOpenNavigation}
          className="app-no-drag md:hidden"
        >
          <Menu strokeWidth={1.7} className="size-[19px]" />
        </Button>
      </div>
      <Button
        variant="floating"
        data-testid="bot-settings-trigger"
        aria-expanded={panelOpen}
        onClick={onTogglePanel}
        className="app-no-drag h-auto min-w-0 shrink gap-2 rounded-lg py-1 ps-1 pe-3.5"
      >
        {inGroup ? (
          <GroupAvatar members={activeSnapshot?.members ?? activeGroup?.members ?? []} size={26} />
        ) : active ? (
          <BotAvatar
            avatarSet={active.avatarSet}
            color={active.color}
            identity={active.id}
            size={26}
            status={active.status}
          />
        ) : null}
        <span className="min-w-0">
          <span className="block truncate text-body-lg font-medium text-foreground" dir="auto">
            {inGroup
              ? (activeGroup?.name ?? activeSnapshot?.groupName ?? t`Group`)
              : (active?.name ?? t`Select a bot`)}
          </span>
        </span>
      </Button>
      <div className="ms-auto flex shrink-0 items-center gap-2">
        {!inGroup && active && onOpenComputer ? (
          <IconTooltip label={t`Team Computer`}>
            <Button
              variant="floating"
              size="icon-lg"
              aria-label={t`Team Computer`}
              onClick={onOpenComputer}
              className="app-no-drag"
            >
              <Monitor strokeWidth={1.6} className="size-[18px]" />
            </Button>
          </IconTooltip>
        ) : null}
        {phoneCallsEnabled && !inGroup && active ? (
          <IconTooltip label={inCall ? t`Open call` : t`Call`}>
            <Button
              variant="floating"
              size="icon-lg"
              data-testid="call-button"
              aria-label={inCall ? t`Open call` : t`Call`}
              onClick={() => onCall(active)}
              data-active={inCall ? "" : undefined}
              data-voice-ready={voiceReady ? "" : undefined}
              className="app-no-drag"
            >
              <Phone strokeWidth={1.6} className="size-[17px]" />
            </Button>
          </IconTooltip>
        ) : null}
        {referral && !inGroup && active ? (
          <IconTooltip label={t`Invite a friend`}>
            <Button
              variant="floating"
              size="icon-lg"
              aria-label={t`Invite a friend`}
              onClick={() => setInviteOpen(true)}
              className="app-no-drag"
            >
              <Gift strokeWidth={1.6} className="size-[17px]" />
            </Button>
          </IconTooltip>
        ) : null}
      </div>
      {referral ? (
        <InviteDialog referral={referral} open={inviteOpen} onOpenChange={setInviteOpen} />
      ) : null}
    </div>
  );
}
