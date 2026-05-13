import { useCallback, useState } from "react";
import { ActionIcon, AppShell, Group, Tooltip } from "@mantine/core";
import RunAgentPage from "./pages/RunAgentPage";
import RunTemplatePage from "./pages/RunTemplatePage";
import SavedArtifactsPage from "./pages/SavedArtifactsPage";
import SettingsPage from "./pages/SettingsPage";
import type { SavedArtifactSummary } from "./hooks/useSavedArtifacts";
import type { RunLaunchRequest } from "./hooks/useAgentLaunchRequest";
import { AgentUXProvider } from "./providers";

type Page = "home" | "saved" | "template" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [launchRequest, setLaunchRequest] = useState<RunLaunchRequest | null>(
    null,
  );
  const [selectedArtifact, setSelectedArtifact] =
    useState<SavedArtifactSummary | null>(null);

  const handleOpenArtifact = useCallback((artifact: SavedArtifactSummary) => {
    setSelectedArtifact(artifact);
    setPage("template");
  }, []);

  const handleLaunchRequestHandled = useCallback(() => {
    setLaunchRequest(null);
  }, []);

  const handleOpenRunPage = useCallback(() => {
    setSelectedArtifact(null);
    setPage("home");
  }, []);

  const handleOpenSavedPage = useCallback(() => {
    setPage("saved");
  }, []);

  const handleBackFromTemplate = useCallback(() => {
    setPage("saved");
  }, []);

  return (
    <AppShell padding={0}>
      <AppShell.Header className="app-header">
        <Group justify="flex-end" wrap="nowrap" h="100%">
          <Group gap={8} wrap="nowrap">
            <Tooltip label="Home">
              <ActionIcon
                className="nav-action"
                radius="md"
                variant="transparent"
                data-active={page === "home" ? "true" : undefined}
                onClick={handleOpenRunPage}
                aria-label="Home"
              >
                H
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Routines">
              <ActionIcon
                className="nav-action"
                radius="md"
                variant="transparent"
                data-active={
                  page === "saved" || page === "template" ? "true" : undefined
                }
                onClick={handleOpenSavedPage}
                aria-label="Routines"
              >
                R
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Settings">
              <ActionIcon
                className="nav-action nav-action-settings"
                radius="md"
                variant="transparent"
                data-active={page === "settings" ? "true" : undefined}
                onClick={() => setPage("settings")}
                aria-label="Settings"
              >
                ⚙
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main className="app-main">
        {page === "home" ? (
          <AgentUXProvider key="home">
            <RunAgentPage
              launchRequest={launchRequest}
              onLaunchRequestHandled={handleLaunchRequestHandled}
            />
          </AgentUXProvider>
        ) : null}

        {page === "saved" ? (
          <SavedArtifactsPage onOpenArtifact={handleOpenArtifact} />
        ) : null}

        {page === "template" && selectedArtifact ? (
          <AgentUXProvider
            key={`template-${
              selectedArtifact.successfulReplayArtifactFileName ||
              selectedArtifact.goal ||
              "routine"
            }`}
          >
            <RunTemplatePage
              artifact={selectedArtifact}
              onBack={handleBackFromTemplate}
            />
          </AgentUXProvider>
        ) : null}

        {page === "settings" ? (
          <SettingsPage onBack={handleOpenRunPage} />
        ) : null}
      </AppShell.Main>
    </AppShell>
  );
}
