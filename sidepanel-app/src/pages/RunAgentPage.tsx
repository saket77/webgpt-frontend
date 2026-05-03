import { Stack } from "@mantine/core";

import {
  BackendConfigCard,
  CurrentStepCard,
  EventLogCard,
  PreRunDisclosureModal,
  RunAgentControlPanel,
  RunAgentHumanHintCard,
  SuccessConfirmationCard,
} from "../components/agent";

import { ErrorAlert, PageHeader } from "../components/common";

import type { RunLaunchRequest } from "../hooks/useAgentLaunchRequest";
import { useAgentRunController } from "../controllers/useAgentRunController";

type RunAgentPageProps = {
  launchRequest?: RunLaunchRequest | null;
  onLaunchRequestHandled?: () => void;
};

export default function RunAgentPage(props: RunAgentPageProps) {
  const controller = useAgentRunController(props);

  return (
    <Stack p="md" gap="md">
      {/* Header */}
      <PageHeader title="Run Agent" />

      {/* Error */}
      <ErrorAlert />

      {/* Control Panel */}
      <PreRunDisclosureModal
        opened={controller.preRunDisclosureOpened}
        loading={controller.busyAction === "permissions"}
        surface={controller.preRunSurface}
        onAccept={() => void controller.handlePreRunDisclosureAccept()}
        onCancel={controller.handlePreRunDisclosureCancel}
      />

      <RunAgentControlPanel
        goal={controller.goal}
        setGoal={controller.setGoal}
        artifactFileName={controller.artifactFileName}
        canStart={controller.canStart}
        canStop={controller.canStop}
        canRefresh={controller.canRefresh}
        canAttach={controller.canAttach}
        canReset={controller.canReset}
        onStart={() => void controller.handleStart()}
        onStop={() => void controller.handleStop()}
        onRefresh={() => void controller.handleRefresh()}
        onAttachToActiveTab={() => void controller.handleAttachToActiveTab()}
        onReset={() => void controller.handleReset()}
      />

      <BackendConfigCard />

      {/* Current Step */}
      <CurrentStepCard
        activeTabId={controller.activeTabId}
        attachedTabId={controller.attachedTabId}
        session={controller.session}
      />

      {/* Success Confirmation */}
      {controller.awaitingConfirmation && (
        <SuccessConfirmationCard
          description="Accept if the task is complete. Reject to resume the loop with a hint."
          onAccept={() => void controller.handleAcceptSuccess()}
          onReject={() => void controller.handleRejectSuccess()}
        />
      )}

      {/* Human Assist */}
      <RunAgentHumanHintCard
        onSendHint={() => void controller.handleSendHint()}
      />

      {/* Event Log */}
      <EventLogCard />
    </Stack>
  );
}
