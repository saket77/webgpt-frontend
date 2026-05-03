import { Button, Card, Stack, Text } from "@mantine/core";

import {
  CurrentStepCard,
  EventLogCard,
  PreRunDisclosureModal,
  RunAgentHumanHintCard,
  SuccessConfirmationCard,
} from "../components/agent";

import { ErrorAlert, PageHeader } from "../components/common";
import {
  TemplateControlPanel,
  TemplateResultsCard,
} from "../components/template";

import { useAgentRunController } from "../controllers/useAgentRunController";
import { useTemplateRunQueue } from "../hooks/useTemplateRunQueue";
import type { SavedArtifactSummary } from "../hooks/useSavedArtifacts";

type RunTemplatePageProps = {
  artifact: SavedArtifactSummary;
  onBack?: () => void;
};

export default function RunTemplatePage({
  artifact,
  onBack,
}: RunTemplatePageProps) {
  const agent = useAgentRunController();

  const template = useTemplateRunQueue({
    artifact,
    agent,
  });

  return (
    <Stack p="md" gap="md">
      <PageHeader
        title="Run Template"
        rightSection={
          onBack ? (
            <Button variant="default" size="xs" onClick={onBack}>
              Back
            </Button>
          ) : null
        }
      />

      <ErrorAlert />

      <PreRunDisclosureModal
        opened={agent.preRunDisclosureOpened}
        loading={agent.busyAction === "permissions"}
        surface={agent.preRunSurface}
        onAccept={() => void agent.handlePreRunDisclosureAccept()}
        onCancel={agent.handlePreRunDisclosureCancel}
      />

      <Card withBorder radius="md" p="md">
        <Stack gap="xs">
          <Text fw={700}>{artifact.goal || "Untitled template"}</Text>

          <Text size="sm" c="dimmed">
            {artifact.description || "No description available"}
          </Text>

          <Text size="xs" c="dimmed">
            Replay artifact: {artifact.successfulReplayArtifactFileName || "—"}
          </Text>

          <Text size="xs" c="dimmed">
            Current item: {template.currentIndex + 1} / {template.totalRuns}
          </Text>
        </Stack>
      </Card>

      <TemplateControlPanel
        inputSchema={artifact.inputSchema || []}
        inputValues={template.inputValues}
        currentIndex={template.currentIndex}
        totalRuns={template.totalRuns}
        renderedGoal={template.renderedGoal}
        isRunning={agent.isRunning}
        busyAction={agent.busyAction}
        queueMode={template.queueMode}
        canStart={template.canStart}
        canMoveIndex={template.canMoveIndex}
        onInputChange={template.handleInputChange}
        onAddValue={template.handleAddValue}
        onRemoveValue={template.handleRemoveValue}
        onPrevious={() =>
          template.setCurrentIndex((prev) => Math.max(prev - 1, 0))
        }
        onNext={() =>
          template.setCurrentIndex((prev) =>
            Math.min(prev + 1, template.totalRuns - 1),
          )
        }
        onStartCurrent={() => void template.handleStartCurrent()}
        onStartQueue={() => void template.handleStartQueue()}
        onStop={() => void template.handleStop()}
      />

      <CurrentStepCard
        activeTabId={agent.activeTabId}
        attachedTabId={agent.attachedTabId}
        session={agent.session}
      />

      {agent.awaitingConfirmation ? (
        <SuccessConfirmationCard
          description="Accept if the current item is complete. Reject to resume it with a hint."
          onAccept={() => void template.handleAcceptSuccess()}
          onReject={() => void template.handleRejectSuccess()}
        />
      ) : null}

      <RunAgentHumanHintCard
        onSendHint={() => void template.handleSendHint()}
      />

      <TemplateResultsCard results={template.templateResults} />

      <EventLogCard />
    </Stack>
  );
}
