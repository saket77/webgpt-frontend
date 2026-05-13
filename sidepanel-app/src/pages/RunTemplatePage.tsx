import { Button, Group, Paper, Stack, Text } from "@mantine/core";

import {
  AgentChatPanel,
  PreRunDisclosureModal,
} from "../components/agent";

import { ErrorAlert } from "../components/common";
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
  const agent = useAgentRunController({
    sessionScope: "template",
  });

  const template = useTemplateRunQueue({
    artifact,
    agent,
  });

  return (
    <Stack className="run-page" gap="md">
      <ErrorAlert />

      <PreRunDisclosureModal
        opened={agent.preRunDisclosureOpened}
        loading={agent.busyAction === "permissions"}
        surface={agent.preRunSurface}
        onAccept={() => void agent.handlePreRunDisclosureAccept()}
        onCancel={agent.handlePreRunDisclosureCancel}
      />

      <AgentChatPanel
        title="Routine"
        subtitle={`${template.currentIndex + 1} of ${template.totalRuns}`}
        goal={template.renderedGoal}
        setGoal={() => undefined}
        showSessionGoal={false}
        allowFreeformStart={false}
        autoScrollOnMount={false}
        showEmptySuggestions={false}
        activeTabId={agent.activeTabId}
        attachedTabId={agent.attachedTabId}
        session={agent.session}
        isRunning={agent.isRunning}
        isAwaitingNavigation={agent.isAwaitingNavigation}
        awaitingConfirmation={agent.awaitingConfirmation}
        awaitingHumanHint={agent.awaitingHumanHint}
        canStart={template.canStart}
        canStop={agent.canStop}
        canReset={agent.canReset}
        onStart={() => void template.handleStartCurrent()}
        onStop={() => void template.handleStop()}
        onReset={() => void agent.handleReset()}
        onSendHint={() => void template.handleSendHint()}
        onAcceptSuccess={() => void template.handleAcceptSuccess()}
        onRejectSuccess={() => void template.handleRejectSuccess()}
        preActivity={
          <Paper className="routine-setup" withBorder>
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text fw={800} size="lg">
                    {artifact.goal || "Untitled routine"}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {artifact.description || "No description available"}
                  </Text>
                </div>
                {onBack ? (
                  <Button variant="default" radius="xl" onClick={onBack}>
                    Back
                  </Button>
                ) : null}
              </Group>

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
            </Stack>
          </Paper>
        }
        postActivity={
          <TemplateResultsCard results={template.templateResults} />
        }
      />
    </Stack>
  );
}
