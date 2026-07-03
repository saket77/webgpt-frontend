import { Stack } from "@mantine/core";

import {
  AgentChatPanel,
  PreRunDisclosureModal,
} from "../components/agent";

import { ErrorAlert } from "../components/common";

import type { RunLaunchRequest } from "../hooks/useAgentLaunchRequest";
import { useAgentRunController } from "../controllers/useAgentRunController";

type RunAgentPageProps = {
  launchRequest?: RunLaunchRequest | null;
  onLaunchRequestHandled?: () => void;
};

export default function RunAgentPage(props: RunAgentPageProps) {
  const controller = useAgentRunController({
    ...props,
    sessionScope: "home",
  });

  return (
    <Stack className="run-page" gap="md">
      <ErrorAlert />

      <PreRunDisclosureModal
        opened={controller.preRunDisclosureOpened}
        loading={controller.busyAction === "permissions"}
        surface={controller.preRunSurface}
        onAccept={() => void controller.handlePreRunDisclosureAccept()}
        onCancel={controller.handlePreRunDisclosureCancel}
      />

      <AgentChatPanel
        goal={controller.goal}
        setGoal={controller.setGoal}
        activeTabId={controller.activeTabId}
        attachedTabId={controller.attachedTabId}
        session={controller.session}
        isRunning={controller.isRunning}
        isAwaitingNavigation={controller.isAwaitingNavigation}
        awaitingConfirmation={controller.awaitingConfirmation}
        awaitingHumanHint={controller.awaitingHumanHint}
        canStart={controller.canStart}
        canStop={controller.canStop}
        canReset={controller.canReset}
        onStart={(submittedGoal, profileAttachments) =>
          void controller.handleStart({
            goal: submittedGoal || controller.goal,
            profileAttachments,
          })
        }
        onStop={() => void controller.handleStop()}
        onReset={() => void controller.handleReset()}
        onSendHint={() => void controller.handleSendHint()}
        onAcceptSuccess={() => void controller.handleAcceptSuccess()}
        onRejectSuccess={() => void controller.handleRejectSuccess()}
      />
    </Stack>
  );
}
